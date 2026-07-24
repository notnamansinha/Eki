import type { MotionState, TripState } from "../types";
import { haversineMeters } from "../lib/geo";

export interface TripRouteStop {
  lat: number;
  lng: number;
}

export interface TripStateInput {
  lat: number;
  lng: number;
  motionState: MotionState;
  currentTripState: TripState;
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
      tripState: "in_service",
      currentStopIndex: 0,
      hasDepartedOrigin: input.hasDepartedOrigin,
    };
  }

  if (motionState === "uncertain") {
    return {
      tripState: "maintenance",
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
    const completionProgressIndex = Math.max(0, stops.length - 2);
    const canComplete =
      hasDepartedOrigin &&
      currentStopIndex >= completionProgressIndex &&
      haversineMeters(position, lastStop) <= STOP_GEOFENCE_M;

    return {
      tripState: canComplete ? "completed" : "in_service",
      currentStopIndex: canComplete ? stops.length - 1 : currentStopIndex,
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
