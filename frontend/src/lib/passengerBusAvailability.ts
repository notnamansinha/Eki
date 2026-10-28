import { serverNow } from "./serverClock";
import {
  devicePresence,
  isActiveBusEntry,
  rideServiceState,
  type ActiveBusEntry,
} from "./activeBusEntries";

export interface PassengerBusAvailability extends ActiveBusEntry {
  busId: string;
  routeId: string;
  sessionId?: never;
  direction?: never;
  tripState?: never;
}

function busIdFromNodeKey(key: string, routeId: string): string | null {
  const suffix = `_${routeId}`;
  if (!key.endsWith(suffix)) return null;
  const busId = key.slice(0, -suffix.length).trim();
  return busId || null;
}

/**
 * Expose fresh hardware availability without inventing a ride, direction,
 * ETA or session. Location can be viewed before a ride is armed.
 */
export function normalizePassengerBusAvailability(
  key: string,
  value: unknown,
  now = serverNow(),
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
  // Leftover lifecycle fields must not unlock ride actions or route matching.
  return {
    busId, routeId,
    lat: candidate.lat, lng: candidate.lng,
    heading: candidate.heading, speed: candidate.speed,
    timestamp: candidate.timestamp,
    backendReceivedAt: candidate.backendReceivedAt,
    receivedAt: candidate.receivedAt,
    seq: candidate.seq,
    deviceState: "online",
    motionState: candidate.motionState,
    rawLocation: candidate.rawLocation,
  };
}

export function passengerBusAvailabilities(
  snapshot: Record<string, unknown> | null | undefined,
  now = serverNow(),
): PassengerBusAvailability[] {
  if (!snapshot) return [];
  return Object.entries(snapshot).flatMap(([key, value]) => {
    const bus = normalizePassengerBusAvailability(key, value, now);
    return bus ? [bus] : [];
  });
}

/**
 * Presence ticks re-derive availability every few seconds. Keep the previous
 * array when every entry is field-for-field identical so an unchanged fleet
 * does not re-render the passenger workspace and map.
 */
export function reuseUnchangedAvailabilities(
  previous: PassengerBusAvailability[],
  next: PassengerBusAvailability[],
): PassengerBusAvailability[] {
  if (previous.length !== next.length) return next;
  return next.every((bus, index) => {
    const prior = previous[index] as unknown as Record<string, unknown>;
    const entries = Object.entries(bus);
    return entries.length === Object.keys(prior).length &&
      entries.every(([field, value]) => Object.is(prior[field], value));
  }) ? previous : next;
}
