import { haversineMeters } from "./geo";
import type { RideDirection } from "./rideDirection";

interface Coordinate {
  lat: number;
  lng: number;
}

/** Authoritative radius for selecting a new ride direction at an endpoint. */
export const ENDPOINT_GEOFENCE_M = 20;
/** @deprecated Use ENDPOINT_GEOFENCE_M for new direction inference. */
export const DIRECTION_INFERENCE_RADIUS_M = ENDPOINT_GEOFENCE_M;
/** Turnaround arrival may use a broader, independently tuned arrival radius. */
export const TURNAROUND_ARRIVAL_RADIUS_M = 75;
export const TURNAROUND_TELEMETRY_MAX_AGE_MS = 60_000;
export const DIRECTION_INFERENCE_MAX_HDOP = 4;
export const DIRECTION_INFERENCE_MAX_FUTURE_MS = 10_000;

export interface DirectionInferenceTelemetry {
  now: number;
  timestamp: number;
  motionState: unknown;
  gpsHdop: unknown;
  position: Coordinate;
}

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
  radiusMeters = ENDPOINT_GEOFENCE_M,
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

/**
 * Resolves a direction only from a fresh, reliable, stopped hardware fix at
 * exactly one endpoint. Callers deliberately receive null for every ambiguous
 * case so they can retain an explicit pending state instead of guessing.
 */
export function inferRideDirectionFromTelemetry(
  stops: readonly Coordinate[],
  telemetry: DirectionInferenceTelemetry,
  radiusMeters = ENDPOINT_GEOFENCE_M,
): RideDirection | null {
  if (
    !Number.isFinite(telemetry.now) ||
    !Number.isFinite(telemetry.timestamp) ||
    telemetry.timestamp > telemetry.now + DIRECTION_INFERENCE_MAX_FUTURE_MS ||
    telemetry.now - telemetry.timestamp > TURNAROUND_TELEMETRY_MAX_AGE_MS ||
    telemetry.motionState !== "stopped" ||
    typeof telemetry.gpsHdop !== "number" ||
    !Number.isFinite(telemetry.gpsHdop) ||
    telemetry.gpsHdop < 0 ||
    telemetry.gpsHdop > DIRECTION_INFERENCE_MAX_HDOP
  ) {
    return null;
  }
  return inferRideDirectionAtEndpoint(stops, telemetry.position, radiusMeters);
}

export function oppositeRideDirection(direction: RideDirection): RideDirection {
  return direction === "forward" ? "reverse" : "forward";
}

interface TurnaroundReadinessInput {
  now: number;
  telemetryTimestamp: number;
  eligibleAt: number;
  minimumSampleTimestamp?: number;
  motionState: unknown;
  position: Coordinate;
  destination: Coordinate;
}

/** Requires a fresh stopped fix at the completed destination after the dwell. */
export function automaticTurnaroundIsReady(
  input: TurnaroundReadinessInput,
  radiusMeters = TURNAROUND_ARRIVAL_RADIUS_M,
): boolean {
  return (
    Number.isFinite(input.now) &&
    Number.isFinite(input.telemetryTimestamp) &&
    Number.isFinite(input.eligibleAt) &&
    input.eligibleAt > 0 &&
    input.now >= input.eligibleAt &&
    input.telemetryTimestamp >= (Number.isFinite(input.minimumSampleTimestamp) ? input.minimumSampleTimestamp! : input.eligibleAt) &&
    input.telemetryTimestamp <= input.now + 10_000 &&
    input.now - input.telemetryTimestamp <= TURNAROUND_TELEMETRY_MAX_AGE_MS &&
    input.motionState === "stopped" &&
    validCoordinate(input.position) &&
    validCoordinate(input.destination) &&
    Number.isFinite(radiusMeters) &&
    radiusMeters > 0 &&
    haversineMeters(input.position, input.destination) <= radiusMeters
  );
}
