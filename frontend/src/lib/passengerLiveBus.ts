import { isActiveBusEntry, type ActiveBusEntry } from "./activeBusEntries";
import { hasValidBusCoordinates } from "./liveBusFreshness";

export interface PassengerLiveBus extends ActiveBusEntry {
  busId: string;
  routeId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  timestamp: number;
  deviceState: "online" | "offline";
  tripState: "pre_departure" | "in_service" | "completed";
  motionState: "moving" | "stopped" | "uncertain";
  status?: "active" | "offline";
}

function busIdFromNodeKey(key: string, routeId: string): string | null {
  const suffix = `_${routeId}`;
  if (!key.endsWith(suffix)) return null;
  const busId = key.slice(0, -suffix.length).trim();
  return busId.length > 0 ? busId : null;
}

/**
 * Convert one untrusted RTDB value into the single shape shared by the
 * passenger route list and map. A fresh device-only node is visible without a
 * session; a stale node is retained only while its ride is active.
 */
export function normalizePassengerLiveBus(
  key: string,
  value: unknown,
  now = Date.now(),
): PassengerLiveBus | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const routeId = typeof raw.routeId === "string" ? raw.routeId.trim() : "";
  if (!routeId) return null;

  const storedBusId = typeof raw.busId === "string" ? raw.busId.trim() : "";
  const busId = storedBusId || busIdFromNodeKey(key, routeId);
  if (!busId) return null;

  const candidate: Record<string, unknown> = { ...raw, busId, routeId };
  if (
    !isActiveBusEntry(candidate, now) ||
    !hasValidBusCoordinates(candidate.lat, candidate.lng)
  ) {
    return null;
  }

  return {
    ...candidate,
    busId,
    routeId,
    lat: candidate.lat as number,
    lng: candidate.lng as number,
    heading: typeof candidate.heading === "number" ? candidate.heading : 0,
    speed: typeof candidate.speed === "number" ? candidate.speed : 0,
    timestamp: typeof candidate.timestamp === "number" ? candidate.timestamp : 0,
    deviceState:
      candidate.deviceState === "online" ? "online" : "offline",
    tripState:
      candidate.tripState === "in_service"
        ? "in_service"
        : candidate.tripState === "completed"
          ? "completed"
          : "pre_departure",
    motionState:
      candidate.motionState === "moving" || candidate.motionState === "stopped"
        ? candidate.motionState
        : "uncertain",
    status:
      candidate.status === "active" || candidate.status === "offline"
        ? candidate.status
        : undefined,
  };
}

export function passengerLiveBuses(
  snapshot: Record<string, unknown> | null | undefined,
  now = Date.now(),
): PassengerLiveBus[] {
  if (!snapshot) return [];
  return Object.entries(snapshot).flatMap(([key, value]) => {
    const bus = normalizePassengerLiveBus(key, value, now);
    return bus ? [bus] : [];
  });
}

export type PassengerTripState =
  | "pre_departure"
  | "in_service"
  | "completed";

/** Completed rides are no longer visible, but their terminal state still has
 * to reach joined-passenger feedback and ride-finalization logic. */
export function passengerTripStates(
  snapshot: Record<string, unknown> | null | undefined,
): Map<string, PassengerTripState> {
  const states = new Map<string, PassengerTripState>();
  if (!snapshot) return states;
  for (const value of Object.values(snapshot)) {
    if (typeof value !== "object" || value === null) continue;
    const bus = value as Record<string, unknown>;
    if (typeof bus.sessionId !== "string" || bus.sessionId.length === 0) continue;
    if (
      bus.tripState !== "pre_departure" &&
      bus.tripState !== "in_service" &&
      bus.tripState !== "completed"
    ) {
      continue;
    }
    states.set(bus.sessionId, bus.tripState);
  }
  return states;
}

export function passengerLiveBusSelectionKey(bus: PassengerLiveBus): string {
  return typeof bus.sessionId === "string" && bus.sessionId.length > 0
    ? `session:${bus.sessionId}`
    : `bus:${bus.routeId}:${bus.busId}`;
}

/**
 * Decide whether the bus-switching control should be locked.
 *
 * A traveler may always switch between the buses on a route EXCEPT when the
 * bus they joined is already direction-confirmed (in_service). While a joined
 * bus still has a pending direction (armed / pre_departure, awaiting its first
 * stop) the switcher stays open, so a direction-confirmed bus on the same
 * route remains reachable (finding #5). Returns false when there is nothing to
 * switch to (≤1 bus).
 */
export function shouldLockBusSelector(params: {
  busCount: number;
  selectedSessionId?: string;
  trackedSessionId?: string;
  selectedTripState?: PassengerTripState;
}): boolean {
  if (params.busCount <= 1) return false;
  return (
    Boolean(params.selectedSessionId) &&
    params.selectedSessionId === params.trackedSessionId &&
    params.selectedTripState === "in_service"
  );
}
