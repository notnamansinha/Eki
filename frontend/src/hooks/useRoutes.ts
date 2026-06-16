import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface RouteWaypoint {
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
  name: string;
  color: string;
  stops: RouteStop[];
  waypoints: RouteWaypoint[];
  /** Pre-computed encoded polyline from Google Maps (stored in Firestore during seed) */
  polyline?: string;
  /** Pre-computed route distance in meters */
  distanceMeters?: number;
  /** Pre-computed route duration string e.g. "600s" */
  duration?: string;
}

export function useRoutes() {
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "routes"), (snapshot) => {
      const fetchedRoutes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as RouteData[];
      
      setRoutes(fetchedRoutes);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching routes from Firestore:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { routes, loading };
}
