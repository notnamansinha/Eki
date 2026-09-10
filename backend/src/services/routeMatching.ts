import { haversineMeters } from "../lib/geo";
import type { LatLng } from "../lib/polylineUtils";

const EARTH_RADIUS_M = 6_371_000;
const TO_RADIANS = Math.PI / 180;
const TO_DEGREES = 180 / Math.PI;

export const ROUTE_MATCH_DISTANCE_M = 45;
export const OFF_ROUTE_DISTANCE_M = 60;
export const OFF_ROUTE_CONFIRMATION_SAMPLES = 2;
export const STRONG_OFF_ROUTE_DISTANCE_M = 120;

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

function cumulativeDistances(path: readonly LatLng[]): number[] {
  const distances = new Array<number>(path.length).fill(0);
  for (let index = 1; index < path.length; index += 1) {
    distances[index] =
      distances[index - 1] + haversineMeters(path[index - 1], path[index]);
  }
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
): RouteMatch | null {
  if (path.length < 2) return null;
  const cumulative = cumulativeDistances(path);
  let best:
    | (RouteMatch & { score: number; segmentLengthM: number })
    | null = null;
  const candidates: Array<{
    segmentIndex: number;
    score: number;
  }> = [];

  for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex += 1) {
    const projection = projectToSegment(
      rawPoint,
      path[segmentIndex],
      path[segmentIndex + 1],
    );
    const segmentLengthM =
      cumulative[segmentIndex + 1] - cumulative[segmentIndex];
    const alongRouteDistanceM =
      cumulative[segmentIndex] + projection.fraction * segmentLengthM;
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
    const score =
      projection.distanceM +
      (headingDifference ?? 0) * 0.28 +
      backwardsM * 2 +
      segmentJump * 3;

    candidates.push({ segmentIndex, score });

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
  const ambiguityWindow = Math.max(
    6,
    Math.min(12, Math.max(0, positionUncertaintyM) * 0.25),
  );
  const bestHeading = segmentHeading(
    path[best.segmentIndex],
    path[best.segmentIndex + 1],
  );
  // Do not let an adjacent, collinear segment hide a genuinely competing
  // crossing farther along a self-intersecting route. Select the best
  // candidate only after filtering equivalent geometry.
  const competingCandidate = candidates
    .filter(({ segmentIndex }) => {
      if (segmentIndex === best.segmentIndex) return false;
      const headingDifference = angularDifference(
        bestHeading,
        segmentHeading(path[segmentIndex], path[segmentIndex + 1]),
      );
      const equivalentGeometry =
        Math.abs(best.segmentIndex - segmentIndex) <= 1 &&
        headingDifference <= 25;
      return !equivalentGeometry;
    })
    .sort((left, right) => left.score - right.score)[0];
  const competingScore = competingCandidate?.score ?? Number.POSITIVE_INFINITY;
  const competingGeometry = competingCandidate !== undefined;
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
