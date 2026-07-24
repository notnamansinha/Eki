"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { decodePolyline, type LatLng } from "@/lib/polyline";


interface DirectionsRouteProps {
  stops: LatLng[];
  /** Encoded road geometry saved when an administrator creates or edits a route. */
  polyline?: string;
  color?: string;
  hasBuses?: boolean;
}

/**
 * Renders the road-snapped geometry stored with the route. This deliberately
 * does not call the browser Directions service: rendering a map must not add
 * routing cost, quota pressure, or delay to the live GNSS stream.
 */
export default function DirectionsRoute({ stops, polyline, color = "#3b82f6", hasBuses = false }: DirectionsRouteProps) {
  const map = useMap();
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const path = useMemo(() => {
    if (polyline) {
      try {
        const decoded = decodePolyline(polyline);
        if (decoded.length >= 2) return decoded;
      } catch {
        // A legacy route without valid geometry falls back to its saved stops.
      }
    }
    return stops;
  }, [polyline, stops]);

  useEffect(() => {
    lineRef.current?.setMap(null);
    lineRef.current = null;
    if (!map || path.length < 2) return;

    const line = new google.maps.Polyline({
      path,
      strokeColor: color,
      strokeWeight: hasBuses ? 5 : 3,
      strokeOpacity: hasBuses ? 0.9 : 0.6,
      zIndex: 10,
      map,
    });
    lineRef.current = line;

    return () => line.setMap(null);
  }, [map, path, color, hasBuses]);

  return null;
}
