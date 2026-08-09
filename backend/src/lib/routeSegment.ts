import { closestPolylineIndex, type LatLng } from "./polylineUtils";

export interface SegmentStop extends LatLng {
  id: string;
  waypointIndex?: number;
}

export interface RouteSegment<T extends SegmentStop> {
  coordinates: LatLng[];
  stops: T[];
}

/** Slices a stored route in the requested direction and orders its stops. */
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

  const stopIndices = new Map<T, number>();
  for (const stop of stops) {
    stopIndices.set(stop, closestPolylineIndex(fullCoordinates, stop));
  }
  const startIndex = stopIndices.get(start) ?? 0;
  const endIndex = stopIndices.get(end) ?? 0;
  if (startIndex === endIndex) {
    throw new Error("Start and end stops are too close together on the polyline.");
  }

  const direction = startIndex < endIndex ? 1 : -1;
  const lower = Math.min(startIndex, endIndex);
  const upper = Math.max(startIndex, endIndex);
  if (via) {
    const viaIndex = stopIndices.get(via) ?? closestPolylineIndex(fullCoordinates, via);
    if (viaIndex < lower || viaIndex > upper) {
      throw new Error("Via stop is not between the selected start and end stops.");
    }
  }

  const naturalSlice = fullCoordinates.slice(lower, upper + 1);
  const coordinates = direction === 1 ? naturalSlice : [...naturalSlice].reverse();
  const orderedStops = stops
    .filter((stop) => {
      const index = stopIndices.get(stop);
      return index !== undefined && index >= lower && index <= upper;
    })
    .sort((left, right) =>
      direction * ((stopIndices.get(left) ?? 0) - (stopIndices.get(right) ?? 0)),
    );

  return { coordinates, stops: orderedStops };
}
