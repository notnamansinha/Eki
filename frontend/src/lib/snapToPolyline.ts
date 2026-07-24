import type { LatLng } from "./polyline";

const EARTH_RADIUS_M = 6_371_000;
const TO_RADIANS = Math.PI / 180;
const TO_DEGREES = 180 / Math.PI;

export interface SnapOptions {
  maxDistanceM?: number;
  preferredSegmentIndex?: number;
  maxSegmentJump?: number;
  headingDegrees?: number;
}

export interface SnapResult {
  point: LatLng;
  distanceM: number;
  segmentIndex: number;
  segmentFraction: number;
  snapped: boolean;
}

function angularDifference(a: number, b: number): number {
  const delta = Math.abs(((a - b + 540) % 360) - 180);
  return Math.min(delta, 180);
}

function segmentHeading(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * TO_RADIANS;
  const lat2 = b.lat * TO_RADIANS;
  const deltaLng = (b.lng - a.lng) * TO_RADIANS;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * TO_DEGREES + 360) % 360;
}

function projectToSegment(point: LatLng, a: LatLng, b: LatLng) {
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

  const start = toLocal(a);
  const end = toLocal(b);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, -(start.x * dx + start.y * dy) / lengthSquared),
        );
  const x = start.x + fraction * dx;
  const y = start.y + fraction * dy;

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

export function snapToPolyline(
  rawPoint: LatLng,
  path: readonly LatLng[],
  options: SnapOptions = {},
): SnapResult {
  const maxDistanceM = options.maxDistanceM ?? 50;
  if (
    path.length < 2 ||
    !Number.isFinite(rawPoint.lat) ||
    !Number.isFinite(rawPoint.lng)
  ) {
    return {
      point: rawPoint,
      distanceM: Number.POSITIVE_INFINITY,
      segmentIndex: -1,
      segmentFraction: 0,
      snapped: false,
    };
  }

  const preferred = options.preferredSegmentIndex;
  const maxJump = options.maxSegmentJump ?? 25;
  const hasContinuityHint =
    preferred !== undefined && preferred >= 0 && preferred < path.length - 1;

  let best:
    | {
        point: LatLng;
        distanceM: number;
        fraction: number;
        segmentIndex: number;
        score: number;
      }
    | undefined;

  for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex++) {
    if (hasContinuityHint && Math.abs(segmentIndex - preferred) > maxJump) {
      continue;
    }

    const projection = projectToSegment(
      rawPoint,
      path[segmentIndex],
      path[segmentIndex + 1],
    );
    const headingPenalty =
      options.headingDegrees === undefined
        ? 0
        : angularDifference(
            options.headingDegrees,
            segmentHeading(path[segmentIndex], path[segmentIndex + 1]),
          ) / 18;
    const score = projection.distanceM + headingPenalty;

    if (!best || score < best.score) {
      best = { ...projection, segmentIndex, score };
    }
  }

  // If continuity filtering found nothing plausible, reacquire globally.
  if (!best || best.distanceM > maxDistanceM) {
    if (hasContinuityHint) {
      return snapToPolyline(rawPoint, path, {
        ...options,
        preferredSegmentIndex: undefined,
      });
    }
    return {
      point: rawPoint,
      distanceM: best?.distanceM ?? Number.POSITIVE_INFINITY,
      segmentIndex: best?.segmentIndex ?? -1,
      segmentFraction: best?.fraction ?? 0,
      snapped: false,
    };
  }

  return {
    point: best.point,
    distanceM: best.distanceM,
    segmentIndex: best.segmentIndex,
    segmentFraction: best.fraction,
    snapped: true,
  };
}
