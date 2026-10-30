import { haversineMeters } from "../lib/geo";
import type { LatLng } from "../lib/polylineUtils";

const EARTH_RADIUS_M = 6_371_000;
const TO_RADIANS = Math.PI / 180;
const TO_DEGREES = 180 / Math.PI;

export const ROUTE_MATCH_DISTANCE_M = 45;
export const OFF_ROUTE_DISTANCE_M = 60;
export const OFF_ROUTE_CONFIRMATION_SAMPLES = 2;
export const STRONG_OFF_ROUTE_DISTANCE_M = 120;
// The previous match only bounds how far the bus can have travelled while it
// is a fresh 1 Hz neighbour. After a gap its speed says nothing about the
// distance actually driven, so no plausibility penalty applies.
export const PLAUSIBLE_PROGRESS_MAX_ANCHOR_AGE_MS = 10_000;
const PLAUSIBLE_PROGRESS_SLACK_KMH = 15;

/**
 * Forward progress a bus can have made since a fresh previous match, or
 * undefined when the anchor is too old to bound it. Speed slack covers
 * acceleration between fixes; position uncertainty covers receiver error.
 */
export function plausibleProgressBound(elapsedMs: number, speedKmh: number, positionUncertaintyM: number): number | undefined {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs > PLAUSIBLE_PROGRESS_MAX_ANCHOR_AGE_MS) return undefined;
  const speed = Number.isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  return (speed + PLAUSIBLE_PROGRESS_SLACK_KMH) / 3.6 * elapsedMs / 1000 + Math.max(0, positionUncertaintyM);
}

export type RouteAdherenceState =
  | "ON_ROUTE"
  | "POSSIBLE_OFF_ROUTE"
  | "OFF_ROUTE"
  | "REROUTING"
  | "ON_NEW_ROUTE";

export interface PreviousRouteMatch {
  segmentIndex: number;
  alongRouteDistanceM: number;
}

export interface RouteMatch {
  point: LatLng;
  segmentIndex: number;
  segmentFraction: number;
  distanceToRouteM: number;
  alongRouteDistanceM: number;
  headingDifference: number | null;
  matchConfidence: number;
  isAmbiguous: boolean;
}

export interface RouteAdherenceDecision {
  routeState: RouteAdherenceState;
  offRouteSampleCount: number;
  shouldReroute: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function angularDifference(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180);
}

function segmentHeading(start: LatLng, end: LatLng): number {
  const lat1 = start.lat * TO_RADIANS;
  const lat2 = end.lat * TO_RADIANS;
  const deltaLng = (end.lng - start.lng) * TO_RADIANS;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * TO_DEGREES + 360) % 360;
}

/** Derive a stable movement vector from the recent accepted trajectory. */
export function trajectoryHeading(
  points: readonly LatLng[],
  minimumDisplacementM = 8,
): number | undefined {
  if (points.length < 2) return undefined;
  const first = points[0];
  const last = points[points.length - 1];
  return haversineMeters(first, last) >= minimumDisplacementM
    ? segmentHeading(first, last)
    : undefined;
}

function projectToSegment(point: LatLng, start: LatLng, end: LatLng) {
  const referenceLat = point.lat * TO_RADIANS;
  const longitudeScale = Math.max(0.01, Math.cos(referenceLat));
  const toLocal = (value: LatLng) => ({
    x:
      (value.lng - point.lng) *
      TO_RADIANS *
      EARTH_RADIUS_M *
      longitudeScale,
    y: (value.lat - point.lat) * TO_RADIANS * EARTH_RADIUS_M,
  });
  const localStart = toLocal(start);
  const localEnd = toLocal(end);
  const deltaX = localEnd.x - localStart.x;
  const deltaY = localEnd.y - localStart.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            -(localStart.x * deltaX + localStart.y * deltaY) / lengthSquared,
          ),
        );
  const x = localStart.x + fraction * deltaX;
  const y = localStart.y + fraction * deltaY;
  return {
    point: {
      lat: point.lat + (y / EARTH_RADIUS_M) * TO_DEGREES,
      lng:
        point.lng +
        (x / (EARTH_RADIUS_M * longitudeScale)) * TO_DEGREES,
    },
    distanceM: Math.hypot(x, y),
    fraction,
  };
}

