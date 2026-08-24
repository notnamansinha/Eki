import { decodePolyline, type LatLng } from "./polyline";

/**
 * Live maps require road geometry and must not imply that straight lines
 * between stops are drivable. The route editor may opt into that simple
 * fallback while a route is still being drafted.
 */
export function routeDisplayPath(
  polyline: string | undefined,
  stops: readonly LatLng[],
  requireRoadGeometry: boolean,
): LatLng[] {
  if (polyline) {
    try {
      const decoded = decodePolyline(polyline);
      if (decoded.length >= 2) return decoded;
    } catch {
      // The caller can request cached Routes API repair for invalid geometry.
    }
  }
  return requireRoadGeometry ? [] : [...stops];
}
