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
  /** Receiver course over ground in degrees; only trusted while moving. */
  heading?: number;
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
  /**
   * Stops the bus passed with continuous reliable telemetry but never came
   * within the arrival corridor of (detour, mis-placed stop). Credited only
   * when a later stop is reached travelling the route's way; never an arrival.
   */
  unobservedStopIndices?: number[];
}

// Stop arrival and endpoint direction inference are intentionally distinct
// policies. Keep this alias while callers migrate from the historical name.
// Endpoint direction inference retains its separate radius and quality rules.
// Use raw accepted fixes, never the map's snapped/interpolated marker position.
//
// The arrival corridor was 2.5 m. The 29 Oct 2026 field ride showed that is
// not attainable: stops are configured on map pins a few metres off the lane
// the bus drives, and the NEO-M8N's urban error is several metres on its own,
// so B was never observed and only the next stop may advance the ride. 15 m
// covers a kerb/lane placement offset plus receiver error while staying
// inside the median of a divided road; the far carriageway and parallel roads
// remain outside it. Ordered consumption still prevents early credit.
export const STOP_ARRIVAL_GEOFENCE_M = 15;
export const STOP_GEOFENCE_M = STOP_ARRIVAL_GEOFENCE_M;
// Two configured stops this close are one physical place: a bus dwelling
// anywhere inside one corridor can already be inside the other's.
const SHARED_STOP_LOCATION_M = 2 * STOP_ARRIVAL_GEOFENCE_M;
// Pins this close are the same stop (an out-and-back reusing one shelter);
// farther apart they are distinct pins sharing a place, e.g. both kerbs.
const SAME_PIN_M = 2.5;
// Leaving the origin is marked once the bus is clearly away from it, not up
// to 150 m later; parked jitter stays far inside this distance.
export const ORIGIN_DEPARTURE_M = 50;
const MIN_ORIGIN_DEPARTURE_M = 10;
// A stop missed with continuous telemetry is credited as unobserved only when
// one of the next few stops is reached in the route's direction of travel.
export const MAX_UNOBSERVED_RECOVERY_STOPS = 2;
const MIN_DIRECTION_EVIDENCE_M = 3;
const MAX_RECOVERY_HEADING_DIFFERENCE_DEG = 70;
// Crediting a stop the bus was not expected at next needs real movement, not
// parked jitter, and a parked bus must be practically on the stop.
const MIN_RECOVERY_TRAVEL_M = 4;
// Without a direction of travel, telling the two passes through a shared
// location apart needs a fix well clear of it and a clear preference for one
// leg: an out-and-back's outbound and return legs are the same road.
const SHARED_PASS_CLEARANCE_M = STOP_ARRIVAL_GEOFENCE_M;
const SHARED_PASS_SIDE_MARGIN_M = 5;
const STRICT_ARRIVAL_M = 8;
// Eki runs in India: traffic keeps left, so a stop for this direction is on
// the bus's left. A stop well to the right of a moving bus is across the
// median on a divided road (the opposite direction's kerb), not this one.
const NEAR_KERB_SIDE: "left" | "right" = "left";
// The far kerb of a divided road lies 11 m or more to the offside of a bus in
// its own lane; even with a few metres of receiver error a stop on the bus's
// own kerb never appears this far to its offside.
const MAX_OFFSIDE_ARRIVAL_M = 6;
const MIN_OFFSIDE_TRAVEL_M = 2;
const MIN_HEADING_SPEED_KMH = 5;
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

function localVector(from: TripRouteStop, to: TripRouteStop) {
  const metersPerLatitudeDegree = 111_320;
  return {
    x: (to.lng - from.lng) * metersPerLatitudeDegree * Math.cos((from.lat * Math.PI) / 180),
    y: (to.lat - from.lat) * metersPerLatitudeDegree,
  };
}

/**
 * Whether travel from one fix to the next runs along the route's way through
 * stops[index]: within the recovery tolerance of the leg arriving at it or the
 * leg leaving it. Straight legs between stops stand in for road geometry, so
 * the tolerance is wide; it still separates the two directions of travel.
 */
function travelsRouteWayThrough(stops: TripRouteStop[], index: number, from: TripRouteStop, to: TripRouteStop): boolean {
  const travel = localVector(from, to);
  const travelled = Math.hypot(travel.x, travel.y);
  if (travelled < MIN_DIRECTION_EVIDENCE_M) return false;
  const legs = [
    index > 0 ? localVector(stops[index - 1], stops[index]) : undefined,
    index < stops.length - 1 ? localVector(stops[index], stops[index + 1]) : undefined,
  ];
  return legs.some(leg => {
    const length = leg ? Math.hypot(leg.x, leg.y) : 0;
    if (!leg || length === 0) return false;
    const cosine = (travel.x * leg.x + travel.y * leg.y) / (travelled * length);
    return cosine >= Math.cos((MAX_RECOVERY_HEADING_DIFFERENCE_DEG * Math.PI) / 180);
  });
}