const work = { calls: 0, boundedSearches: 0, fullSearches: 0, segmentProjections: 0, skippedSegments: 0 };
export function getRouteMatchingWork() { return { ...work }; }

/** First cumulative vertex >= bound (or > bound for the upper edge). */
function distanceBound(values: readonly number[], bound: number, upper: boolean): number {
  let low = 0; let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] < bound || (upper && values[middle] === bound)) low = middle + 1;
    else high = middle;
  }
  return low;
}

const distanceCache = new WeakMap<readonly LatLng[], number[]>();
/** Segments joined directly or only through zero-length (repeated-vertex) segments. */
function segmentsAreContinuous(cumulative: readonly number[], left: number, right: number): boolean {
  const lower = Math.min(left, right), upper = Math.max(left, right);
  return upper - lower <= 1 || cumulative[upper] === cumulative[lower + 1];
}

/** The point at a given along-route distance (clamped to the path). */
function pointAlongPath(path: readonly LatLng[], cumulative: readonly number[], distanceM: number): LatLng {
  const index = Math.min(path.length - 2, Math.max(0, distanceBound(cumulative, distanceM, true) - 1));
  const length = cumulative[index + 1] - cumulative[index];
  const fraction = length > 0 ? clamp01((distanceM - cumulative[index]) / length) : 0;
  return {
    lat: path[index].lat + (path[index + 1].lat - path[index].lat) * fraction,
    lng: path[index].lng + (path[index + 1].lng - path[index].lng) * fraction,
  };
}

function cumulativeDistances(path: readonly LatLng[]): number[] {
  const cached = distanceCache.get(path);
  if (cached) return cached;
  const distances = new Array<number>(path.length).fill(0);
  for (let index = 1; index < path.length; index += 1) {
    distances[index] =
      distances[index - 1] + haversineMeters(path[index - 1], path[index]);
  }
  distanceCache.set(path, distances);
  return distances;
}

/**
 * Match one accepted GNSS fix against geometry already ordered in the active
 * travel direction. Candidate scoring combines proximity, heading and
 * temporal continuity, so a marginally closer opposite/earlier carriageway
 * cannot win merely on distance.
 */
