import type { LegacyTripState, MotionState, TripState } from "../types";
import { haversineMeters } from "../lib/geo";

interface TripRouteStop {
  lat: number;
  lng: number;
}

export interface TripStateInput {
  lat: number;
  lng: number;
  previousPosition?: TripRouteStop;
  motionState: MotionState;
  currentTripState: LegacyTripState;
  currentStopIndex: number;
  stops: TripRouteStop[];
  hasDepartedOrigin: boolean;
}

export interface TripStateResult {
  tripState: TripState;
  currentStopIndex: number;
  hasDepartedOrigin: boolean;
}

export const STOP_GEOFENCE_M = 20;
export const ORIGIN_DEPARTURE_M = 150;
const MAX_TELEMETRY_SEGMENT_M = 250;

function distanceToSegmentMeters(
  point: TripRouteStop,
  start: TripRouteStop,
  end: TripRouteStop,
): number {
  const metersPerLatitudeDegree = 111_320;
  const metersPerLongitudeDegree =
    metersPerLatitudeDegree * Math.cos((point.lat * Math.PI) / 180);
  const startX = (start.lng - point.lng) * metersPerLongitudeDegree;
  const startY = (start.lat - point.lat) * metersPerLatitudeDegree;
  const endX = (end.lng - point.lng) * metersPerLongitudeDegree;
  const endY = (end.lat - point.lat) * metersPerLatitudeDegree;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) return Math.hypot(startX, startY);

  const projection = Math.min(
    1,
    Math.max(0, -(startX * deltaX + startY * deltaY) / lengthSquared),
  );
  return Math.hypot(
    startX + projection * deltaX,
    startY + projection * deltaY,
  );
}

function wasStopReached(
  stop: TripRouteStop,
  position: TripRouteStop,
  previousPosition: TripRouteStop | undefined,
): boolean {
  if (haversineMeters(position, stop) <= STOP_GEOFENCE_M) return true;
  if (
    !previousPosition ||
    haversineMeters(previousPosition, position) > MAX_TELEMETRY_SEGMENT_M
  ) {
    return false;
  }
  return (
    distanceToSegmentMeters(stop, previousPosition, position) <=
    STOP_GEOFENCE_M
  );
}

/**
 * Pure trip lifecycle decision. Departure evidence is supplied by and returned
 * to the caller so it can be persisted with the active trip, rather than lost
 * on a backend restart or when more than one backend instance is running.
 */
export function reduceTripState(input: TripStateInput): TripStateResult {
  const {
    lat,
    lng,
    motionState,
    currentTripState,
    currentStopIndex,
    stops,
  } = input;

  if (stops.length === 0) {
    return {
      tripState:
        currentTripState === "maintenance"
          ? "in_service"
          : currentTripState,
      currentStopIndex: 0,
      hasDepartedOrigin: input.hasDepartedOrigin,
    };
  }

  if (motionState === "uncertain") {
    return {
      tripState:
        currentTripState === "maintenance"
          ? "in_service"
          : currentTripState,
      currentStopIndex,
      hasDepartedOrigin: input.hasDepartedOrigin,
    };
  }

  const position = { lat, lng };
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];
  const hasDepartedOrigin =
    input.hasDepartedOrigin ||
    (currentTripState === "in_service" &&
      haversineMeters(position, firstStop) >= ORIGIN_DEPARTURE_M);

  if (currentTripState === "pre_departure") {
    return {
      tripState:
        haversineMeters(position, firstStop) <= STOP_GEOFENCE_M
          ? "in_service"
          : "pre_departure",
      currentStopIndex,
      hasDepartedOrigin,
    };
  }

  if (currentTripState === "in_service") {
    const lastIndex = stops.length - 1;
    const safeCurrentIndex = Math.min(
      Math.max(Math.trunc(currentStopIndex), 0),
      lastIndex,
    );

    // Stop zero represents the origin. It is left only after there is strong
    // departure evidence, never merely because the client supplied an index.
    if (safeCurrentIndex === 0 && hasDepartedOrigin && lastIndex > 0) {
      return {
        tripState: "in_service",
        currentStopIndex: 1,
        hasDepartedOrigin,
      };
    }

    // Only the next expected stop may advance the trip. The bounded segment
    // check still catches a fast crossing between two fixes, but it never
    // permits a downstream stop to skip one or more configured stops.
    const expectedStop = stops[safeCurrentIndex];
    const reachedExpectedStop =
      safeCurrentIndex > 0 &&
      wasStopReached(expectedStop, position, input.previousPosition);
    if (reachedExpectedStop && safeCurrentIndex < lastIndex) {
      return {
        tripState: "in_service",
        currentStopIndex: safeCurrentIndex + 1,
        hasDepartedOrigin,
      };
    }

    const canComplete =
      hasDepartedOrigin &&
      safeCurrentIndex === lastIndex &&
      reachedExpectedStop &&
      wasStopReached(lastStop, position, input.previousPosition);

    return {
      tripState: canComplete ? "completed" : "in_service",
      currentStopIndex: safeCurrentIndex,
      hasDepartedOrigin,
    };
  }

  if (currentTripState === "maintenance") {
    return {
      tripState: "in_service",
      currentStopIndex,
      hasDepartedOrigin,
    };
  }

  return { tripState: currentTripState, currentStopIndex, hasDepartedOrigin };
}
