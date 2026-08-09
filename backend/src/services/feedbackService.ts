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
  | { allowed: false; reason: "validation"; message: string }
  | { allowed: false; reason: "state"; message: string }
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

  if (kind === "general") {
    if (!comment.trim() || wordCount > FEEDBACK_WORD_LIMIT || comment.length > FEEDBACK_COMMENT_MAX) {
      return { allowed: false, reason: "validation", message: "Comment is required and must be within limits." };
    }
  } else {
    if (wordCount > FEEDBACK_WORD_LIMIT || comment.length > FEEDBACK_COMMENT_MAX) {
      return { allowed: false, reason: "validation", message: "Comment exceeds the word or length limit." };
    }
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return { allowed: false, reason: "validation", message: "Rating must be an integer from 1 to 5." };
    }
    if (rating === null && !comment.trim()) {
      return { allowed: false, reason: "validation", message: "Rating or comment is required." };
    }
  }

  // Validate content before consulting cooldown state so malformed requests
  // consistently receive 400 instead of being masked as throttling failures.
  if (lastSubmittedAtMs !== undefined && now - lastSubmittedAtMs < FEEDBACK_COOLDOWN_MS) {
    return {
      allowed: false,
      reason: "cooldown",
      retryAfterMs: FEEDBACK_COOLDOWN_MS - (now - lastSubmittedAtMs),
    };
  }

  if (kind === "general") {
    return { allowed: true };
  }

  // Ride feedback authorization and lifecycle checks.
  if (!rideContext.isSessionPassenger) {
    return { allowed: false, reason: "eligibility", message: "Only passengers of this ride may review it." };
  }
  if (!rideContext.sessionCompleted) {
    return { allowed: false, reason: "state", message: "Ride feedback is available after the ride ends." };
  }
  if (!rideContext.busMatches || !rideContext.driverMatches) {
    return { allowed: false, reason: "eligibility", message: "Ride details do not match the session." };
  }
  return { allowed: true };
}
