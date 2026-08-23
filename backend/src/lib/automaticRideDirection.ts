import { haversineMeters } from "./geo";
import type { RideDirection } from "./rideDirection";

interface Coordinate {
  lat: number;
  lng: number;
}

export const DIRECTION_INFERENCE_RADIUS_M = 75;
export const TURNAROUND_TELEMETRY_MAX_AGE_MS = 60_000;

function validCoordinate(value: Coordinate | null | undefined): value is Coordinate {
  return Boolean(
    value &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng),
  );
}

/**
 * Infers a fresh ride only when the bus is unambiguously near one endpoint.
 * Mid-route, stale and overlapping-endpoint cases deliberately return null so
 * the backend never invents a direction from a noisy heading sample.
 */
export function inferRideDirectionAtEndpoint(
  stops: readonly Coordinate[],
  position: Coordinate,
  radiusMeters = DIRECTION_INFERENCE_RADIUS_M,
): RideDirection | null {
  if (
    stops.length < 2 ||
    !validCoordinate(position) ||
    !validCoordinate(stops[0]) ||
    !validCoordinate(stops.at(-1)) ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters <= 0
  ) {
    return null;
  }
  const nearForwardOrigin = haversineMeters(position, stops[0]) <= radiusMeters;
  const nearReverseOrigin =
    haversineMeters(position, stops.at(-1)!) <= radiusMeters;
  if (nearForwardOrigin === nearReverseOrigin) return null;
  return nearReverseOrigin ? "reverse" : "forward";
}

export function oppositeRideDirection(direction: RideDirection): RideDirection {
  return direction === "forward" ? "reverse" : "forward";
}

interface TurnaroundReadinessInput {
  now: number;
  telemetryTimestamp: number;
  eligibleAt: number;
  motionState: unknown;
  position: Coordinate;
  destination: Coordinate;
}

/** Requires a fresh stopped fix at the completed destination after the dwell. */
export function automaticTurnaroundIsReady(
  input: TurnaroundReadinessInput,
): boolean {
  return (
    Number.isFinite(input.now) &&
    Number.isFinite(input.telemetryTimestamp) &&
    Number.isFinite(input.eligibleAt) &&
    input.eligibleAt > 0 &&
    input.now >= input.eligibleAt &&
    input.telemetryTimestamp <= input.now + 10_000 &&
    input.now - input.telemetryTimestamp <= TURNAROUND_TELEMETRY_MAX_AGE_MS &&
    input.motionState === "stopped" &&
    validCoordinate(input.position) &&
    validCoordinate(input.destination) &&
    haversineMeters(input.position, input.destination) <=
      DIRECTION_INFERENCE_RADIUS_M
  );
}
