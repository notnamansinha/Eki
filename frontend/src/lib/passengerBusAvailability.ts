import {
  devicePresence,
  isActiveBusEntry,
  rideServiceState,
} from "./activeBusEntries";

export interface PassengerBusAvailability {
  busId: string;
  routeId: string;
}

function busIdFromNodeKey(key: string, routeId: string): string | null {
  const suffix = `_${routeId}`;
  if (!key.endsWith(suffix)) return null;
  const busId = key.slice(0, -suffix.length).trim();
  return busId || null;
}

/**
 * Expose fresh hardware availability without inventing a ride, direction,
 * ETA, session, or passenger tracking marker.
 */
export function normalizePassengerBusAvailability(
  key: string,
  value: unknown,
  now = Date.now(),
): PassengerBusAvailability | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const routeId = typeof raw.routeId === "string" ? raw.routeId.trim() : "";
  if (!routeId) return null;
  const storedBusId = typeof raw.busId === "string" ? raw.busId.trim() : "";
  const busId = storedBusId || busIdFromNodeKey(key, routeId);
  if (!busId) return null;
  const candidate: Record<string, unknown> = { ...raw, busId, routeId };
  if (!isActiveBusEntry(candidate, now)) return null;
  if (
    devicePresence(candidate, now) !== "online" ||
    rideServiceState(candidate) !== "not_armed"
  ) {
    return null;
  }
  return { busId, routeId };
}

export function passengerBusAvailabilities(
  snapshot: Record<string, unknown> | null | undefined,
  now = Date.now(),
): PassengerBusAvailability[] {
  if (!snapshot) return [];
  return Object.entries(snapshot).flatMap(([key, value]) => {
    const bus = normalizePassengerBusAvailability(key, value, now);
    return bus ? [bus] : [];
  });
}
