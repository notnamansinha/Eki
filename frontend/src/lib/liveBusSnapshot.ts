import { isLiveBusTimestamp } from "./liveBusFreshness";

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
