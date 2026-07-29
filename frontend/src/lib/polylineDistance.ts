import type { LatLng } from "./polyline";
import { getDistanceMeters } from "./mapUtils";
import { snapToPolyline, type SnapOptions } from "./snapToPolyline";

export interface PolylineDistanceIndex {
  path: readonly LatLng[];
  cumulative: readonly number[];
}

const distanceIndexCache = new WeakMap<object, PolylineDistanceIndex>();

export function preparePolylineDistanceIndex(
  path: readonly LatLng[],
): PolylineDistanceIndex {
  const cached = distanceIndexCache.get(path);
  if (cached) return cached;

  const cumulative = new Array<number>(path.length).fill(0);
  for (let index = 1; index < path.length; index += 1) {
    cumulative[index] =
      cumulative[index - 1] +
      getDistanceMeters(path[index - 1], path[index]);
  }
  const prepared = { path, cumulative };
  distanceIndexCache.set(path, prepared);
  return prepared;
}

export function positionAlongPolyline(
  point: LatLng,
  index: PolylineDistanceIndex,
  options?: SnapOptions,
): number | null {
  const { path, cumulative } = index;
  if (path.length < 2) return null;
  const snap = snapToPolyline(point, path, options);
  if (!snap.snapped) return null;
  const segmentLength = getDistanceMeters(
    path[snap.segmentIndex],
    path[snap.segmentIndex + 1],
  );
  return cumulative[snap.segmentIndex] + segmentLength * snap.segmentFraction;
}

export function distanceAlongPolyline(
  from: LatLng,
  to: LatLng,
  path: readonly LatLng[],
  options: {
    from?: SnapOptions;
    to?: SnapOptions;
  } = {},
): number {
  if (path.length < 2) return getDistanceMeters(from, to);

  const index = preparePolylineDistanceIndex(path);
  const fromPosition = positionAlongPolyline(from, index, options.from);
  const toPosition = positionAlongPolyline(to, index, options.to);
  if (fromPosition === null || toPosition === null) {
    return getDistanceMeters(from, to);
  }

  return Math.abs(toPosition - fromPosition);
}
