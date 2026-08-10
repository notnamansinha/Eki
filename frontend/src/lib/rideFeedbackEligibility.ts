export type RideTripState = "pre_departure" | "in_service" | "completed";

export interface RideIdentity {
  sessionId: string;
  busId: string;
  routeId: string;
  driverId: string;
}

export interface TrackedRide extends RideIdentity {
  hasSelectedStop: boolean;
}

export function hasSelectedRideStop(
  boardingStopId: string,
  alightingStopId: string,
): boolean {
  return Boolean(boardingStopId || alightingStopId);
}

export function observeRide(
  current: TrackedRide | null,
  ride: RideIdentity,
): TrackedRide {
  if (current?.sessionId !== ride.sessionId) {
    return { ...ride, hasSelectedStop: false };
  }

  return { ...current, ...ride };
}

export function recordStopSelection(
  current: TrackedRide | null,
  sessionId: string,
  hasSelectedStop: boolean,
): TrackedRide | null {
  if (!current || current.sessionId !== sessionId || !hasSelectedStop) {
    return current;
  }

  return { ...current, hasSelectedStop: true };
}

export function isPostRideFeedbackEligible(
  ride: TrackedRide,
  lastTripState: RideTripState | undefined,
): boolean {
  return ride.hasSelectedStop && lastTripState === "completed";
}

export type RideTrackingAction =
  | { type: "complete"; ride: TrackedRide }
  | { type: "freeze" }
  | { type: "observe"; ride: TrackedRide }
  | { type: "none" };

/**
 * Pure decision for the passenger's tracked-ride effect.
 *
 * Rules:
 * - A tracked session that is still live is re-observed (participation kept).
 * - A tracked session that vanished after `completed` finishes the ride flow.
 * - A tracked session that vanished WITHOUT a completed snapshot (driver
 *   ended/re-armed the shift, interrupted update) FREEZES the ride. It is
 *   never re-bound to a different session (#68): the passenger rode the
 *   original session, and feedback against a new session would be rejected by
 *   the backend manifest rules anyway.
 */
export function decideRideTracking(
  current: TrackedRide | null,
  activeSessions: ReadonlySet<string>,
  activeRide: RideIdentity | null,
  lastTripState: (sessionId: string) => RideTripState | undefined,
): RideTrackingAction {
  if (current && !activeSessions.has(current.sessionId)) {
    if (lastTripState(current.sessionId) === "completed") {
      return { type: "complete", ride: current };
    }
    return { type: "freeze" };
  }
  if (activeRide) {
    return { type: "observe", ride: observeRide(current, activeRide) };
  }
  return { type: "none" };
}
