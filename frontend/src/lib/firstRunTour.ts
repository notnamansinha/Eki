/*
 * The app tour runs once, after an account's first sign-in. Firebase records
 * when an account was created and when it last signed in; on the very first
 * sign-in the two match. A per-account flag in this browser then keeps the
 * tour from returning once it has been finished or skipped. Profile can replay
 * it at any time.
 */

const KEY_PREFIX = "eki:tour:v1:";
/** Creation and first sign-in are written together; allow for clock skew. */
const FIRST_SIGN_IN_WINDOW_MS = 60_000;
/** A long-lived session from before the tour existed is not a first sign-in. */
const NEW_ACCOUNT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SignInMetadata {
  creationTime?: string | null;
  lastSignInTime?: string | null;
}

/** True while the account is still on its first sign-in. */
export function isFirstSignIn(metadata: SignInMetadata | null | undefined, now = Date.now()): boolean {
  const created = Date.parse(metadata?.creationTime ?? "");
  const lastSignIn = Date.parse(metadata?.lastSignInTime ?? "");
  if (!Number.isFinite(created) || !Number.isFinite(lastSignIn)) return false;
  return Math.abs(lastSignIn - created) <= FIRST_SIGN_IN_WINDOW_MS && now - created <= NEW_ACCOUNT_MAX_AGE_MS;
}

export function hasSeenTour(uid: string): boolean {
  try { return window.localStorage.getItem(`${KEY_PREFIX}${uid}`) !== null; } catch { return false; }
}

export function markTourSeen(uid: string): void {
  try { window.localStorage.setItem(`${KEY_PREFIX}${uid}`, "done"); } catch { /* The tour simply offers itself again. */ }
}

/** Whether to start the tour by itself for this account. */
export function shouldAutoStartTour(uid: string, metadata: SignInMetadata | null | undefined, now = Date.now()): boolean {
  return isFirstSignIn(metadata, now) && !hasSeenTour(uid);
}
