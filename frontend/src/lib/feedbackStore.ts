import {
  collection, doc, getDocsFromServer, limit, orderBy, query,
  runTransaction, serverTimestamp, updateDoc,
} from "firebase/firestore";
import { auth } from "@/lib/firebaseAuth";
import { db } from "@/lib/firebaseFirestore";
import { getAuthVerificationGeneration } from "./authState";
import { FEEDBACK_WORD_LIMIT } from "@/config/passenger";
import { isFeedbackList, normalizeFeedbackEntry, type FeedbackEntry } from "./feedback";

const ONE_DAY_MS = 86_400_000;

export class FeedbackError extends Error {
  constructor(message: string, public readonly status = 400, public readonly retryAfterMs?: number) {
    super(message);
  }
}

export function feedbackErrorMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "permission-denied") return "Feedback access was denied. Check your account and ride eligibility, then retry.";
  if (code === "unauthenticated") return "Please sign in again to access feedback.";
  if (code === "unavailable" || code === "deadline-exceeded") return "Could not connect to Firestore. Check your internet connection and retry.";
  return error instanceof Error && !code ? error.message : fallback;
}

function currentIdentity(uid: string, generation: number) {
  if (auth.currentUser?.uid !== uid || getAuthVerificationGeneration() !== generation) {
    throw new FeedbackError("Your account changed. Sign in again and retry.", 401);
  }
}

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export interface FeedbackSubmission {
  type: "general" | "ride";
  sessionId?: string;
  busId?: string;
  driverId?: string;
  rating: number | null;
  comment: string;
}

/** Atomic, idempotent writes; Firestore rules enforce the same policy without Express. */
export async function submitFeedback(uid: string, input: FeedbackSubmission, requestId: string) {
  const generation = getAuthVerificationGeneration();
  currentIdentity(uid, generation);
  const ride = input.type === "ride";
  const comment = input.comment.trim();
  if (comment.length > 2000 || (comment.match(/\S+/g)?.length ?? 0) > FEEDBACK_WORD_LIMIT ||
      (!comment && (!ride || input.rating === null))) throw new FeedbackError("Please add feedback within the word and character limits.");
  if (ride && (!input.sessionId || !input.busId || !input.driverId)) throw new FeedbackError("Ride feedback requires a completed ride, bus, and driver.");
  if (ride && input.rating !== null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) throw new FeedbackError("Rating must be between 1 and 5.");
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new FeedbackError("Invalid feedback request.");
  const normalized = {
    kind: input.type,
    sessionId: ride ? input.sessionId! : null,
    busId: ride ? input.busId! : null,
    driverId: ride ? input.driverId! : null,
    rating: ride ? input.rating : null,
    comment,
  };
  // Match the existing API's IDs and hashes so in-flight retries remain compatible.
  const [feedbackId, requestHash] = await Promise.all([
    hash(`${uid}\0${requestId}`), hash(JSON.stringify(normalized)),
  ]);
  const feedbackRef = doc(db, "feedbacks", feedbackId);
  const cooldownRef = doc(db, "feedbackCooldowns", uid);
  const profileRef = doc(db, "users", uid);
  // Device-clock age of the stored server cooldown stamp; the rules alone use server time.
  let cooldownAgeMs: number | undefined;
  try {
    await runTransaction(db, async transaction => {
      cooldownAgeMs = undefined;
      currentIdentity(uid, generation);
      const [existing, cooldown, profile] = await Promise.all([
        transaction.get(feedbackRef), transaction.get(cooldownRef), transaction.get(profileRef),
      ]);
      currentIdentity(uid, generation);
      if (!profile.exists()) throw new FeedbackError("An active profile is required to send feedback.", 403);
      if (existing.exists()) {
        if (existing.data().userId !== uid || existing.data().requestHash !== requestHash) throw new FeedbackError("This feedback request was already used. Please submit again.", 409);
        return;
      }
      const stamp = cooldown.data()?.lastSubmittedAt;
      const lastSubmittedAt = typeof stamp === "number" ? stamp : stamp?.toMillis?.();
      cooldownAgeMs = Number.isFinite(lastSubmittedAt) ? Date.now() - lastSubmittedAt : undefined;
      // A device clock behind the server's own stamp is skewed: skip the estimate and let the rules decide.
      if (cooldownAgeMs !== undefined && cooldownAgeMs >= 0 && cooldownAgeMs < ONE_DAY_MS) {
        throw new FeedbackError("Feedback limit reached.", 429, ONE_DAY_MS - cooldownAgeMs);
      }
      const name = profile.data()?.displayName;
      transaction.set(feedbackRef, {
        userId: uid,
        userName: typeof name === "string" && name.trim() && name.length <= 100 ? name : "Passenger",
        type: normalized.kind,
        sessionId: normalized.sessionId, busId: normalized.busId, driverId: normalized.driverId,
        rating: normalized.rating, comment, requestHash,
        timestamp: serverTimestamp(), status: "new",
    });
    transaction.set(cooldownRef, { userId: uid, feedbackId, lastSubmittedAt: serverTimestamp() });
    });
  } catch (error) {
    // A device clock that runs ahead passes the estimate above, so the rules' server-time
    // cooldown is what denies the write. Report that as a cooldown rather than an access problem.
    if ((error as { code?: string } | null)?.code === "permission-denied" &&
        cooldownAgeMs !== undefined && cooldownAgeMs < 2 * ONE_DAY_MS) {
      throw new FeedbackError("Feedback limit reached.", 429);
    }
    throw error;
  }
  currentIdentity(uid, generation);
}

export async function loadFeedback(): Promise<FeedbackEntry[]> {
  // A retry must reach Firestore, never silently return a stale cached list.
  const snapshot = await getDocsFromServer(query(collection(db, "feedbacks"), orderBy("timestamp", "desc"), limit(200)));
  const result = { feedbacks: snapshot.docs.map(document => normalizeFeedbackEntry(document.id, document.data())) };
  if (!isFeedbackList(result)) throw new Error("Firestore returned invalid feedback data. Please retry.");
  return result.feedbacks;
}

export async function updateFeedbackStatus(uid: string, id: string, status: FeedbackEntry["status"]) {
  const generation = getAuthVerificationGeneration();
  currentIdentity(uid, generation);
  await updateDoc(doc(db, "feedbacks", id), { status, reviewedAt: serverTimestamp(), reviewedBy: uid });
}
