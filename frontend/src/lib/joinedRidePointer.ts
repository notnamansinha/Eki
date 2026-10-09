const KEY_PREFIX = "eki:joinedRide:";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A local hint only. Membership and stop choices must come from the server. */
export function readJoinedRidePointer(uid: string, now = Date.now()): string | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(`${KEY_PREFIX}${uid}`) ?? "null");
    if (!value || typeof value.sessionId !== "string" || !SAFE_ID.test(value.sessionId) ||
      typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt) ||
      now - value.savedAt < 0 || now - value.savedAt > MAX_AGE_MS) return null;
    return value.sessionId;
  } catch { return null; }
}

export function saveJoinedRidePointer(uid: string, sessionId: string): void {
  if (!SAFE_ID.test(sessionId)) return;
  try { window.localStorage.setItem(`${KEY_PREFIX}${uid}`, JSON.stringify({ sessionId, savedAt: Date.now() })); } catch { /* Boarding still works without storage. */ }
}

export function clearJoinedRidePointer(uid: string): void {
  try { window.localStorage.removeItem(`${KEY_PREFIX}${uid}`); } catch { /* Storage can be unavailable. */ }
}
