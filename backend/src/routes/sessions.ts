import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { db, rtdb } from "../lib/firebaseAdmin";
import { haversineMeters } from "../lib/geo";
import {
  evaluateChatRate,
  censorText,
} from "../services/chatRateLimit";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
// A passenger must be within this distance of the hardware-reported bus
// position to board. Browser GPS is typically 10–50 m accurate; the bus fix
// is hardware GNSS, so 150 m firmly excludes remote joins while tolerating
// stop-side GPS scatter.
const JOIN_RADIUS_M = 150;
const MAX_JOIN_FIX_AGE_MS = 60_000;

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    driverId?: string;
    assignedBusId?: string;
  };
};

/**
 * POST /api/sessions/:sessionId/join
 *
 * Server-issued boarding join (SEC: closes the passenger self-join gap).
 * The manifest write is backend-authoritative: the client never writes to
 * ride_sessions. The backend only joins a passenger after verifying they are
 * physically near the bus, using the ESP32 GNSS fix already trusted by the
 * telemetry pipeline — never a client-supplied position.
 */
router.post("/:sessionId/join", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const uid = req.user?.uid;
    if (!SAFE_ID.test(sessionId) || typeof uid !== "string") {
      res.status(400).json({ error: "Invalid session ID." });
      return;
    }

    const { lat, lng, boardingStopId, alightingStopId, userName } = req.body ?? {};
    const hasPosition =
      typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
      typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
    const validStops =
      typeof boardingStopId === "string" && boardingStopId.length > 0 && boardingStopId.length <= 128 &&
      (alightingStopId == null ||
        (typeof alightingStopId === "string" && alightingStopId.length > 0 && alightingStopId.length <= 128));
    const validName = typeof userName === "string" && userName.length > 0 && userName.length <= 100;

    const sessionRef = db.collection("ride_sessions").doc(sessionId);
    const session = await sessionRef.get();
    const data = session.data();
    if (!session.exists || !data) {
      res.status(404).json({ error: "Ride session was not found." });
      return;
    }
    if (!["armed", "active"].includes(String(data.status))) {
      res.status(409).json({ error: "This ride is no longer boarding." });
      return;
    }
    const busId = typeof data.busId === "string" ? data.busId : "";
    const routeId = typeof data.routeId === "string" ? data.routeId : "";
    if (!busId || !routeId) {
      res.status(422).json({ error: "This session has no active vehicle." });
      return;
    }

    const passengers = (data.passengers ?? {}) as Record<string, unknown>;
    const alreadyJoined =
      typeof passengers[uid] === "object" && passengers[uid] !== null;

    if (!validStops || !validName || (!alreadyJoined && !hasPosition)) {
      res.status(400).json({ error: "Invalid boarding details." });
      return;
    }

    if (!alreadyJoined) {
      // Proximity gate uses the ESP32 GNSS fix, not the client's location.
      const live = (
        await rtdb.ref(`activeBuses/${busId}_${routeId}`).once("value")
      ).val() as Record<string, unknown> | null;
      const fixTimestamp = Number(live?.timestamp);
      const busLat = Number(live?.lat);
      const busLng = Number(live?.lng);
      if (
        !Number.isFinite(busLat) ||
        !Number.isFinite(busLng) ||
        !Number.isFinite(fixTimestamp) ||
        Date.now() - fixTimestamp > MAX_JOIN_FIX_AGE_MS
      ) {
        res.status(409).json({
          error: "The bus position is unavailable right now; please try again.",
        });
        return;
      }
      const distanceM = haversineMeters(
        { lat: Number(lat), lng: Number(lng) },
        { lat: busLat, lng: busLng },
      );
      if (distanceM > JOIN_RADIUS_M) {
        res.status(403).json({ error: "You must be near the bus to board." });
        return;
      }
    }

    await sessionRef.update({
      [`passengers.${uid}`]: {
        userId: uid,
        userName,
        boardingStopId,
        alightingStopId: alightingStopId ?? null,
        joinedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.json({ joined: true, sessionId });
  } catch (error) {
    console.error("[Sessions] Failed to join ride:", error);
    res.status(500).json({ error: "Unable to join the ride." });
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
