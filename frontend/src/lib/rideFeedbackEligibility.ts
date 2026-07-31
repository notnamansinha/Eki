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
