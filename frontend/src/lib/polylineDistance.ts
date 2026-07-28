import type { LatLng } from "./polyline";
import { getDistanceMeters } from "./mapUtils";
import { snapToPolyline, type SnapOptions } from "./snapToPolyline";

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

  const fromSnap = snapToPolyline(from, path, options.from);
  const toSnap = snapToPolyline(to, path, options.to);
  if (!fromSnap.snapped || !toSnap.snapped) {
    return getDistanceMeters(from, to);
  }

  const cumulative = new Array<number>(path.length).fill(0);
  for (let index = 1; index < path.length; index += 1) {
    cumulative[index] =
      cumulative[index - 1] + getDistanceMeters(path[index - 1], path[index]);
  }
  const position = (segmentIndex: number, fraction: number) => {
    const segmentLength = getDistanceMeters(
      path[segmentIndex],
      path[segmentIndex + 1],
    );
    return cumulative[segmentIndex] + segmentLength * fraction;
  };

  return Math.abs(
    position(toSnap.segmentIndex, toSnap.segmentFraction) -
      position(fromSnap.segmentIndex, fromSnap.segmentFraction),
  );
}