export function matchRoutePosition(
  rawPoint: LatLng,
  path: readonly LatLng[],
  headingDegrees?: number,
  previous?: PreviousRouteMatch | null,
  positionUncertaintyM = 25,
  maximumProgressChangeM?: number,
  /**
   * Forward progress the bus can have made since a fresh previous match (see
   * plausibleProgressBound). Near an out-and-back turnaround both carriageways
   * fall inside the progress window; a fix drifting into the median must not
   * be read as the bus having already driven round to the far side.
   */
  plausibleProgressM?: number,
): RouteMatch | null {
  work.calls++;
  if (path.length < 2) return null;
  const cumulative = cumulativeDistances(path);
  let firstSegment = 0; let endSegment = path.length - 1;
  // This narrows the existing physical-progress gate, not a vertex-count
  // heuristic. Every interval intersecting that gate remains eligible,
  // including parallel roads, loop legs, long segments and repeated vertices.
  if (previous && Number.isFinite(previous.alongRouteDistanceM) &&
      maximumProgressChangeM !== undefined && Number.isFinite(maximumProgressChangeM) &&
      maximumProgressChangeM >= 0 && Number.isFinite(cumulative.at(-1))) {
    const roundingPad = Number.EPSILON * Math.max(1, Math.abs(previous.alongRouteDistanceM), maximumProgressChangeM) * 4;
    const minimum = previous.alongRouteDistanceM - maximumProgressChangeM - roundingPad;
    const maximum = previous.alongRouteDistanceM + maximumProgressChangeM + roundingPad;
    firstSegment = Math.max(0, distanceBound(cumulative, minimum, false) - 1);
    endSegment = Math.min(path.length - 1, distanceBound(cumulative, maximum, true));
    work.boundedSearches++;
  } else {
    // Cold start, expired/session/geometry-invalidated prior, or absent/invalid
    // bounds keep the full ambiguity/reacquisition scan.
    work.fullSearches++;
  }
  work.segmentProjections += endSegment - firstSegment;
  work.skippedSegments += path.length - 1 - (endSegment - firstSegment);
  const ambiguityWindow = Math.max(
    6,
    Math.min(12, Math.max(0, positionUncertaintyM) * 0.25),
  );
  // Only a candidate reached by a shortcut (far more route than straight-line
  // displacement: round a loop or turnaround) can be implausible progress.
  // On an ordinary road along-route and straight-line progress agree, so a
  // stale or low speed can never drag the match backwards there.
  const priorPoint = previous && plausibleProgressM !== undefined && Number.isFinite(plausibleProgressM)
    ? pointAlongPath(path, cumulative, previous.alongRouteDistanceM) : undefined;
  let best:
    | (RouteMatch & { score: number; segmentLengthM: number })
    | null = null;
  const candidates: Array<{
    segmentIndex: number;
    score: number;
    point: LatLng;
    alongRouteDistanceM: number;
  }> = [];

  for (let segmentIndex = firstSegment; segmentIndex < endSegment; segmentIndex += 1) {
    const projection = projectToSegment(
      rawPoint,
      path[segmentIndex],
      path[segmentIndex + 1],
    );
    const segmentLengthM =
      cumulative[segmentIndex + 1] - cumulative[segmentIndex];
    const alongRouteDistanceM =
      cumulative[segmentIndex] + projection.fraction * segmentLengthM;
    // Bound physical progress, independent of polyline vertex density.
    if (previous && maximumProgressChangeM !== undefined &&
        Math.abs(alongRouteDistanceM - previous.alongRouteDistanceM) > maximumProgressChangeM) continue;
    const headingDifference =
      headingDegrees === undefined
        ? null
        : angularDifference(
            headingDegrees,
            segmentHeading(path[segmentIndex], path[segmentIndex + 1]),
          );

    const backwardsM = previous
      ? Math.max(0, previous.alongRouteDistanceM - alongRouteDistanceM - 15)
      : 0;
    const segmentJump = previous
      ? Math.max(0, Math.abs(segmentIndex - previous.segmentIndex) - 25)
      : 0;
    const progressM = previous ? alongRouteDistanceM - previous.alongRouteDistanceM : 0;
    const unexplainedForwardM = priorPoint
      ? Math.max(0, Math.min(progressM - Math.max(0, plausibleProgressM!),
        progressM - haversineMeters(priorPoint, projection.point) - ambiguityWindow))
      : 0;
    const score =
      projection.distanceM +
      (headingDifference ?? 0) * 0.28 +
      backwardsM * 2 +
      unexplainedForwardM +
      segmentJump * 3;

    candidates.push({ segmentIndex, score, point: projection.point, alongRouteDistanceM });

    if (!best || score < best.score) {
      best = {
        point: projection.point,
        segmentIndex,
        segmentFraction: projection.fraction,
        distanceToRouteM: projection.distanceM,
        alongRouteDistanceM,
        headingDifference,
        matchConfidence: 0,
        isAmbiguous: false,
        score,
        segmentLengthM,
      };
    }
  }

  if (!best) return null;
  // Adjacent segments are one continuous route leg, including at a sharp
  // turn, and so is a nearby projection reached by about its straight-line
  // distance along the route (densely sampled vertices). Exclude them before
  // looking for a genuinely competing crossing farther along a self-intersecting
  // route, which is reached only by travelling a loop or out-and-back leg.
  let competingScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!segmentsAreContinuous(cumulative, candidate.segmentIndex, best.segmentIndex) &&
        Math.abs(candidate.alongRouteDistanceM - best.alongRouteDistanceM) >
          haversineMeters(candidate.point, best.point) + ambiguityWindow) {
      competingScore = Math.min(competingScore, candidate.score);
    }
  }
  const competingGeometry = Number.isFinite(competingScore);
  const isAmbiguous =
    competingGeometry &&
    Number.isFinite(competingScore) &&
    competingScore - best.score <= ambiguityWindow;
  const distanceConfidence = clamp01(
    1 - best.distanceToRouteM / OFF_ROUTE_DISTANCE_M,
  );
  const headingConfidence =
    best.headingDifference === null
      ? 0.65
      : clamp01(1 - best.headingDifference / 120);
  const continuityConfidence = previous
    ? clamp01(1 - Math.abs(best.segmentIndex - previous.segmentIndex) / 30) *
      (Math.max(0, previous.alongRouteDistanceM - best.alongRouteDistanceM - 15) > 0
        ? 0.25
        : 1)
    : 0.65;
  best.isAmbiguous = isAmbiguous;
  best.matchConfidence = Number(
    (
      (distanceConfidence * 0.55 +
        headingConfidence * 0.25 +
        continuityConfidence * 0.2) *
      (isAmbiguous ? 0.55 : 1)
    ).toFixed(3),
  );
  const { score: _score, segmentLengthM: _segmentLengthM, ...match } = best;
  void _score;
  void _segmentLengthM;
  return match;
}

