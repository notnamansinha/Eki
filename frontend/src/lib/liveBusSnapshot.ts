import { BUS_EXPIRY_MS, isLiveBusTimestamp, liveBusFreshnessTimestamp } from "./liveBusFreshness";

export type LiveBusSnapshot = Record<string, Record<string, unknown>>;

export function isActiveRideSnapshot(
  bus: Record<string, unknown>,
): boolean {
  return (
    bus.status === "active" &&
    typeof bus.sessionId === "string" && bus.sessionId.length > 0 &&
    (bus.tripState === "pre_departure" ||
      bus.tripState === "in_service")
  );
}

/**
 * Passenger-scope expiry. An offline ride is hidden exactly like an offline
 * device, so every entry leaves with its telemetry; the server still retains
 * the ride for recovery. The admin fleet store does not prune at all.
 */
export function pruneExpiredLiveBuses(
  snapshot: LiveBusSnapshot,
  now = Date.now(),
): LiveBusSnapshot {
  let changed = false;
  const freshEntries = Object.entries(snapshot).filter(([, bus]) => {
    const retain = bus.tripState !== "completed" &&
      isLiveBusTimestamp(liveBusFreshnessTimestamp(bus), now);
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
    nextDelay = Math.min(nextDelay, timestamp + BUS_EXPIRY_MS - now);
  }
  return Number.isFinite(nextDelay)
    ? Math.max(0, Math.ceil(nextDelay))
    : null;
}
