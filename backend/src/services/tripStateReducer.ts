import type { LegacyTripState, MotionState, TripState } from "../types";
import { haversineMeters } from "../lib/geo";
import { GNSS_HDOP_MAX, GNSS_STATIONARY_SPEED_KMH } from "../lib/telemetryMotion";

export interface TerminalArrivalEvidence {
  startedAt: number;
  lastSampledAt: number;
}

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
  timestamp?: number;
  now?: number;
  gpsHdop?: number | null;
  speed?: number;
  terminalArrival?: TerminalArrivalEvidence | null;
}

export interface TripStateResult {
  tripState: TripState;
  currentStopIndex: number;
  hasDepartedOrigin: boolean;
  terminalArrival?: TerminalArrivalEvidence;
}

// Stop arrival and endpoint direction inference are intentionally distinct
// policies. Keep this alias while callers migrate from the historical name.
export const STOP_ARRIVAL_GEOFENCE_M = 20;
export const STOP_GEOFENCE_M = STOP_ARRIVAL_GEOFENCE_M;
export const ORIGIN_DEPARTURE_M = 150;
const MAX_TELEMETRY_SEGMENT_M = 250;
// Two one-second hardware heartbeats must span this interval. This is arrival
// confirmation, independent of the post-completion turnaround wait.
const configuredConfirmationMs = Number(process.env.TERMINAL_ARRIVAL_CONFIRMATION_MS);
export const TERMINAL_ARRIVAL_CONFIRMATION_MS = Number.isFinite(configuredConfirmationMs) && configuredConfirmationMs >= 1_000
  ? Math.floor(configuredConfirmationMs) : 2_000;

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

  if (motionState === "uncertain" || (typeof input.now === "number" &&
    (!Number.isFinite(input.timestamp) || input.now - input.timestamp! > 60_000 || input.timestamp! > input.now + 10_000))) {
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
  const departureRadius = stops.length > 1
    ? Math.min(ORIGIN_DEPARTURE_M, Math.max(STOP_GEOFENCE_M, haversineMeters(firstStop, stops[1]) / 2))
    : ORIGIN_DEPARTURE_M;
  const hasDepartedOrigin =
    input.hasDepartedOrigin ||
    (currentTripState === "in_service" &&
      haversineMeters(position, firstStop) >= departureRadius);

  if (currentTripState === "pre_departure") {
    const departed = motionState === "moving" &&
      haversineMeters(position, firstStop) >= departureRadius;
    return {
      tripState: departed ? "in_service" : "pre_departure",
      currentStopIndex: departed && stops.length > 1 ? Math.max(1, currentStopIndex) : currentStopIndex,
      hasDepartedOrigin: hasDepartedOrigin || departed,
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
    let nextIndex = safeCurrentIndex;
    let lastCrossing = -Infinity;
    while (nextIndex > 0 && wasStopReached(stops[nextIndex], position, input.previousPosition)) {
      // Multiple closely spaced stops may be crossed in one accepted segment.
      // Consume them only in travel order, never by nearest-stop lookup.
      const previous = input.previousPosition;
      const dx = previous ? position.lng - previous.lng : 0;
      const dy = previous ? position.lat - previous.lat : 0;
      const lengthSquared = dx * dx + dy * dy;
      const crossing = previous && lengthSquared > 0
        ? ((stops[nextIndex].lng - previous.lng) * dx + (stops[nextIndex].lat - previous.lat) * dy) / lengthSquared
        : 1;
      if (crossing < lastCrossing) break;
      lastCrossing = crossing;
      if (nextIndex === lastIndex) {
        const reliableArrival = hasDepartedOrigin && motionState === "stopped" &&
          typeof input.gpsHdop === "number" && Number.isFinite(input.gpsHdop) &&
          input.gpsHdop >= 0 && input.gpsHdop <= GNSS_HDOP_MAX &&
          typeof input.speed === "number" && input.speed >= 0 && input.speed <= GNSS_STATIONARY_SPEED_KMH &&
          Number.isSafeInteger(input.timestamp) &&
          haversineMeters(position, stops[lastIndex]) <= STOP_GEOFENCE_M;
        if (!reliableArrival) return { tripState: "in_service", currentStopIndex: nextIndex, hasDepartedOrigin };
        const timestamp = input.timestamp!;
        const prior = input.terminalArrival;
        const usablePrior = prior && Number.isSafeInteger(prior.startedAt) && Number.isSafeInteger(prior.lastSampledAt) &&
          prior.startedAt <= prior.lastSampledAt && prior.lastSampledAt <= timestamp && timestamp - prior.lastSampledAt <= 60_000;
        const evidence = usablePrior ? { ...prior, lastSampledAt: timestamp } : { startedAt: timestamp, lastSampledAt: timestamp };
        const confirmed = usablePrior && timestamp > prior.lastSampledAt && timestamp - prior.startedAt >= TERMINAL_ARRIVAL_CONFIRMATION_MS;
        return { tripState: confirmed ? "completed" : "in_service", currentStopIndex: nextIndex, hasDepartedOrigin,
          ...(!confirmed ? { terminalArrival: evidence } : {}) };
      }
      nextIndex += 1;
    }
    return { tripState: "in_service", currentStopIndex: nextIndex, hasDepartedOrigin };
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