/**
 * Metres a stop lies to the far (offside) side of a moving bus's direction of
 * travel; negative when it is on the near kerb. The direction comes from the
 * last two fixes, or from the receiver's course when the bus crept too little
 * between them. Undefined without either.
 */
function offsideMeters(stop: TripRouteStop, position: TripRouteStop, from: TripRouteStop | undefined,
  headingDegrees: number | undefined): number | undefined {
  let travel = from ? localVector(from, position) : undefined;
  if (!travel || Math.hypot(travel.x, travel.y) < MIN_OFFSIDE_TRAVEL_M) {
    if (headingDegrees === undefined || !Number.isFinite(headingDegrees)) return undefined;
    const radians = (headingDegrees * Math.PI) / 180;
    travel = { x: Math.sin(radians), y: Math.cos(radians) };
  }
  const length = Math.hypot(travel.x, travel.y);
  const toStop = localVector(position, stop);
  // Positive cross product: the stop is to the left of travel.
  const leftM = (travel.x * toStop.y - travel.y * toStop.x) / length;
  return NEAR_KERB_SIDE === "left" ? -leftM : leftM;
}

/**
 * Whether the route turns back between stops[index - 1] and stops[index]: the
 * leg leaving the later stop opposes the leg arriving at the earlier one, or
 * (for a terminal) the hop between them runs across rather than along the
 * road. That is a U-turn pair on opposite kerbs, not two stops in a row.
 */
function reversesBetween(stops: TripRouteStop[], index: number): boolean {
  if (index < 2) return false;
  const arriving = localVector(stops[index - 2], stops[index - 1]);
  const next = index < stops.length - 1 ? localVector(stops[index], stops[index + 1]) : localVector(stops[index - 1], stops[index]);
  const lengths = Math.hypot(arriving.x, arriving.y) * Math.hypot(next.x, next.y);
  if (lengths === 0) return false;
  const cosine = (arriving.x * next.x + arriving.y * next.y) / lengths;
  return index < stops.length - 1 ? cosine < -0.5 : Math.abs(cosine) < 0.5 || cosine < -0.5;
}

