import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { db, rtdb } from "../lib/firebaseAdmin";
import { haversineMeters } from "../lib/geo";
import {
  evaluateChatRate,
  censorText,
} from "../services/chatRateLimit";
import {
  JOIN_RADIUS_M,
  boardingCodesMatch,
  generateBoardingCode,
  normalizeBoardingCode,
  validateLiveBoardingProjection,
  validatePassengerPosition,
  validateStopSelection,
} from "../services/boardingPolicy";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{16,128}$/;
const BOARDING_STATUSES = new Set(["armed", "active"]);
const CHAT_STATUSES = new Set(["armed", "active"]);
// Each manifest entry is at most ~200 bytes (userName capped at 100 chars, a
// fixed stop selection, and one timestamp). Capping at 1000 entries keeps the
// worst-case manifest near 200 KB — a 5× margin under Firestore's 1 MiB
// document cap — so a boarding-code spammer cannot brick the session doc for
// every other passenger (issue #75).
const MAX_PASSENGER_MANIFEST_ENTRIES = 1000;

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    name?: string;
    driverId?: string;
    assignedBusId?: string;
    admin?: boolean;
  };
};

class BoardingPolicyError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

class ChatPolicyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

function sendBoardingError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof BoardingPolicyError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(`[Sessions] ${fallback}:`, error);
  res.status(500).json({ error: fallback });
}

function passengerManifest(value: unknown): Record<string, Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Record<string, unknown>>
    : {};
}

function hasPassenger(
  manifest: Record<string, Record<string, unknown>>,
  uid: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(manifest, uid);
}

function valueToMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : undefined;
  }
  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") {
      const millis = toMillis.call(value);
      return typeof millis === "number" && Number.isFinite(millis) ? millis : undefined;
    }
  }
  return undefined;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * POST /api/sessions/:sessionId/boarding-code
 *
 * Returns the session-scoped code only to the assigned driver. The code is
 * deliberately absent from RTDB and passenger-readable data. It supplies the
 * server-verifiable proof that browser geolocation alone cannot provide.
 */
router.post("/:sessionId/boarding-code", requireAuth, async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const sessionId = req.params.sessionId;
  const user = req.user;
  if (!SAFE_ID.test(sessionId)) {
    res.status(400).json({ error: "Invalid session ID." });
    return;
  }
  if (
    user?.role !== "driver" ||
    typeof user.driverId !== "string" ||
    typeof user.assignedBusId !== "string"
  ) {
    res.status(403).json({ error: "Only the assigned driver can view the boarding code." });
    return;
  }

  try {
    const proposedCode = generateBoardingCode();
    const sessionRef = db.collection("ride_sessions").doc(sessionId);
    const boardingCode = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(sessionRef);
      const data = snapshot.data();
      if (!snapshot.exists || !data) {
        throw new BoardingPolicyError(404, "Ride session was not found.");
      }
      if (
        !BOARDING_STATUSES.has(String(data.status)) ||
        data.driverId !== user.driverId ||
        data.busId !== user.assignedBusId
      ) {
        throw new BoardingPolicyError(403, "Driver is not assigned to this active session.");
      }
      const existing = normalizeBoardingCode(data.boardingCode);
      if (existing) return existing;
      transaction.update(sessionRef, {
        boardingCode: proposedCode,
        boardingCodeIssuedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return proposedCode;
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ sessionId, boardingCode });
  } catch (error) {
    sendBoardingError(res, error, "Unable to issue the boarding code.");
  }
});

/**
 * POST /api/sessions/:sessionId/join
 *
 * A passenger needs both a driver-visible, session-scoped code and a fresh
 * browser position near the trusted hardware fix. Browser coordinates are
 * attacker-controlled and therefore only defense in depth; the boarding code
 * is the server-verifiable authorization that closes public-session self-join.
 */
