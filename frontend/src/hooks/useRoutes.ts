import { useCollection } from "./useCollection";

interface RouteWaypoint {
  lat: number;
  lng: number;
}

export interface RouteStop {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
}

export interface RouteData {
  id: string;
  name: string; // e.g. "1A"
  type?: "up" | "down" | "circular";
  color: string;
  waypoints: RouteWaypoint[];
  stops: RouteStop[];
  /** Pre-computed encoded polyline from Google Maps (stored in Firestore during seed) */
  polyline?: string;
  /** Cache version: live maps require the detailed Routes API geometry. */
  polylineQuality?: "HIGH_QUALITY";
  /** Pre-computed route distance in meters */
  distanceMeters?: number;
  /** Pre-computed route duration string e.g. "600s" */
  duration?: string;
  /** View-only travel order for an active ride; never persisted on route documents. */
  rideDirection?: "forward" | "reverse";
}

/**
 * All routes from the Firestore `routes` collection, with loading and error
 * state. Each route carries its ordered stops and pre-computed geometry.
 */
export function useRoutes() {
  const { data: routes, loading, error, retry } = useCollection<RouteData>("routes");
  return { routes, loading, error, retry };
}
