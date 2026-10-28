/**
 * Browser estimate of the Firebase server clock.
 *
 * Live-bus freshness timestamps (`backendReceivedAt`, catalog receipts) are
 * stamped on the server timeline. Comparing them with a skewed device clock
 * would hide valid buses, so freshness checks use `serverNow()`, corrected by
 * the RTDB `.info/serverTimeOffset` estimate (see `serverClockSync.ts`).
 * Until an estimate arrives the offset is 0, i.e. the device clock.
 */

/** Larger values are treated as corrupt rather than as a real clock error. */
export const MAX_SERVER_TIME_OFFSET_MS = 366 * 24 * 60 * 60 * 1000;

let offsetMs = 0;

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function serverTimeOffsetMs(): number {
  return offsetMs;
}

/** Accepts only a finite, bounded offset; returns whether it was applied. */
export function setServerTimeOffset(value: unknown): boolean {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_SERVER_TIME_OFFSET_MS
  ) {
    return false;
  }
  offsetMs = value;
  return true;
}
