import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../middleware/requireAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/firebaseAdmin";
import { evaluateFeedback } from "../services/feedbackService";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{16,128}$/;
const FEEDBACK_STATUSES = new Set(["new", "reviewed", "resolved"]);

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

class FeedbackPolicyError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
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

function hasManifestPassenger(value: unknown, uid: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const passengers = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(passengers, uid)) return false;
  const passenger = passengers[uid];
  return Boolean(
    passenger &&
    typeof passenger === "object" &&
    (passenger as { userId?: unknown }).userId === uid,
  );
}

/**
 * POST /api/feedback
 *
 * Server-authoritative, idempotent feedback submission. Eligibility, identity,
 * and the per-user cooldown are read in the same transaction as the writes.
 */
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (typeof uid !== "string") {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Invalid feedback payload." });
      return;
    }
    const allowedKeys = new Set([
      "type",
      "sessionId",
      "busId",
      "driverId",
      "rating",
      "comment",
      "requestId",
    ]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      res.status(400).json({ error: "Invalid feedback fields." });
      return;
    }

    const { type, sessionId, busId, driverId, rating, comment, requestId } = body;
    const kind = type === "ride" ? "ride" : type === "general" ? "general" : null;
    if (!kind || typeof requestId !== "string" || !SAFE_REQUEST_ID.test(requestId)) {
      res.status(400).json({ error: "Invalid feedback payload." });
      return;
    }
    if (rating !== null && rating !== undefined && typeof rating !== "number") {
      res.status(400).json({ error: "Rating must be numeric." });
      return;
    }
    if (comment !== undefined && typeof comment !== "string") {
      res.status(400).json({ error: "Comment must be text." });
      return;
    }
    if (
      kind === "ride" &&
      (
        typeof sessionId !== "string" || !SAFE_ID.test(sessionId) ||
        typeof busId !== "string" || !SAFE_ID.test(busId) ||
        typeof driverId !== "string" || !SAFE_ID.test(driverId)
      )
    ) {
      res.status(400).json({ error: "Ride feedback requires session, bus, and driver." });
      return;
    }

    const normalizedComment = typeof comment === "string" ? comment.trim() : "";
    const numericRating = rating === null || rating === undefined ? null : rating;
    const normalizedRide = kind === "ride"
      ? { sessionId: sessionId as string, busId: busId as string, driverId: driverId as string }
      : { sessionId: null, busId: null, driverId: null };
    const requestHash = stableHash(JSON.stringify({
      kind,
      ...normalizedRide,
      rating: numericRating,
      comment: normalizedComment,
    }));

    const cooldownRef = db.collection("feedbackCooldowns").doc(uid);
    const profileRef = db.collection("users").doc(uid);
    const feedbackRef = db
      .collection("feedbacks")
      .doc(stableHash(`${uid}\0${requestId}`));
    const sessionRef = kind === "ride"
      ? db.collection("ride_sessions").doc(normalizedRide.sessionId as string)
      : null;

    const outcome = await db.runTransaction(async (transaction) => {
      const snapshots = sessionRef
        ? await transaction.getAll(cooldownRef, profileRef, feedbackRef, sessionRef)
        : await transaction.getAll(cooldownRef, profileRef, feedbackRef);
      const [cooldownSnap, profileSnap, existingFeedback, sessionSnap] = snapshots;

      if (existingFeedback.exists) {
        const existing = existingFeedback.data();
        if (existing?.userId !== uid || existing?.requestHash !== requestHash) {
          throw new FeedbackPolicyError(409, "Feedback request ID was already used.");
        }
        return { submitted: true, duplicate: true } as const;
      }

      const sessionData = sessionSnap?.data();
      if (sessionRef && (!sessionSnap?.exists || !sessionData)) {
        throw new FeedbackPolicyError(404, "Ride session was not found.");
      }
      const rideContext = {
        isSessionPassenger: hasManifestPassenger(sessionData?.passengers, uid),
        sessionCompleted: sessionData?.status === "completed",
        busMatches: sessionData?.busId === normalizedRide.busId,
        driverMatches: sessionData?.driverId === normalizedRide.driverId,
      };
      const lastSubmittedMs = valueToMillis(cooldownSnap.data()?.lastSubmittedAt);
      const check = evaluateFeedback(
        kind,
        normalizedComment,
        numericRating,
        rideContext,
        lastSubmittedMs,
        Date.now(),
      );
      if (!check.allowed) return { submitted: false, check } as const;

      const profileName = profileSnap.data()?.displayName;
      const tokenName = req.user?.name;
      const userName = (
        typeof profileName === "string" && profileName.trim()
          ? profileName.trim()
          : typeof tokenName === "string" && tokenName.trim()
            ? tokenName.trim()
            : "Passenger"
      ).slice(0, 100);

      transaction.create(feedbackRef, {
        userId: uid,
        userName,
        type: kind,
        ...normalizedRide,
        rating: kind === "ride" ? numericRating : null,
        comment: normalizedComment,
        requestHash,
        timestamp: FieldValue.serverTimestamp(),
        status: "new",
      });
      transaction.set(cooldownRef, {
        userId: uid,
        lastSubmittedAt: FieldValue.serverTimestamp(),
      });
      return { submitted: true, duplicate: false } as const;
    });

    if (!outcome.submitted) {
      if (outcome.check.reason === "cooldown") {
        res.setHeader(
          "Retry-After",
          String(Math.max(1, Math.ceil(outcome.check.retryAfterMs / 1000))),
        );
        res.status(429).json({
          error: "Feedback limit reached.",
          retryAfterMs: outcome.check.retryAfterMs,
        });
        return;
      }
      const status = outcome.check.reason === "validation"
        ? 400
        : outcome.check.reason === "state"
          ? 409
          : 403;
      res.status(status).json({ error: outcome.check.message });
      return;
    }

    res.status(outcome.duplicate ? 200 : 201).json({ submitted: true });
  } catch (error) {
    if (error instanceof FeedbackPolicyError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("[Feedback] Failed to submit feedback:", error);
    res.status(500).json({ error: "Unable to submit feedback." });
  }
});

/** PATCH /api/feedback/:feedbackId/status — admin-only review workflow. */
router.patch("/:feedbackId/status", requireAdmin, async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const feedbackId = req.params.feedbackId;
  const body = req.body;
  const status = body?.status;
  if (
    !SAFE_ID.test(feedbackId) ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "status") ||
    typeof status !== "string" ||
    !FEEDBACK_STATUSES.has(status)
  ) {
    res.status(400).json({ error: "Invalid feedback status update." });
    return;
  }

  try {
    const feedbackRef = db.collection("feedbacks").doc(feedbackId);
    const changed = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(feedbackRef);
      if (!snapshot.exists) throw new FeedbackPolicyError(404, "Feedback was not found.");
      if (snapshot.data()?.status === status) return false;
      transaction.update(feedbackRef, {
        status,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: req.user?.uid ?? "admin",
      });
      return true;
    });
    res.json({ updated: changed, status });
  } catch (error) {
    if (error instanceof FeedbackPolicyError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("[Feedback] Failed to update status:", error);
    res.status(500).json({ error: "Unable to update feedback status." });
  }
});

export default router;
