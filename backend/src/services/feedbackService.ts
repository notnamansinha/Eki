/**
 * Server-side feedback eligibility + 24h cooldown enforcement. The backend is
 * now the only writer of feedback and cooldown docs, so the checks that used
 * to live in Firestore rules (and could be bypassed) are enforced here.
 */

export const FEEDBACK_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const FEEDBACK_WORD_LIMIT = 200;
export const FEEDBACK_COMMENT_MAX = 2000;

export type FeedbackKind = "ride" | "general";

export interface RideContext {
  /** User is in the session's passenger manifest. */
  isSessionPassenger: boolean;
  /** Session status is completed (ride feedback only). */
  sessionCompleted: boolean;
  /** Submitted busId matches the session's busId. */
  busMatches: boolean;
  /** Submitted driverId matches the session's driverId. */
  driverMatches: boolean;
}

export type FeedbackCheck =
  | { allowed: true }
  | { allowed: false; reason: "cooldown"; retryAfterMs: number }
  | { allowed: false; reason: "eligibility"; message: string };

/**
 * Validates a feedback submission server-side.
 *
 * @param kind ride or general
 * @param comment raw comment text
 * @param rating 1..5 (ride only), or null
 * @param rideContext eligibility facts for ride feedback (ignored for general)
 * @param lastSubmittedAtMs last cooldown timestamp, or undefined
 * @param now current epoch millis
 */
export function evaluateFeedback(
  kind: FeedbackKind,
  comment: string,
  rating: number | null,
  rideContext: RideContext,
  lastSubmittedAtMs: number | undefined,
  now: number,
): FeedbackCheck {
  const wordCount = comment.trim().match(/\S+/g)?.length ?? 0;

  if (lastSubmittedAtMs !== undefined && now - lastSubmittedAtMs < FEEDBACK_COOLDOWN_MS) {
    return {
      allowed: false,
      reason: "cooldown",
      retryAfterMs: FEEDBACK_COOLDOWN_MS - (now - lastSubmittedAtMs),
    };
  }

  if (kind === "general") {
    if (!comment.trim() || wordCount > FEEDBACK_WORD_LIMIT || comment.length > FEEDBACK_COMMENT_MAX) {
      return { allowed: false, reason: "eligibility", message: "Comment is required and must be within limits." };
    }
    return { allowed: true };
  }

  // ride feedback
  if (wordCount > FEEDBACK_WORD_LIMIT || comment.length > FEEDBACK_COMMENT_MAX) {
    return { allowed: false, reason: "eligibility", message: "Comment exceeds the word or length limit." };
  }
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return { allowed: false, reason: "eligibility", message: "Rating must be an integer from 1 to 5." };
  }
  if (rating === null && !comment.trim()) {
    return { allowed: false, reason: "eligibility", message: "Rating or comment is required." };
  }
  if (!rideContext.isSessionPassenger) {
    return { allowed: false, reason: "eligibility", message: "Only passengers of this ride may review it." };
  }
  if (!rideContext.sessionCompleted) {
    return { allowed: false, reason: "eligibility", message: "Ride feedback is available after the ride ends." };
  }
  if (!rideContext.busMatches || !rideContext.driverMatches) {
    return { allowed: false, reason: "eligibility", message: "Ride details do not match the session." };
  }
  return { allowed: true };

  /**
 * POST /api/feedback
 *
 * Server-authoritative feedback submission. The client no longer writes
 * feedback or cooldown docs; the backend enforces the 24h cooldown, the
 * ride/general shape, and ride eligibility (manifest membership + completed
 * session + matching bus/driver) before persisting.
 */
}