router.post("/:sessionId/join", requireAuth, async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const sessionId = req.params.sessionId;
  const user = req.user;
  if (!SAFE_ID.test(sessionId)) {
    res.status(400).json({ error: "Invalid session ID." });
    return;
  }
  if (!user?.uid || (user.role !== undefined && user.role !== "passenger")) {
    res.status(403).json({ error: "A passenger account is required to board." });
    return;
  }

  const passengerPosition = validatePassengerPosition(
    req.body?.lat,
    req.body?.lng,
    req.body?.accuracy,
  );
  const submittedCode = normalizeBoardingCode(req.body?.boardingCode);
  if (!submittedCode) {
    res.status(400).json({ error: "Invalid boarding details." });
    return;
  }

  try {
    const sessionRef = db.collection("ride_sessions").doc(sessionId);
    const session = await sessionRef.get();
    const data = session.data();
    if (!session.exists || !data) {
      throw new BoardingPolicyError(404, "Ride session was not found.");
    }
    if (!BOARDING_STATUSES.has(String(data.status))) {
      throw new BoardingPolicyError(409, "This ride is no longer boarding.");
    }
    if (!boardingCodesMatch(data.boardingCode, submittedCode)) {
      throw new BoardingPolicyError(403, "The boarding code is invalid.");
    }

    const busId = typeof data.busId === "string" && SAFE_ID.test(data.busId)
      ? data.busId
      : "";
    const routeId = typeof data.routeId === "string" && SAFE_ID.test(data.routeId)
      ? data.routeId
      : "";
    if (!busId || !routeId) {
      throw new BoardingPolicyError(422, "This session has no active vehicle.");
    }

    // An already-authorized passenger may correct their selected stops after
    // location permission disappears. First-time boarding still requires a
    // fresh proximity check, and the transaction below rechecks membership.
    const requiresProximity = !hasPassenger(passengerManifest(data.passengers), user.uid);
    if (requiresProximity && !passengerPosition) {
      throw new BoardingPolicyError(400, "Location access is required to board this bus.");
    }

    const [route, profile, liveSnapshot] = await Promise.all([
      db.collection("routes").doc(routeId).get(),
      db.collection("users").doc(user.uid).get(),
      requiresProximity
        ? rtdb.ref(`activeBuses/${busId}_${routeId}`).once("value")
        : Promise.resolve(null),
    ]);
    const stopSelection = validateStopSelection(
      route.data()?.stops,
      req.body?.boardingStopId,
      req.body?.alightingStopId,
    );
    if (!route.exists || !stopSelection) {
      throw new BoardingPolicyError(400, "Select valid stops in route order.");
    }

    if (requiresProximity) {
      const busPosition = validateLiveBoardingProjection(
        liveSnapshot?.val() as Record<string, unknown> | null,
        { sessionId, busId, routeId },
      );
      if (!busPosition) {
        throw new BoardingPolicyError(
          409,
          "The live bus position is unavailable; wait for a fresh hardware fix.",
        );
      }
      const distanceM = haversineMeters(passengerPosition!, busPosition);
      if (!Number.isFinite(distanceM) || distanceM > JOIN_RADIUS_M) {
        throw new BoardingPolicyError(403, "You must be near the bus to board.");
      }
    }

    const profileName = profile.data()?.displayName;
    const tokenName = user.name;
    const userName = (
      typeof profileName === "string" && profileName.trim()
        ? profileName.trim()
        : typeof tokenName === "string" && tokenName.trim()
          ? tokenName.trim()
          : "Passenger"
    ).slice(0, 100);

    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(sessionRef);
      const currentData = current.data();
      if (
        !current.exists ||
        !currentData ||
        !BOARDING_STATUSES.has(String(currentData.status)) ||
        currentData.busId !== busId ||
        currentData.routeId !== routeId ||
        !boardingCodesMatch(currentData.boardingCode, submittedCode)
      ) {
        throw new BoardingPolicyError(409, "Boarding authorization expired; ask the driver for the current code.");
      }
      const passengers = passengerManifest(currentData.passengers);
      const passengerStillExists = hasPassenger(passengers, user.uid);
      if (
        !passengerStillExists &&
        Object.keys(passengers).length >= MAX_PASSENGER_MANIFEST_ENTRIES
      ) {
        throw new BoardingPolicyError(
          409,
          "This ride is at capacity; no more passengers can join.",
        );
      }
      const existingPassenger = passengerStillExists ? passengers[user.uid] : undefined;
      if (!requiresProximity && !passengerStillExists) {
        throw new BoardingPolicyError(
          409,
          "Passenger membership changed; verify proximity and board again.",
        );
      }
      transaction.update(
        sessionRef,
        new FieldPath("passengers", user.uid),
        {
          userId: user.uid,
          userName,
          ...stopSelection,
          joinedAt: existingPassenger?.joinedAt ?? FieldValue.serverTimestamp(),
        },
        "updatedAt",
        FieldValue.serverTimestamp(),
        // Indexable membership mirror: privacy deletion queries array-contains
        // instead of the unindexable passengers.{uid}.userId map path
        // (issue #49 L3).
        "passengerIds",
        FieldValue.arrayUnion(user.uid),
      );
    });

    res.json({ joined: true, sessionId });
  } catch (error) {
    sendBoardingError(res, error, "Unable to join the ride.");
  }
});

/**
 * POST /api/sessions/:sessionId/messages
 *
 * Server-authoritative chat send. The client no longer writes messages or
 * rate-limit docs; the backend enforces membership, the 60/hr rolling rate
 * limit, the 3s gap, and the profanity filter before persisting.
 */
