import type { LatLng } from "./polyline";
import { preparePolylineDistanceIndex } from "./polylineDistance";

/** Slice a road by distance, retaining every bend and interpolating only its boundaries. */
export function sliceRoadPath(path: readonly LatLng[], from: number, to: number): LatLng[] {
  if (path.length < 2 || to - from < 0.01) return [];
  const { cumulative } = preparePolylineDistanceIndex(path);
  const total = cumulative[cumulative.length - 1];
  const start = Math.max(0, Math.min(total, from));
  const end = Math.max(start, Math.min(total, to));
  if (end - start < 0.01) return [];
  const pointAt = (distance: number): LatLng => {
    let index = 0;
    while (index < path.length - 2 && cumulative[index + 1] < distance) index++;
    const length = cumulative[index + 1] - cumulative[index];
    const fraction = length > 0 ? (distance - cumulative[index]) / length : 0;
    return { lat: path[index].lat + fraction * (path[index + 1].lat - path[index].lat),
      lng: path[index].lng + fraction * (path[index + 1].lng - path[index].lng) };
  };
  return [pointAt(start), ...path.filter((_, index) => cumulative[index] > start + 0.01 && cumulative[index] < end - 0.01), pointAt(end)];
}

/** Bound partial-leg paint to the server's next stop; a visual projection cannot skip a stop. */
export function routeProgressPaths(path: readonly LatLng[], legs: ReadonlyMap<number, LatLng[]>, nextIndex: number,
  matchedDistance?: number): { completed: LatLng[]; active: LatLng[]; matchedDistanceM?: number } {
  let start = 0;
  for (const [index, leg] of legs) {
    const distances = preparePolylineDistanceIndex(leg).cumulative;
    const end = start + distances[distances.length - 1];
    if (index === nextIndex) {
      const validMatch = typeof matchedDistance === "number" && Number.isFinite(matchedDistance) &&
        matchedDistance >= start && matchedDistance <= end;
      const split = validMatch ? matchedDistance : start;
      return { completed: sliceRoadPath(path, 0, split), active: sliceRoadPath(path, split, end),
        ...(validMatch ? { matchedDistanceM: matchedDistance } : {}) };
    }
    start = end;
  }
  return { completed: [], active: [] };
}
