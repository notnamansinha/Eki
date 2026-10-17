import type { LatLng } from "./polyline";
import { preparePolylineDistanceIndex } from "./polylineDistance";
import { snapToPolyline } from "./snapToPolyline";
import { getDistanceMeters } from "./mapUtils";

interface Projection { distance: number; point: LatLng; score: number; previous?: Projection }

/** Cut existing road geometry at ordered stop projections; never draw stop chords.
 * A dynamic path starts at the bus, with firstStopIndex its first required stop.
 * Missing/ambiguous itinerary geometry stays grey instead of coloring a guessed leg.
 */
export function routeLegPaths(
  path: readonly LatLng[], stops: readonly LatLng[], firstStopIndex = 0,
): ReadonlyMap<number, LatLng[]> {
  const legs = new Map<number, LatLng[]>();
  if (path.length < 2 || stops.length < 2 || !Number.isSafeInteger(firstStopIndex) ||
      firstStopIndex < 0 || firstStopIndex >= stops.length) return legs;
  const { cumulative } = preparePolylineDistanceIndex(path);
  let previous: Projection[] = [];
  for (let index = firstStopIndex; index < stops.length; index++) {
    const candidates: Projection[] = [];
    let best: Projection | undefined, cursor = 0;
    for (let segment = 0; segment < path.length - 1; segment++) {
      const atOrigin = firstStopIndex === 0 && index === 0;
      const atDestination = index === stops.length - 1;
      if ((atOrigin && segment !== 0) || (atDestination && segment !== path.length - 2)) continue;
      // The provider's endpoints define the full legal approach/departure. A
      // later near-terminal crossing must not trim that road out of its leg.
      const endpoint = atOrigin ? path[0] : atDestination ? path[path.length - 1] : undefined;
      const distanceM = endpoint ? getDistanceMeters(stops[index], endpoint) : 0;
      const snap = endpoint ? { point: endpoint, distanceM, segmentFraction: atOrigin ? 0 : 1, snapped: distanceM <= 100 }
        : snapToPolyline(stops[index], [path[segment], path[segment + 1]], { maxDistanceM: 100 });
      if (!snap.snapped) continue;
      const distance = cumulative[segment] + snap.segmentFraction * (cumulative[segment + 1] - cumulative[segment]);
      // Prefix minima enforce itinerary order even where the road crosses itself.
      while (cursor < previous.length && previous[cursor].distance < distance - 0.01) {
        if (!best || previous[cursor].score < best.score) best = previous[cursor];
        cursor++;
      }
      if (index > firstStopIndex && !best) continue;
      candidates.push({ distance, point: snap.point, score: snap.distanceM ** 2 + (best?.score ?? 0), previous: best });
    }
    if (!candidates.length) return legs;
    previous = candidates;
  }
  let selected: Projection | undefined = previous.reduce((a, b) => a.score <= b.score ? a : b);
  const boundaries: Projection[] = [];
  while (selected) { boundaries.unshift(selected); selected = selected.previous; }
  for (let stopIndex = Math.max(1, firstStopIndex); stopIndex < stops.length; stopIndex++) {
    const end = boundaries[stopIndex - firstStopIndex];
    const start = stopIndex === firstStopIndex ? { distance: 0, point: path[0] } : boundaries[stopIndex - firstStopIndex - 1];
    if (end.distance - start.distance < 0.01) continue;
    legs.set(stopIndex, [start.point, ...path.filter((_, index) => cumulative[index] > start.distance + 0.01 && cumulative[index] < end.distance - 0.01), end.point]);
  }
  return legs;
}