router.post("/:sessionId/messages", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const uid = req.user?.uid;
    if (!SAFE_ID.test(sessionId) || typeof uid !== "string") {
      res.status(400).json({ error: "Invalid session ID." });
      return;
    }

    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Invalid message." });
      return;
    }
    const bodyKeys = Object.keys(body);
    if (bodyKeys.some((key) => key !== "text" && key !== "requestId")) {
      res.status(400).json({ error: "Invalid message fields." });
      return;
    }
    const { text, requestId } = body;
    const normalizedText = typeof text === "string" ? text.trim() : "";
    if (
      !normalizedText ||
      normalizedText.length > 500 ||
      typeof requestId !== "string" ||
      !SAFE_REQUEST_ID.test(requestId)
    ) {
      res.status(400).json({ error: "Invalid message." });
      return;
    }

    const sessionRef = db.collection("ride_sessions").doc(sessionId);
    const rateRef = sessionRef
      .collection("messageRateLimits").doc(uid);
    const messageRef = sessionRef
      .collection("messages")
      .doc(stableHash(`${uid}\0${requestId}`));
    const requestHash = stableHash(normalizedText);

    const result = await db.runTransaction(async (transaction) => {
      const [session, rateSnap, existingMessage] = await transaction.getAll(
        sessionRef,
        rateRef,
        messageRef,
      );

      if (existingMessage.exists) {
        const previous = existingMessage.data();
        if (previous?.senderId !== uid || previous?.requestHash !== requestHash) {
          throw new ChatPolicyError(409, "Message request ID was already used.");
        }
        return { id: messageRef.id, duplicate: true };
      }

      const data = session.data();
      if (!session.exists || !data) {
        throw new ChatPolicyError(404, "Ride session was not found.");
      }
      if (!CHAT_STATUSES.has(String(data.status))) {
        throw new ChatPolicyError(409, "Chat is closed for this ride.");
      }

      const passengers = passengerManifest(data.passengers);
      const passengerEntry = hasPassenger(passengers, uid) ? passengers[uid] : undefined;
      const isPassenger = passengerEntry?.userId === uid;
      const userRole = req.user?.role;
      const isDriver =
        userRole === "driver" &&
        data.driverId === req.user?.driverId &&
        data.busId === req.user?.assignedBusId;
      const isAdmin = userRole === "admin" || req.user?.admin === true;
      if (!isPassenger && !isDriver && !isAdmin) {
        throw new ChatPolicyError(403, "You are not part of this ride.");
      }

      const from = isDriver || isAdmin ? "driver" : "passenger";
      const passengerName = passengerEntry?.userName;
      const tokenName = req.user?.name;
      const senderName = (
        from === "passenger" && typeof passengerName === "string" && passengerName.trim()
          ? passengerName.trim()
          : typeof tokenName === "string" && tokenName.trim()
            ? tokenName.trim()
            : isAdmin
              ? "Administrator"
              : from === "driver"
                ? "Operator"
                : "Passenger"
      ).slice(0, 100);

      const existing = rateSnap.data();
      const normalized = existing
        ? {
            sentAt: Array.isArray(existing.sentAt)
              ? existing.sentAt.map(valueToMillis).filter((value): value is number => value !== undefined)
              : undefined,
            lastSentAt: valueToMillis(existing.lastSentAt),
            windowStartedAt: valueToMillis(existing.windowStartedAt),
            count: typeof existing.count === "number" ? existing.count : undefined,
          }
        : undefined;

      const now = Date.now();
      const check = evaluateChatRate(normalized, now);
      if (!check.allowed) {
        throw new ChatPolicyError(
          429,
          check.reason === "hourly"
            ? "Rolling message limit reached."
            : "Please wait before sending another message.",
          check.retryAfterMs,
        );
      }

      transaction.set(rateRef, {
        userId: uid,
        sentAt: check.nextSentAt.map((timestamp) => new Date(timestamp)),
        lastSentAt: FieldValue.serverTimestamp(),
      });
      transaction.set(messageRef, {
        text: censorText(normalizedText),
        from,
        senderName,
        senderId: uid,
        requestHash,
        timestamp: FieldValue.serverTimestamp(),
      });
      return { id: messageRef.id, duplicate: false };
    });

    res.status(result.duplicate ? 200 : 201).json({ id: result.id, sent: true });
  } catch (error) {
    if (error instanceof ChatPolicyError) {
      if (error.status === 429 && error.retryAfterMs !== undefined) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
      }
      res.status(error.status).json({
        error: error.message,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      });
      return;
    }
    console.error("[Sessions] Failed to send message:", error);
    res.status(500).json({ error: "Unable to send message." });
  }
});

export default router;
