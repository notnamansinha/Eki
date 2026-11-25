/**
 * Live-data read failures come in two kinds that need different advice:
 * a permission denial (database rules or a missing authorization record) is
 * not fixed by reconnecting, while any other failure may be.
 */
export type LiveReadFailure = "permission_denied" | "unavailable";

/**
 * True for a Firebase permission denial. RTDB errors carry
 * `code: "PERMISSION_DENIED"` and a `permission_denied at /path: …` message;
 * Firestore uses `code: "permission-denied"`.
 */
export function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && /^permission[-_]denied$/i.test(code)) return true;
  return typeof message === "string" && /^permission_denied\b/i.test(message);
}

export function classifyLiveReadFailure(error: unknown): LiveReadFailure {
  return isPermissionDeniedError(error) ? "permission_denied" : "unavailable";
}

export type LiveDataStatus = "live" | "connecting" | "access_denied" | "read_failed";

/**
 * One answer for the admin live-data banners. A denied read never delivers a
 * snapshot, so `isResuming` stays true forever; while the socket is up that
 * is an access problem, not a reconnect.
 */
export function liveDataStatus({ isConnected, isResuming, readFailure }: {
  isConnected: boolean;
  isResuming: boolean;
  readFailure: LiveReadFailure | null;
}): LiveDataStatus {
  if (readFailure === "permission_denied" && isConnected) return "access_denied";
  if (isResuming) return "connecting";
  if (readFailure) return "read_failed";
  return "live";
}

export const ADMIN_LIVE_ACCESS_DENIED_MESSAGE =
  "Live vehicle updates are blocked: this account is not permitted to read live data. Check the database rules and this admin's authorization record, then reload.";
export const ADMIN_LIVE_READ_FAILED_MESSAGE =
  "Live vehicle updates are unavailable. Check your connection and reload to retry.";
export const PASSENGER_LIVE_ACCESS_DENIED_MESSAGE =
  "Live bus data is not available for this account right now. This is not a connection problem; please try again later.";

export function adminLiveReadFailureMessage(failure: LiveReadFailure): string {
  return failure === "permission_denied" ? ADMIN_LIVE_ACCESS_DENIED_MESSAGE : ADMIN_LIVE_READ_FAILED_MESSAGE;
}
