import type { LatLng } from "./polylineUtils";

export interface SegmentStop extends LatLng {
  id: string;
  waypointIndex?: number;
}

export interface RouteSegment<T extends SegmentStop> {
  coordinates: LatLng[];
  stops: T[];
}

/**
 * Assigns each stop, in itinerary order, a vertex on the directional polyline.
 * Indices never decrease, so a loop or out-and-back route whose later stops
 * share coordinates with earlier ones still resolves to the later visit.
 * Among order-preserving placements it minimises the summed squared distance.
 */
function projectStopsInOrder(coordinates: LatLng[], stops: SegmentStop[]): number[] {
  const count = coordinates.length;
  const choices: Int32Array[] = [];
  let previousCost: Float64Array | null = null;
  for (const stop of stops) {
    const cost = new Float64Array(count);
    const choice = new Int32Array(count);
    let prefixCost = previousCost ? Infinity : 0;
    let prefixIndex = -1;
    for (let index = 0; index < count; index++) {
      if (previousCost && previousCost[index] < prefixCost) {
        prefixCost = previousCost[index];
        prefixIndex = index;
      }
      const dLat = coordinates[index].lat - stop.lat;
      const dLng = coordinates[index].lng - stop.lng;
      cost[index] = dLat * dLat + dLng * dLng + prefixCost;
      choice[index] = prefixIndex;
    }
    choices.push(choice);
    previousCost = cost;
  }
  if (!previousCost) return [];
  // The itinerary ends where the directional polyline ends, so an equally good
  // later visit of the terminal stop wins over an earlier pass through it.
  let index = 0;
  for (let candidate = 1; candidate < count; candidate++) {
    if (previousCost[candidate] <= previousCost[index]) index = candidate;
  }
  const indices = new Array<number>(stops.length);
  for (let stopIndex = stops.length - 1; stopIndex >= 0; stopIndex--) {
    indices[stopIndex] = index;
    index = choices[stopIndex][index];
  }
  return indices;
}

/**
 * Slices a directional route polyline between two stops.
 *
 * `fullCoordinates` must already be the geometry for the direction of travel
 * and `stops` must be listed in that same travel order (reverse the stop list
 * for a reverse trip). The returned coordinates are always a forward slice.
 */
export function buildRouteSegment<T extends SegmentStop>(
  fullCoordinates: LatLng[],
  stops: T[],
  start: T,
  end: T,
  via?: T | null,
): RouteSegment<T> {
  if (fullCoordinates.length < 2) {
    throw new Error("Route polyline must contain at least two coordinates.");
  }

  const startPosition = stops.indexOf(start);
  const endPosition = stops.indexOf(end);
  if (startPosition < 0 || endPosition < 0) {
    throw new Error("Selected start or end stop is not part of the route.");
  }
  if (startPosition >= endPosition) {
    throw new Error("Start stop must come before the end stop in travel order.");
  }
  if (via) {
    const viaPosition = stops.indexOf(via);
    if (viaPosition <= startPosition || viaPosition >= endPosition) {
      throw new Error("Via stop is not between the selected start and end stops.");
    }
  }

  const indices = projectStopsInOrder(fullCoordinates, stops);
  const startIndex = indices[startPosition];
  const endIndex = indices[endPosition];
  if (startIndex >= endIndex) {
    throw new Error("Start and end stops are too close together on the polyline.");
  }

  return {
    coordinates: fullCoordinates.slice(startIndex, endIndex + 1),
    stops: stops.slice(startPosition, endPosition + 1),
  };
}
