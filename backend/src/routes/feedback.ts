import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/firebaseAdmin";
import {
  evaluateFeedback,
  FEEDBACK_COOLDOWN_MS,
} from "../services/feedbackService";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    driverId?: string;
    assignedBusId?: string;
  };
};

router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (typeof uid !== "string") {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const { type, sessionId, busId, driverId, rating, comment, userName } = req.body ?? {};
    const kind = type === "ride" ? "ride" : type === "general" ? "general" : null;
    const submittedName = typeof userName === "string" ? userName.trim().slice(0, 100) : "";

    if (!kind || !submittedName) {
      res.status(400).json({ error: "Invalid feedback payload." });
      return;
    }

    const cooldownRef = db.collection("feedbackCooldowns").doc(uid);
    const cooldownSnap = await cooldownRef.get();
    const lastSubmittedAt = cooldownSnap.data()?.lastSubmittedAt;
    const lastSubmittedMs =
      lastSubmittedAt && typeof lastSubmittedAt.toMillis === "function"
        ? lastSubmittedAt.toMillis()
        : undefined;

    let rideContext = {
      isSessionPassenger: false,
      sessionCompleted: false,
      busMatches: false,
      driverMatches: false,
    };

    if (kind === "ride") {
      if (
        typeof sessionId !== "string" || !SAFE_ID.test(sessionId) ||
        typeof busId !== "string" || !SAFE_ID.test(busId) ||
        typeof driverId !== "string" || !SAFE_ID.test(driverId)
      ) {
        res.status(400).json({ error: "Ride feedback requires session, bus, and driver." });
        return;
      }
      const sessionSnap = await db.collection("ride_sessions").doc(sessionId).get();
      const data = sessionSnap.data();
      if (!sessionSnap.exists || !data) {
        res.status(404).json({ error: "Ride session was not found." });
        return;
      }
      const passengers = (data.passengers ?? {}) as Record<string, unknown>;
      rideContext = {
        isSessionPassenger:
          typeof passengers[uid] === "object" && passengers[uid] !== null,
        sessionCompleted: data.status === "completed",
        busMatches: data.busId === busId,
        driverMatches: data.driverId === driverId,
      };
    }

    const numericRating =
      rating === null || rating === undefined ? null : Number(rating);
    const check = evaluateFeedback(
      kind,
      typeof comment === "string" ? comment : "",
      numericRating,
      rideContext,
      lastSubmittedMs,
      Date.now(),
    );

    if (!check.allowed) {
      if (check.reason === "cooldown") {
        res.status(429).json({ error: "Feedback limit reached.", retryAfterMs: check.retryAfterMs });
        return;
      }
      res.status(403).json({ error: check.message });
      return;
    }

    await db.runTransaction(async (transaction) => {
      const feedbackRef = db.collection("feedbacks").doc();
      transaction.set(feedbackRef, {
        userId: uid,
        userName: submittedName || "Rider",
        type: kind,
        sessionId: kind === "ride" ? sessionId : null,
        busId: kind === "ride" ? busId : null,
        driverId: kind === "ride" ? driverId : null,
        rating: kind === "ride" && numericRating ? numericRating : null,
        comment: typeof comment === "string" ? comment.trim().slice(0, 2000) : "",
        timestamp: FieldValue.serverTimestamp(),
        status: "new",
      });
      transaction.set(cooldownRef, {
        userId: uid,
        lastSubmittedAt: FieldValue.serverTimestamp(),
      });
    });

    res.status(201).json({ submitted: true });
  } catch (error) {
    console.error("[Feedback] Failed to submit feedback:", error);
    res.status(500).json({ error: "Unable to submit feedback." });
  }
});

export default router;

// Re-export for tests that assert cooldown semantics at the service level.
export { FEEDBACK_COOLDOWN_MS };
