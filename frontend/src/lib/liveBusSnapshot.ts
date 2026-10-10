import { BUS_EXPIRY_MS, isLiveBusTimestamp, liveBusFreshnessTimestamp } from "./liveBusFreshness";

export type LiveBusSnapshot = Record<string, Record<string, unknown>>;

// A live ride survives a short telemetry outage, but a permanently orphaned
// RTDB node must eventually leave the map even if no further event arrives.
export const ACTIVE_RIDE_RETENTION_MS = 24 * 60 * 60 * 1000;

export function isActiveRideSnapshot(
  bus: Record<string, unknown>,
): boolean {
  return (
    bus.status === "active" &&
    typeof bus.sessionId === "string" &&
    (bus.tripState === "pre_departure" ||
      bus.tripState === "in_service")
  );
}

export function pruneExpiredLiveBuses(
  snapshot: LiveBusSnapshot,
  now = Date.now(),
): LiveBusSnapshot {
  let changed = false;
  const freshEntries = Object.entries(snapshot).filter(([, bus]) => {
    if (bus.tripState === "completed") {
      changed = true;
      return false;
    }
    const fresh = isLiveBusTimestamp(
      liveBusFreshnessTimestamp(bus),
      now,
    );
    const timestamp = liveBusFreshnessTimestamp(bus);
    const activeAge = typeof timestamp === "number" ? now - timestamp : NaN;
    const retain = fresh || (
      isActiveRideSnapshot(bus) &&
      Number.isFinite(activeAge) &&
      activeAge >= -10_000 &&
      activeAge < ACTIVE_RIDE_RETENTION_MS
    );
    if (!retain) changed = true;
    return retain;
  });
  return changed ? Object.fromEntries(freshEntries) : snapshot;
}

export function millisecondsUntilNextPrune(
  snapshot: LiveBusSnapshot,
  now = Date.now(),
): number | null {
  let nextDelay = Number.POSITIVE_INFINITY;
  for (const bus of Object.values(snapshot)) {
    if (bus.tripState === "completed") return 0;
    const timestamp = liveBusFreshnessTimestamp(bus);
    if (
      typeof timestamp !== "number" ||
      !Number.isFinite(timestamp) ||
      timestamp > now + 10_000
    ) {
      return 0;
    }
    const retentionMs = isActiveRideSnapshot(bus)
      ? ACTIVE_RIDE_RETENTION_MS
      : BUS_EXPIRY_MS;
    nextDelay = Math.min(nextDelay, timestamp + retentionMs - now);
  }
  return Number.isFinite(nextDelay)
    ? Math.max(0, Math.ceil(nextDelay))
    : null;
}