function originDepartureRadius(stops: TripRouteStop[]): number {
  return stops.length > 1
    ? Math.min(ORIGIN_DEPARTURE_M, Math.max(MIN_ORIGIN_DEPARTURE_M, haversineMeters(stops[0], stops[1]) / 2))
    : ORIGIN_DEPARTURE_M;
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
  // The direction of travel decides when it fits only one copy's legs.
  if (segmentStart && !unreliableTripFix(segmentStart)) {
    const fitsEarlier = travelsRouteWayThrough(stops, earlier, segmentStart, position);
    const fitsLater = travelsRouteWayThrough(stops, later, segmentStart, position);
    if (fitsEarlier !== fitsLater) return fitsEarlier ? "earlier" : "later";
  }
  const shared = stops[earlier];
  const sideOf = (point: TripRouteStop, arriving: boolean) => {
    const leg = (index: number) => arriving
      ? distanceToSegmentMeters(point, stops[index - 1], stops[index])
      : index < stops.length - 1 ? distanceToSegmentMeters(point, stops[index], stops[index + 1]) : Infinity;
    const [toEarlier, toLater] = [leg(earlier), leg(later)];
    if (toEarlier + SHARED_PASS_SIDE_MARGIN_M < toLater) return "earlier";
    return toLater + SHARED_PASS_SIDE_MARGIN_M < toEarlier ? "later" : undefined;
  };
  const evidence = [
    ...(segmentStart && !unreliableTripFix(segmentStart) ? [{ point: segmentStart, arriving: true }] : []),
    { point: position, arriving: false },
  ].filter(({ point }) => haversineMeters(point, shared) > SHARED_PASS_CLEARANCE_M)
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
  const departureRadius = originDepartureRadius(stops);
  // A first stop inside the minimum departure radius can be passed before the
  // radius is cleared. Moving through it is departure evidence, or the later
  // departure segment would no longer touch it and strand the ride at stop 1.
  // The bus must be beyond it: its arrival corridor can contain the origin.
  const crossedFirstStop = motionState === "moving" && stops.length > 1 &&
    wasStopReached(stops[1], position, segmentStart) &&
    haversineMeters(position, firstStop) > haversineMeters(stops[1], firstStop);
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
      passedStops.some(stop => haversineMeters(point, stop) <= SHARED_STOP_LOCATION_M);
    const gapElapsedMs = gnssGap !== undefined && Number.isFinite(input.timestamp) ? input.timestamp! - gnssGap : 0;
    const lastSkippable = leavingOrigin ? lastIndex - 1 : lastIndex;
    // Route distance between stops in O(1), so long itineraries stay cheap.
    const routeMeters: number[] = [0];
    for (let index = 1; index < stops.length; index += 1) {
      routeMeters.push(routeMeters[index - 1] + haversineMeters(stops[index - 1], stops[index]));
    }
    const pathMeters = (from: number, to: number) => routeMeters[to] - routeMeters[from];
    const reliableSegmentStart = segmentStart && !unreliableTripFix(segmentStart) ? segmentStart : undefined;
    // A stop is reached inside its corridor, but never from across a divided
    // road: a moving bus with the stop well to its offside is passing the
    // opposite direction's kerb.
    const movingHeading = motionState === "moving" && typeof input.speed === "number" &&
      input.speed >= MIN_HEADING_SPEED_KMH ? input.heading : undefined;
    const reachedStop = (index: number) => {
      if (!wasStopReached(stops[index], position, segmentStart)) return false;
      if (motionState !== "moving") return true;
      const offside = offsideMeters(stops[index], position, reliableSegmentStart, movingHeading);
      return offside === undefined || offside <= MAX_OFFSIDE_ARRIVAL_M;
    };
    // Evidence strong enough to credit a stop other than the next expected
    // one: a real pass in the route's direction through it, or a fix
    // practically on it. Parked jitter or a fix across the road is not.
    const travelledThrough = (index: number) => Boolean(reliableSegmentStart && motionState === "moving" &&
      reliableSegmentStart.motionState === "moving" &&
      haversineMeters(reliableSegmentStart, position) >= MIN_RECOVERY_TRAVEL_M &&
      travelsRouteWayThrough(stops, index, reliableSegmentStart, position));
    const observedLaterStop = (index: number) => reachedStop(index) &&
      (travelledThrough(index) || haversineMeters(position, stops[index]) <= STRICT_ARRIVAL_M);
    // A gap can only have hidden as much route as a bus could drive in it.
    const reachableInGap = (index: number) =>
      Math.max(0, pathMeters(nextIndex, index) - STOP_GEOFENCE_M) <= gapElapsedMs / 1000 * MAX_REVISIT_SPEED_MPS;
    const resolveSharedStop = (index: number): number | undefined => {
      for (let copy = index + 2; copy <= lastSkippable; copy += 1) {
        const apartM = haversineMeters(stops[copy], stops[index]);
        if (apartM > SHARED_STOP_LOCATION_M) continue;
        if (gapElapsedMs < Math.max(GNSS_GAP_MS, pathMeters(index, copy) / MAX_REVISIT_SPEED_MPS * 1000)) return index;
        // Distinct pins (opposite kerbs): a fix practically on one and clear
        // of the other says which one the bus is at, without a direction.
        if (apartM > STRICT_ARRIVAL_M) {
          const toIndex = haversineMeters(position, stops[index]), toCopy = haversineMeters(position, stops[copy]);
          if (toIndex <= STRICT_ARRIVAL_M && toCopy > STRICT_ARRIVAL_M) return index;
          if (toCopy <= STRICT_ARRIVAL_M && toIndex > STRICT_ARRIVAL_M) return copy;
        }
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
    const revisitMinimumMs = (index: number) =>
      Math.max(GNSS_GAP_MS, pathMeters(nextIndex - 1, index) / MAX_REVISIT_SPEED_MPS * 1000);
    // Re-anchor on every fix that still sits at a passed stop the route
    // revisits, whichever branch follows: a dwell whose jitter reaches into a
    // closely spaced next stop's corridor must not age into a revisit either.
    // Only stops near the bus can qualify, so filter by distance first.
    if (gnssGap !== undefined && nextIndex > 0) {
      // The bus is still at a revisited location when it is inside the later
      // stop's corridor (and that stop shares a passed location), or inside a
      // passed stop's corridor that the later stop shares.
      const passedHere = passedStops.filter(stop => haversineMeters(position, stop) <= STOP_GEOFENCE_M);
      for (let index = nextIndex + 1; index <= lastSkippable; index += 1) {
        const stillThere = haversineMeters(position, stops[index]) <= STOP_GEOFENCE_M
          ? atPassedStopLocation(stops[index])
          : passedHere.some(stop => haversineMeters(stop, stops[index]) <= SHARED_STOP_LOCATION_M);
        if (!stillThere) continue;
        const minimumMs = revisitMinimumMs(index);
        if (gapElapsedMs >= minimumMs / 2 && gapElapsedMs < minimumMs) {
          reanchoredGap = input.timestamp;
          break;
        }
      }
    }
    if (gnssGap !== undefined && nextIndex > 0 && !reachedStop(nextIndex)) {
      for (let index = nextIndex + 1; index <= lastSkippable; index += 1) {
        if (!reachableInGap(index)) break;
        if (!observedLaterStop(index)) continue;
        if (atPassedStopLocation(stops[index]) && gapElapsedMs < revisitMinimumMs(index)) continue;
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
    // With continuous reliable telemetry a stop can still be missed (a detour,
    // or a stop pinned off the travelled road). Driving through one of the
    // next few stops in the route's direction then credits the stops before
    // it as passed but unobserved, instead of stranding every later stop. A
    // target sharing a passed stop's location (out-and-back copy, loop
    // terminal) is ambiguous with the passed copy and is never credited here.
    let unobservedStopIndices: number[] | undefined;
    if (gnssGap === undefined && nextIndex > 0 && !reachedStop(nextIndex)) {
      const lastTarget = Math.min(nextIndex + MAX_UNOBSERVED_RECOVERY_STOPS, leavingOrigin ? lastIndex - 1 : lastIndex);
      for (let index = nextIndex + 1; index <= lastTarget; index += 1) {
        if (!reachedStop(index) || !travelledThrough(index)) continue;
        if (atPassedStopLocation(stops[index])) break;
        unobservedStopIndices = Array.from({ length: index - nextIndex }, (_, offset) => nextIndex + offset);
        nextIndex = index;
        break;
      }
    }
    const skipped = { ...(skippedStopIndices ? { skippedStopIndices } : {}),
      ...(unobservedStopIndices ? { unobservedStopIndices } : {}) };
    // Consecutive distinct pins sharing a place (the last outbound stop and
    // the first return stop on the opposite kerb, a U-turn apart) cannot be
    // told apart by proximity while the bus dwells between them. The later
    // one needs a moving pass along its own leg, or for a terminal a stop
    // practically on its pin.
    const distinguishable = (index: number) => {
      const apartM = haversineMeters(stops[index], stops[index - 1]);
      if (apartM <= SAME_PIN_M || apartM > SHARED_STOP_LOCATION_M || !reversesBetween(stops, index)) return true;
      if (index === lastIndex) return haversineMeters(position, stops[index]) <= STRICT_ARRIVAL_M;
      return Boolean(reliableSegmentStart && motionState === "moving" && reliableSegmentStart.motionState === "moving" &&
        haversineMeters(reliableSegmentStart, position) >= MIN_DIRECTION_EVIDENCE_M &&
        travelsRouteWayThrough([stops[index], stops[index + 1]], 0, reliableSegmentStart, position));
    };
    let lastCrossing = -Infinity;
    let observedStop = false;
    // Closely spaced stops can share corridor: a bus dwelling at the stop it
    // just reached is not yet at the next until it is at least as close to it.
    while (nextIndex > 0 && !(leavingOrigin && nextIndex === lastIndex) &&
      reachedStop(nextIndex) && distinguishable(nextIndex) &&
      haversineMeters(position, stops[nextIndex]) <= haversineMeters(position, stops[nextIndex - 1])) {
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

export interface StopVisitInput extends TripRouteStop {
  motionState?: MotionState;
  gpsHdop?: number | null;
  stops: TripRouteStop[];
  tripState: string;
  currentStopIndex: number;
  hasDepartedOrigin: boolean;
  unobservedStopIndices?: readonly number[];
}

/**
 * The stop the bus is at now, for an "At B" acknowledgement that appears on
 * arrival rather than waiting for the next stop. The origin counts while the
 * bus is inside its corridor and has not departed; the terminal counts while
 * its completion is still being confirmed. Only a reliable fix inside a reached stop's corridor qualifies,
 * and a stop credited without being observed is never reported as visited.
 */
export function visitedStopIndex(input: StopVisitInput): number | null {
  const { stops } = input;
  if (stops.length === 0 || !Number.isSafeInteger(input.currentStopIndex)) return null;
  const lastIndex = stops.length - 1;
  if (input.tripState === "completed") return lastIndex;
  if (input.tripState !== "pre_departure" && input.tripState !== "in_service") return null;
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng) || unreliableTripFix(input)) return null;
  const position = { lat: input.lat, lng: input.lng };
  const index = Math.min(Math.max(input.currentStopIndex, 0), lastIndex);
  const observedAt = (stopIndex: number) => !input.unobservedStopIndices?.includes(stopIndex) &&
    haversineMeters(position, stops[stopIndex]) <= STOP_GEOFENCE_M;
  if (index === 0) {
    return !input.hasDepartedOrigin && haversineMeters(position, stops[0]) <= STOP_GEOFENCE_M ? 0 : null;
  }
  if (index === lastIndex && input.hasDepartedOrigin && observedAt(lastIndex)) return lastIndex;
  return observedAt(index - 1) ? index - 1 : null;
}
