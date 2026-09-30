import { decodePolyline, encodePolyline, type LatLng } from "./polylineUtils";

export const MAX_ROUTE_STOPS = 100;
const MAX_REQUEST_POINTS = 27; // Google Routes: origin + 25 intermediates + destination.

interface Geometry {
  polyline: string;
  distanceMeters: number;
  duration: string;
}

/** Bounded parallel requests, overlapping exactly one stop, never reordering stops. */
export async function computeOrderedRouteGeometry(
  points: LatLng[],
  compute: (chunk: LatLng[]) => Promise<Geometry>,
): Promise<Geometry> {
  // A live reroute adds the current position before up to 100 remaining stops.
  if (points.length < 2 || points.length > MAX_ROUTE_STOPS + 1) {
    throw new Error("Invalid route waypoint count");
  }
  const chunks: LatLng[][] = [];
  for (let index = 0; index < points.length - 1; index += MAX_REQUEST_POINTS - 1) {
    chunks.push(points.slice(index, index + MAX_REQUEST_POINTS));
  }
  const results = await Promise.all(chunks.map(compute));
  if (results.length === 1) return results[0];
  const path: LatLng[] = [];
  let distanceMeters = 0;
  let seconds = 0;
  for (const result of results) {
    const decoded = decodePolyline(result.polyline);
    const duration = /^(\d+(?:\.\d+)?)s$/.exec(result.duration);
    if (decoded.length < 2 || !duration || !Number.isFinite(result.distanceMeters) || result.distanceMeters < 0) {
      throw new Error("Invalid route chunk geometry");
    }
    for (const point of decoded) {
      const last = path.at(-1);
      if (!last || point.lat !== last.lat || point.lng !== last.lng) path.push(point);
    }
    distanceMeters += result.distanceMeters;
    seconds += Number(duration[1]);
  }
  const polyline = encodePolyline(path);
  if (polyline.length > 500_000) throw new Error("Combined route geometry is too large");
  return { polyline, distanceMeters, duration: `${seconds}s` };
}
