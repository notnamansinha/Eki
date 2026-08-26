import { BUS_EXPIRY_MS, isLiveBusTimestamp } from "./liveBusFreshness";

export type LiveBusSnapshot = Record<string, Record<string, unknown>>;

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
      typeof bus.timestamp === "number" ? bus.timestamp : undefined,
      now,
    );
    const retain = fresh || isActiveRideSnapshot(bus);
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
    if (isActiveRideSnapshot(bus)) continue;
    const timestamp = bus.timestamp;
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
