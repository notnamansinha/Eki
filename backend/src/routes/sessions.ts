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
const BOARDING_STATUSES = new Set(["armed", "active"]);

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    name?: string;
    driverId?: string;
    assignedBusId?: string;
  };
};

class BoardingPolicyError extends Error {
  constructor(public readonly status: number, message: string) {
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

    const { text, from, senderName } = req.body ?? {};
    if (
      typeof text !== "string" ||
      text.trim().length === 0 ||
      text.length > 500 ||
      typeof senderName !== "string" ||
      senderName.trim().length === 0 ||
      senderName.length > 100 ||
      (from !== "driver" && from !== "passenger")
    ) {
      res.status(400).json({ error: "Invalid message." });
      return;
    }

    const sessionRef = db.collection("ride_sessions").doc(sessionId);
    const session = await sessionRef.get();
    const data = session.data();
    if (!session.exists || !data) {
      res.status(404).json({ error: "Ride session was not found." });
      return;
    }

    const passengers = (data.passengers ?? {}) as Record<string, unknown>;
    const isPassenger =
      typeof passengers[uid] === "object" && passengers[uid] !== null;
    const userRole = req.user?.role;
    const isDriver = userRole === "driver" && data.driverId === req.user?.driverId;
    const isAdmin = userRole === "admin";

    // Membership gate mirrors the old rules: only session riders (passenger
    // role) or the session's own driver (or admin) may post.
    const allowedAsPassenger = isPassenger && from === "passenger";
    const allowedAsOperator = (isDriver || isAdmin) && from === "driver";
    if (!allowedAsPassenger && !allowedAsOperator) {
      res.status(403).json({ error: "You are not part of this ride." });
      return;
    }

    const rateRef = db
      .collection("ride_sessions").doc(sessionId)
      .collection("messageRateLimits").doc(uid);
    const now = Date.now();

    const rateDoc = await db.runTransaction(async (transaction) => {
      const rateSnap = await transaction.get(rateRef);
      const existing = rateSnap.data() as
        | { sentAt?: { toMillis: () => number }[]; lastSentAt?: { toMillis: () => number }; count?: number; windowStartedAt?: { toMillis: () => number } }
        | undefined;
      const normalized = existing
        ? {
            sentAt: Array.isArray(existing.sentAt)
              ? existing.sentAt.map((t) => t.toMillis())
              : undefined,
            lastSentAt: existing.lastSentAt?.toMillis(),
            windowStartedAt: existing.windowStartedAt?.toMillis(),
            count: existing.count,
          }
        : undefined;

      const check = evaluateChatRate(normalized, now);
      if (!check.allowed) {
        const rateError = new Error(
          check.reason === "hourly"
            ? "Rolling message limit reached."
            : "Please wait before sending another message.",
        ) as Error & { status?: number; retryAfterMs?: number };
        rateError.status = 429;
        rateError.retryAfterMs = check.retryAfterMs;
        throw rateError;
      }

      const messageRef = db
        .collection("ride_sessions").doc(sessionId)
        .collection("messages").doc();
      const sentAt = check.allowed ? check.nextSentAt : [];
      transaction.set(rateRef, {
        userId: uid,
        sentAt: sentAt.map((t) => new Date(t)),
        lastSentAt: FieldValue.serverTimestamp(),
      });
      transaction.set(messageRef, {
        text: censorText(text.trim()).slice(0, 500),
        from,
        senderName: senderName.trim().slice(0, 100) || (from === "driver" ? "Operator" : "Rider"),
        senderId: uid,
        timestamp: FieldValue.serverTimestamp(),
      });
      return messageRef.id;
    });

    res.status(201).json({ id: rateDoc, sent: true });
  } catch (error) {
    const rateError = error as { status?: number; retryAfterMs?: number; message?: string };
    if (rateError.status === 429) {
      res.status(429).json({ error: rateError.message, retryAfterMs: rateError.retryAfterMs });
      return;
    }
    console.error("[Sessions] Failed to send message:", error);
    res.status(500).json({ error: "Unable to send message." });
  }
});

export default router;
