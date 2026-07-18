"use client";

import { useEffect, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";

interface LatLng {
  lat: number;
  lng: number;
}

interface DirectionsRouteProps {
  stops: LatLng[];
  color?: string;
  hasBuses?: boolean;
}

const CHUNK_SIZE = 9; // Google free tier allows max 8 waypoints (10 total points: origin + 8 + destination)

/**
 * Renders a road-snapped route using the Google Maps Directions API.
 *
 * For routes with more than 9 stops, it automatically chunks the stops into
 * overlapping segments of CHUNK_SIZE (sharing the last stop of one chunk as
 * the first stop of the next) so they connect seamlessly. This allows an
 * unlimited number of stops while staying within the free tier limit.
 */
export default function DirectionsRoute({ stops, color = "#3b82f6", hasBuses = false }: DirectionsRouteProps) {
  const map = useMap();
  const renderersRef = useRef<google.maps.DirectionsRenderer[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!map || stops.length < 2) return;

    // Clear previous renderers
    renderersRef.current.forEach(r => r.setMap(null));
    renderersRef.current = [];
    setError(false);

    const service = new google.maps.DirectionsService();

    // Split stops into overlapping chunks of CHUNK_SIZE
    // e.g. stops [0..8], [8..16], [16..24] — shares boundary stops
    const chunks: LatLng[][] = [];
    for (let i = 0; i < stops.length - 1; i += CHUNK_SIZE - 1) {
      chunks.push(stops.slice(i, i + CHUNK_SIZE));
      if (i + CHUNK_SIZE >= stops.length) break;
    }

    let isMounted = true;

    const fetchChunks = async () => {
      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        if (!isMounted) break;
        const chunk = chunks[chunkIdx];
        if (chunk.length < 2) continue;

        const origin = chunk[0];
        const destination = chunk[chunk.length - 1];
        const waypoints = chunk.slice(1, -1).map(p => ({
          location: new google.maps.LatLng(p.lat, p.lng),
          stopover: false, // false = faster, treats as passthrough
        }));

        const renderer = new google.maps.DirectionsRenderer({
          suppressMarkers: true,
          preserveViewport: true,
          polylineOptions: {
            strokeColor: color,
            strokeWeight: hasBuses ? 5 : 3,
            strokeOpacity: hasBuses ? 0.9 : 0.5,
            zIndex: 10,
          },
        });
        renderer.setMap(map);
        renderersRef.current.push(renderer);

        await new Promise<void>((resolve) => {
          service.route(
            {
              origin: new google.maps.LatLng(origin.lat, origin.lng),
              destination: new google.maps.LatLng(destination.lat, destination.lng),
              waypoints,
              travelMode: google.maps.TravelMode.DRIVING,
              optimizeWaypoints: false,
              drivingOptions: {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel.BEST_GUESS,
              },
            },
            (result, status) => {
              if (status === google.maps.DirectionsStatus.OK && result) {
                renderer.setDirections(result);
              } else {
                console.warn(`[DirectionsRoute] Chunk ${chunkIdx} failed: ${status}. Falling back to polyline.`);
                renderer.setMap(null);
                const fallback = new google.maps.Polyline({
                  path: chunk.map(p => ({ lat: p.lat, lng: p.lng })),
                  strokeColor: color,
                  strokeWeight: hasBuses ? 4 : 2.5,
                  strokeOpacity: 0.6,
                  map,
                });
                (renderersRef.current as any[]).push({ setMap: (m: any) => fallback.setMap(m) });
                setError(true);
              }
              // Wait 300ms before resolving to prevent OVER_QUERY_LIMIT rate limiting
              setTimeout(resolve, 300);
            }
          );
        });
      }
    };

    fetchChunks();

    return () => {
      isMounted = false;
      renderersRef.current.forEach(r => r.setMap(null));
      renderersRef.current = [];
    };
  }, [map, stops, color, hasBuses]);

  return error ? (
    <div
      style={{
        position: "absolute",
        bottom: 100,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(245, 158, 11, 0.15)",
        border: "1px solid rgba(245, 158, 11, 0.3)",
        color: "#fbbf24",
        borderRadius: 10,
        padding: "6px 14px",
        fontSize: 11,
        fontWeight: 600,
        pointerEvents: "none",
        zIndex: 50,
        whiteSpace: "nowrap",
      }}
    >
      ⚠ Some route segments showing straight-line (Directions API limit)
    </div>
  ) : null;
}
