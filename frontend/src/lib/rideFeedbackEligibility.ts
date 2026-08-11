export type RideTripState = "pre_departure" | "in_service" | "completed";

export interface RideIdentity {
  sessionId: string;
  busId: string;
  routeId: string;
  driverId: string;
}

export interface TrackedRide extends RideIdentity {
  hasJoined: boolean;
}

export function observeRide(
  current: TrackedRide | null,
  ride: RideIdentity,
): TrackedRide {
  if (current?.sessionId !== ride.sessionId) {
    return { ...ride, hasJoined: false };
  }

  return { ...current, ...ride };
}

/**
 * Establish the ride identity only after the backend accepts a boarding join.
 * A successful join is an explicit user action, so it may replace an older
 * frozen ride; passive live-bus observation must never do that.
 */
export function recordSuccessfulJoin(
  current: TrackedRide | null,
  ride: RideIdentity,
): TrackedRide {
  if (current?.sessionId === ride.sessionId) {
    return { ...current, ...ride, hasJoined: true };
  }
  return { ...ride, hasJoined: true };
}

export function isPostRideFeedbackEligible(
  ride: TrackedRide,
  lastTripState: RideTripState | undefined,
): boolean {
  return ride.hasJoined && lastTripState === "completed";
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
 * - Observing an active session never starts passenger tracking. Only a
 *   successful server-side boarding join establishes identity.
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
  activeRides: ReadonlyMap<string, RideIdentity>,
  lastTripState: (sessionId: string) => RideTripState | undefined,
): RideTrackingAction {
  if (!current) return { type: "none" };

  const activeRide = activeRides.get(current.sessionId);
  if (!activeRide) {
    if (lastTripState(current.sessionId) === "completed") {
      return { type: "complete", ride: current };
    }
    return { type: "freeze" };
  }

  return { type: "observe", ride: observeRide(current, activeRide) };
}
