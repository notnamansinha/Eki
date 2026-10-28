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
interface TripPosition extends TripRouteStop {
  motionState?: MotionState;
  gpsHdop?: number | null;
  timestamp?: number;
}

/** Legacy fixes omit HDOP; an explicitly bad quality measurement is never arrival evidence. */
function unreliableTripFix(position: { motionState?: MotionState; gpsHdop?: number | null }): boolean {
  return position.motionState === "uncertain" || (typeof position.gpsHdop === "number" &&
    (!Number.isFinite(position.gpsHdop) || position.gpsHdop < 0 || position.gpsHdop > GNSS_HDOP_MAX));
}

export interface TripStateInput {
  lat: number;
  lng: number;
  previousPosition?: TripPosition;
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
  /** Sample time before an open GNSS gap; persisted by the caller like terminalArrival. */
  gnssGapSince?: number | null;
}

export interface TripStateResult {
  tripState: TripState;
  currentStopIndex: number;
  hasDepartedOrigin: boolean;
  terminalArrival?: TerminalArrivalEvidence;
  /** Present while a GNSS gap may hide passed stops and no stop has been observed since. */
  gnssGapSince?: number;
  /** Stops credited as passed during a GNSS gap without being observed. */
  skippedStopIndices?: number[];
}

// Stop arrival and endpoint direction inference are intentionally distinct
// policies. Keep this alias while callers migrate from the historical name.
// Passenger stop passage uses the requested 2.5m arrival circle. Endpoint
// direction inference retains its separate radius and quality requirements.
// Use raw accepted fixes, never the map's snapped/interpolated marker position.
export const STOP_ARRIVAL_GEOFENCE_M = 2.5;
export const STOP_GEOFENCE_M = STOP_ARRIVAL_GEOFENCE_M;
export const ORIGIN_DEPARTURE_M = 150;
const MIN_ORIGIN_DEPARTURE_M = 10;
const MAX_TELEMETRY_SEGMENT_M = 250;
// Hardware publishes at 1 Hz. Ten missing heartbeats, an untrusted fix or a
// segment too long to check can hide a passed stop: that opens a GNSS gap.
export const GNSS_GAP_MS = 10_000;
// No bus covers the route faster than this (90 km/h). A shorter gap cannot
// hide a drive round to a stop location the ride has already passed.
const MAX_REVISIT_SPEED_MPS = 25;
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
  previousPosition: TripPosition | undefined,
): boolean {
  if (haversineMeters(position, stop) <= STOP_GEOFENCE_M) return true;
  if (
    !previousPosition || unreliableTripFix(previousPosition) ||
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
 * Which pass through a location shared by stops[earlier] and stops[later] the
 * bus is on, from the side it arrived from (the previous fix) or leaves toward
 * (this fix). Only a fix clear of the shared location shows a direction, so
 * this is undefined while the bus sits on it.
 */
function sharedStopPass(
  stops: TripRouteStop[],
  earlier: number,
  later: number,
  position: TripRouteStop,
  segmentStart: TripPosition | undefined,
): "earlier" | "later" | undefined {
  const shared = stops[earlier];
  const sideOf = (point: TripRouteStop, arriving: boolean) => {
    const leg = (index: number) => arriving
      ? distanceToSegmentMeters(point, stops[index - 1], stops[index])
      : index < stops.length - 1 ? distanceToSegmentMeters(point, stops[index], stops[index + 1]) : Infinity;
    const [toEarlier, toLater] = [leg(earlier), leg(later)];
    if (toEarlier + STOP_GEOFENCE_M < toLater) return "earlier";
    return toLater + STOP_GEOFENCE_M < toEarlier ? "later" : undefined;
  };
  const evidence = [
    ...(segmentStart && !unreliableTripFix(segmentStart) ? [{ point: segmentStart, arriving: true }] : []),
    { point: position, arriving: false },
  ].filter(({ point }) => haversineMeters(point, shared) > STOP_GEOFENCE_M)
    .sort((a, b) => haversineMeters(b.point, shared) - haversineMeters(a.point, shared));
  for (const { point, arriving } of evidence) {
    const pass = sideOf(point, arriving);
    if (pass) return pass;
  }
  return undefined;
}

/** Sample time before the gap this update opens, or undefined when nothing was missed. */
function detectedGnssGap(input: TripStateInput): number | undefined {
  const previous = input.previousPosition;
  const missed = unreliableTripFix(input) || (previous !== undefined && (
    unreliableTripFix(previous) ||
    haversineMeters(previous, input) > MAX_TELEMETRY_SEGMENT_M ||
    (Number.isFinite(previous.timestamp) && Number.isFinite(input.timestamp) &&
      input.timestamp! - previous.timestamp! > GNSS_GAP_MS)));
  if (!missed) return undefined;
  const since = previous?.timestamp ?? input.timestamp;
  return Number.isFinite(since) ? since! : 0;
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

  const priorGap = typeof input.gnssGapSince === "number" && Number.isFinite(input.gnssGapSince)
    ? input.gnssGapSince : undefined;
  const staleFix = typeof input.now === "number" &&
    (!Number.isFinite(input.timestamp) || input.now - input.timestamp! > 60_000 || input.timestamp! > input.now + 10_000);
  // A stale replay is not a GNSS gap; an untrusted fix is.
  const gnssGap = priorGap ?? (staleFix ? undefined : detectedGnssGap(input));
  if (unreliableTripFix(input) || staleFix) {
    return {
      tripState:
        currentTripState === "maintenance"
          ? "in_service"
          : currentTripState,
      currentStopIndex,
      hasDepartedOrigin: input.hasDepartedOrigin,
      ...(gnssGap !== undefined ? { gnssGapSince: gnssGap } : {}),
    };
  }

  const position = { lat, lng };
  // The segment from the previous fix shows which stops were passed only when
  // the two fixes are close in time. Across a longer gap the bus may have taken
  // any path, so a straight chord that happens to touch a stop is no evidence.
  const previous = input.previousPosition;
  const segmentStart = previous && !(Number.isFinite(previous.timestamp) && Number.isFinite(input.timestamp) &&
    input.timestamp! - previous.timestamp! > GNSS_GAP_MS) ? previous : undefined;
  const firstStop = stops[0];
  const departureRadius = stops.length > 1
    ? Math.min(ORIGIN_DEPARTURE_M, Math.max(MIN_ORIGIN_DEPARTURE_M, haversineMeters(firstStop, stops[1]) / 2))
    : ORIGIN_DEPARTURE_M;
  // A first stop inside the minimum departure radius can be passed before the
  // radius is cleared. Moving through it is departure evidence, or the later
  // departure segment would no longer touch it and strand the ride at stop 1.
  const crossedFirstStop = motionState === "moving" && stops.length > 1 &&
    wasStopReached(stops[1], position, segmentStart);
  const hasDepartedOrigin =
    input.hasDepartedOrigin ||
    (currentTripState === "in_service" &&
      (haversineMeters(position, firstStop) >= departureRadius || crossedFirstStop));

  let leavingOrigin = false;
  if (currentTripState === "pre_departure") {
    const departed = motionState === "moving" &&
      (haversineMeters(position, firstStop) >= departureRadius || crossedFirstStop);
    if (!departed || stops.length < 2) {
      return {
        tripState: departed ? "in_service" : "pre_departure",
        currentStopIndex,
        hasDepartedOrigin: hasDepartedOrigin || departed,
        ...(gnssGap !== undefined ? { gnssGapSince: gnssGap } : {}),
      };
    }
    leavingOrigin = true;
  }

  if (currentTripState === "in_service" || leavingOrigin) {
    const lastIndex = stops.length - 1;
    let safeCurrentIndex = Math.min(
      Math.max(Math.trunc(currentStopIndex), 0),
      lastIndex,
    );

    // Stop zero represents the origin. It is left only after there is strong
    // departure evidence, never merely because the client supplied an index.
    if (safeCurrentIndex === 0 && hasDepartedOrigin && lastIndex > 0) leavingOrigin = true;
    if (leavingOrigin) {
      // The departure segment may already have crossed a closely spaced first
      // stop. Consume intermediate crossings now, or the ride can never pass
      // stop 1; terminal arrival still needs a later, separately confirmed fix.
      safeCurrentIndex = Math.max(1, safeCurrentIndex);
    }

    // Only the next expected stop may advance the trip. The bounded segment
    // check still catches a fast crossing between two fixes, but it never
    // permits a downstream stop to skip one or more configured stops, except
    // after a GNSS gap: a reliably observed later stop then credits the
    // unobserved stops before it as skipped instead of stranding the ride.
    // A later stop sharing the location of a stop already passed (out-and-back
    // or loop routes) is ambiguous: the bus may still be at the passed copy.
    // It is credited only when the gap has lasted long enough to drive the
    // route from the last passed stop round to it. A fix still within the
    // minimum departure distance before then means the bus has not left, so
    // the gap is re-anchored there (at most every half revisit time, to bound
    // writes) and a long dwell can never age into a revisit.
    // Conversely a reached stop may share its location with a later one, the
    // far side of an out-and-back. Once the gap is long enough to have hidden
    // the drive between them, the direction the bus passes through decides
    // which copy it is at; until a fix shows one, neither is credited and the
    // gap stays open. A terminal copy has no far side, so time decides there.
    let nextIndex = safeCurrentIndex;
    let skippedStopIndices: number[] | undefined;
    let reanchoredGap: number | undefined;
    let awaitingDirection = false;
    const passedStops = stops.slice(0, nextIndex);
    const atPassedStopLocation = (point: TripRouteStop) =>
      passedStops.some(stop => haversineMeters(point, stop) <= STOP_GEOFENCE_M);
    const gapElapsedMs = gnssGap !== undefined && Number.isFinite(input.timestamp) ? input.timestamp! - gnssGap : 0;
    const lastSkippable = leavingOrigin ? lastIndex - 1 : lastIndex;
    const resolveSharedStop = (index: number): number | undefined => {
      let pathMeters = 0;
      for (let copy = index + 1; copy <= lastSkippable; copy += 1) {
        pathMeters += haversineMeters(stops[copy - 1], stops[copy]);
        if (copy === index + 1 || haversineMeters(stops[copy], stops[index]) > STOP_GEOFENCE_M) continue;
        if (gapElapsedMs < Math.max(GNSS_GAP_MS, pathMeters / MAX_REVISIT_SPEED_MPS * 1000)) return index;
        const pass = sharedStopPass(stops, index, copy, position, segmentStart) ?? (copy === lastIndex ? "later" : undefined);
        return pass === undefined ? undefined : pass === "later" ? copy : index;
      }
      return index;
    };
    const creditThrough = (index: number | undefined) => {
      if (index === undefined) awaitingDirection = true;
      else if (index !== nextIndex) {
        skippedStopIndices = Array.from({ length: index - nextIndex }, (_, offset) => nextIndex + offset);
        nextIndex = index;
      }
    };
    if (gnssGap !== undefined && nextIndex > 0 &&
      !wasStopReached(stops[nextIndex], position, segmentStart)) {
      let revisitPathMeters = haversineMeters(stops[nextIndex - 1], stops[nextIndex]);
      for (let index = nextIndex + 1; index <= lastSkippable; index += 1) {
        revisitPathMeters += haversineMeters(stops[index - 1], stops[index]);
        if (atPassedStopLocation(stops[index])) {
          const minimumMs = Math.max(GNSS_GAP_MS, revisitPathMeters / MAX_REVISIT_SPEED_MPS * 1000);
          if (gapElapsedMs < minimumMs) {
            if (gapElapsedMs >= minimumMs / 2 &&
              haversineMeters(position, stops[index]) <= MIN_ORIGIN_DEPARTURE_M) reanchoredGap = input.timestamp;
            continue;
          }
        }
        if (!wasStopReached(stops[index], position, segmentStart)) continue;
        creditThrough(resolveSharedStop(index));
        break;
      }
    } else if (gnssGap !== undefined && nextIndex > 0) {
      creditThrough(resolveSharedStop(nextIndex));
    }
    if (awaitingDirection) {
      return { tripState: "in_service", currentStopIndex: safeCurrentIndex,
        hasDepartedOrigin: hasDepartedOrigin || leavingOrigin, gnssGapSince: reanchoredGap ?? gnssGap! };
    }
    const skipped = skippedStopIndices ? { skippedStopIndices } : {};
    let lastCrossing = -Infinity;
    let observedStop = false;
    while (nextIndex > 0 && !(leavingOrigin && nextIndex === lastIndex) &&
      wasStopReached(stops[nextIndex], position, segmentStart)) {
      observedStop = true;
      // Multiple closely spaced stops may be crossed in one accepted segment.
      // Consume them only in travel order, never by nearest-stop lookup.
      const dx = segmentStart ? position.lng - segmentStart.lng : 0;
      const dy = segmentStart ? position.lat - segmentStart.lat : 0;
      const lengthSquared = dx * dx + dy * dy;
      const crossing = segmentStart && lengthSquared > 0
        ? ((stops[nextIndex].lng - segmentStart.lng) * dx + (stops[nextIndex].lat - segmentStart.lat) * dy) / lengthSquared
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
        if (!reliableArrival) return { tripState: "in_service", currentStopIndex: nextIndex, hasDepartedOrigin, ...skipped };
        const timestamp = input.timestamp!;
        const prior = input.terminalArrival;
        const usablePrior = prior && Number.isSafeInteger(prior.startedAt) && Number.isSafeInteger(prior.lastSampledAt) &&
          prior.startedAt <= prior.lastSampledAt && prior.lastSampledAt <= timestamp && timestamp - prior.lastSampledAt <= 60_000;
        const evidence = usablePrior ? { ...prior, lastSampledAt: timestamp } : { startedAt: timestamp, lastSampledAt: timestamp };
        const confirmed = usablePrior && timestamp > prior.lastSampledAt && timestamp - prior.startedAt >= TERMINAL_ARRIVAL_CONFIRMATION_MS;
        return { tripState: confirmed ? "completed" : "in_service", currentStopIndex: nextIndex, hasDepartedOrigin,
          ...(!confirmed ? { terminalArrival: evidence } : {}), ...skipped };
      }
      nextIndex += 1;
    }
    // Observing any stop closes the gap; until then it stays open.
    const openGap = !skippedStopIndices && reanchoredGap !== undefined ? reanchoredGap : gnssGap;
    return { tripState: "in_service", currentStopIndex: nextIndex, hasDepartedOrigin: hasDepartedOrigin || leavingOrigin,
      ...(!observedStop && openGap !== undefined ? { gnssGapSince: openGap } : {}), ...skipped };
  }

  const openGap = gnssGap !== undefined ? { gnssGapSince: gnssGap } : {};
  if (currentTripState === "maintenance") {
    return {
      tripState: "in_service",
      currentStopIndex,
      hasDepartedOrigin,
      ...openGap,
    };
  }

  return { tripState: currentTripState, currentStopIndex, hasDepartedOrigin, ...openGap };
}
