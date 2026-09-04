import type { LatLng } from "./polyline";
import { decodePolyline } from "./polyline";
import type { RouteData } from "@/hooks/useRoutes";

export interface ActiveRouteDisplay {
  polyline: string;
  version: number;
}

type RouteGeometrySource = Pick<
  RouteData,
  "polyline" | "rideDirection" | "reversePolyline" | "stops"
>;

/**
 * Resolve the ordered coordinate path a passenger map should render and use
 * for distance/ETA math.
 *
 * - Active dynamic-reroute geometry is accepted as-is: the backend encodes it
 *   in travel direction.
 * - A direction-specific `reversePolyline` is already in Z→A order, so it is
 *   NOT reversed for a reverse ride.
 * - Only legacy forward-only geometry (no directional polyline) is reversed to
 *   follow a reverse ride.
 * - Falls back to reversed stop coordinates when no decodable geometry exists.
 */
export function decodeRoutePathForDisplay(
  route: RouteGeometrySource,
  activeRoute: ActiveRouteDisplay | null,
): LatLng[] {
  const encoded = activeRoute?.polyline ?? route.polyline;
  if (encoded) {
    try {
      const decoded = decodePolyline(encoded);
      if (decoded.length >= 2) {
        if (activeRoute) return decoded;
        if (route.rideDirection === "reverse" && !route.reversePolyline) {
          return [...decoded].reverse();
        }
        return decoded;
      }
    } catch {
      // Fall back to stop coordinates below.
    }
  }
  return (route.stops ?? []).map((stop) => ({ lat: stop.lat, lng: stop.lng }));
}