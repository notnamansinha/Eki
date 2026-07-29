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
  /** Pre-computed route distance in meters */
  distanceMeters?: number;
  /** Pre-computed route duration string e.g. "600s" */
  duration?: string;
}

export function useRoutes() {
  const { data: routes, loading } = useCollection<RouteData>("routes");
  return { routes, loading };
}
