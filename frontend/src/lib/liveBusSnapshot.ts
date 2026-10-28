import { BUS_EXPIRY_MS, liveBusFreshnessTimestamp } from "./liveBusFreshness";
import { serverNow } from "./serverClock";

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

function hasExpired(bus: Record<string, unknown>, now: number): boolean {
  if (bus.tripState === "completed") return true;
  const timestamp = liveBusFreshnessTimestamp(bus);
  return typeof timestamp !== "number" || !Number.isFinite(timestamp) ||
    now - timestamp >= BUS_EXPIRY_MS;
}

/**
 * Passenger-scope expiry. An offline ride is hidden exactly like an offline
 * device, so every entry leaves with its telemetry; the server still retains
 * the ride for recovery. The admin fleet store does not prune at all.
 * An entry that looks future-stamped is kept: the viewer clock may lag the
 * server, and the passenger normalizers already hide it until it is in range.
 */
export function pruneExpiredLiveBuses(
  snapshot: LiveBusSnapshot,
  now = serverNow(),
): LiveBusSnapshot {
  let changed = false;
  const freshEntries = Object.entries(snapshot).filter(([, bus]) => {
    const retain = !hasExpired(bus, now);
    if (!retain) changed = true;
    return retain;
  });
  return changed ? Object.fromEntries(freshEntries) : snapshot;
}

export function millisecondsUntilNextPrune(
  snapshot: LiveBusSnapshot,
  now = serverNow(),
): number | null {
  let nextDelay = Number.POSITIVE_INFINITY;
  for (const bus of Object.values(snapshot)) {
    if (hasExpired(bus, now)) return 0;
    const timestamp = liveBusFreshnessTimestamp(bus) as number;
    nextDelay = Math.min(nextDelay, timestamp + BUS_EXPIRY_MS - now);
  }
  return Number.isFinite(nextDelay)
    ? Math.max(0, Math.ceil(nextDelay))
    : null;
}
