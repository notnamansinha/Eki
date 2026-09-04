/**
 * Pure helpers for route-save concurrency (#1, #3) and directional geometry
 * metadata validation (#7). Kept dependency-free so they can be unit-tested
 * in isolation from Firestore/Google mocks.
 */

/** Monotonic route revision; 0 for legacy documents that never recorded one. */
export function routeRevisionValue(value: Record<string, unknown> | undefined): number {
  const revision = value?.revision;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision > 0
    ? revision
    : 0;
}

/** Monotonic ride-start generation; 0 when no ride has started since v0. */
export function routeGenerationValue(value: Record<string, unknown> | undefined): number {
  const generation = value?.rideStartGeneration;
  return typeof generation === "number" && Number.isSafeInteger(generation) && generation > 0
    ? generation
    : 0;
}

/**
 * Decide whether a route save must be rejected as a conflict.
 *
 * For `edit`, a conflict means either (a) another admin advanced the route
 * after we snapshotted it (lost-update/stale-write, #3), or (b) a ride STARTED
 * between our (empty) active-rides check and the write, bumping the ride-start
 * generation (#1) — the race that let active routes be edited.
 *
 * `mode` must already be validated as "create" or "edit" by the caller.
 */
export function routeSaveIsConflict(
  mode: "create" | "edit",
  liveData: Record<string, unknown> | undefined,
  expected: {
    revision: number;
    rideStartGeneration: number;
  },
): boolean {
  if (mode === "create") {
    // A create conflict is simply that the route already exists; callers keep
    // the presence/idempotency check separate. Nothing to compare otherwise.
    return false;
  }
  return (
    routeRevisionValue(liveData) !== expected.revision ||
    routeGenerationValue(liveData) !== expected.rideStartGeneration
  );
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * A HIGH_QUALITY cached route must carry complete directional distance and
 * duration metadata, not just two valid encoded polylines (#7). Serving
 * malformed metadata makes the client render a broken route map.
 */
export function validDirectionalMetadata(route: Record<string, unknown>): boolean {
  return (
    finiteNonNegative(route.distanceMeters) &&
    finiteNonNegative(route.forwardDistanceMeters) &&
    finiteNonNegative(route.reverseDistanceMeters) &&
    nonEmptyString(route.duration) &&
    nonEmptyString(route.forwardDuration) &&
    nonEmptyString(route.reverseDuration)
  );
}

/**
 * Full-precision equality for two Firestore Timestamps. Comparing with
 * `toMillis()` loses sub-millisecond precision, which let two concurrent
 * edits within the same millisecond bypass the stale-write check (#3).
 */
export function sameFirestoreTimestamp(
  a: unknown,
  b: unknown,
): boolean {
  if (!a || !b) return a === b;
  const ta = a as { seconds?: unknown; nanoseconds?: unknown };
  const tb = b as { seconds?: unknown; nanoseconds?: unknown };
  return ta.seconds === tb.seconds && ta.nanoseconds === tb.nanoseconds;
}