/**
 * A high-quality fix far from the route can confirm immediately. Ordinary or
 * unmatchable fixes require two consecutive reliable moving samples; missing
 * matches are deliberately never classified as a strong deviation.
 */
export function evaluateRouteAdherence(
  previousState: RouteAdherenceState | undefined,
  previousOffRouteSamples: number,
  match: RouteMatch | null,
  reliablyMoving: boolean,
): RouteAdherenceDecision {
  if (
    match &&
    !match.isAmbiguous &&
    match.distanceToRouteM <= ROUTE_MATCH_DISTANCE_M &&
    match.matchConfidence >= 0.45
  ) {
    return {
      routeState:
        previousState === "ON_NEW_ROUTE" ? "ON_NEW_ROUTE" : "ON_ROUTE",
      offRouteSampleCount: 0,
      shouldReroute: false,
    };
  }

  // A close projection at an intersection or beside a parallel carriageway
  // is not evidence of the travelled segment. Keep it observable, but do not
  // count an ambiguous snap toward rerouting.
  if (match?.isAmbiguous) {
    return {
      routeState:
        previousState === "REROUTING" ? "REROUTING" : "POSSIBLE_OFF_ROUTE",
      offRouteSampleCount: previousOffRouteSamples,
      shouldReroute: false,
    };
  }

  if (!reliablyMoving) {
    return {
      routeState:
        previousState === "REROUTING"
          ? "REROUTING"
          : "POSSIBLE_OFF_ROUTE",
      offRouteSampleCount: previousOffRouteSamples,
      shouldReroute: false,
    };
  }

  const strongDeviation =
    match !== null && match.distanceToRouteM >= STRONG_OFF_ROUTE_DISTANCE_M;

  const offRouteSampleCount = Math.min(
    OFF_ROUTE_CONFIRMATION_SAMPLES,
    strongDeviation
      ? OFF_ROUTE_CONFIRMATION_SAMPLES
      : previousOffRouteSamples + 1,
  );
  const confirmed = offRouteSampleCount >= OFF_ROUTE_CONFIRMATION_SAMPLES;
  return {
    routeState:
      confirmed && previousState === "REROUTING"
        ? "REROUTING"
        : confirmed
          ? "OFF_ROUTE"
          : "POSSIBLE_OFF_ROUTE",
    offRouteSampleCount,
    shouldReroute: confirmed && previousState !== "REROUTING",
  };
}
