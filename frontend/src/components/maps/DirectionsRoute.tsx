"use client";

import { useEffect, useMemo, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { LatLng } from "@/lib/polyline";
import { auth } from "@/lib/firebaseAuth";
import { apiRequest } from "@/lib/apiClient";
import { routeDisplayPath } from "@/lib/routeDisplayPath";
import { routeLegPaths } from "@/lib/routeLegPaths";

const geometryRequests = new Map<string, Promise<string>>();

function requestRoadGeometry(
  routeId: string,
  direction: "forward" | "reverse",
): Promise<string> {
  const requestKey = `${routeId}:${direction}`;
  const existing = geometryRequests.get(requestKey);
  if (existing) return existing;
  const request = (async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("Route geometry requires authentication.");
    const token = await currentUser.getIdToken();
    const payload = await apiRequest<{
      polyline?: unknown;
      forwardPolyline?: unknown;
      reversePolyline?: unknown;
    }>(
      `/api/routes/${encodeURIComponent(routeId)}/geometry`,
      {
        headers: { Authorization: `Bearer ${token}` },
        fallbackError: "Unable to load road geometry.",
      },
    );
    const directionalPolyline = direction === "reverse"
      ? payload.reversePolyline
      : payload.forwardPolyline ?? payload.polyline;
    if (
      typeof directionalPolyline !== "string" ||
      routeDisplayPath(directionalPolyline, [], true).length < 2
    ) {
      throw new Error("Route geometry service returned an invalid polyline.");
    }
    return directionalPolyline;
  })().finally(() => {
    if (geometryRequests.get(requestKey) === request) {
      geometryRequests.delete(requestKey);
    }
  });
  geometryRequests.set(requestKey, request);
  return request;
}

interface DirectionsRouteProps {
  routeId?: string;
  stops: LatLng[];
  /** Encoded road geometry saved when an administrator creates or edits a route. */
  polyline?: string;
  polylineQuality?: "HIGH_QUALITY";
  color?: string;
  hasBuses?: boolean;
  /** Backend next-stop indices in travel order. Empty means no active leg. */
  nextStopIndices?: readonly number[];
  /** First required stop in a dynamic path that starts at the bus. */
  firstStopIndex?: number;
  direction: "forward" | "reverse";
  onGeometryReady?: (path: LatLng[]) => void;
}

/**
 * Renders the road-snapped geometry stored with the route. This deliberately
 * does not call the browser Directions service: rendering a map must not add
 * routing cost, quota pressure, or delay to the live GNSS stream.
 */
export default function DirectionsRoute({ routeId, stops, polyline, polylineQuality, hasBuses = false, nextStopIndices, firstStopIndex = 0, direction, onGeometryReady }: DirectionsRouteProps) {
  const map = useMap();
  const stopsKey = JSON.stringify(stops);
  const stableStops = useMemo(() => JSON.parse(stopsKey) as LatLng[], [stopsKey]);
  const [repairedGeometry, setRepairedGeometry] = useState<{
    routeId: string;
    direction: "forward" | "reverse";
    polyline: string;
  } | null>(null);
  const trustedStoredPolyline =
    !routeId || polylineQuality === "HIGH_QUALITY" ? polyline : undefined;
  const storedPath = useMemo(
    () => routeDisplayPath(trustedStoredPolyline, stableStops, Boolean(routeId)),
    [routeId, stableStops, trustedStoredPolyline],
  );
  const repairedPolyline =
    repairedGeometry &&
    repairedGeometry.routeId === routeId &&
    repairedGeometry.direction === direction
      ? repairedGeometry.polyline
      : undefined;
  const path = useMemo(() => {
    return repairedPolyline
      ? routeDisplayPath(repairedPolyline, stableStops, Boolean(routeId))
      : storedPath;
  }, [repairedPolyline, routeId, stableStops, storedPath]);
  const legs = useMemo(() => routeLegPaths(path, stableStops, firstStopIndex), [path, stableStops, firstStopIndex]);
  // Location ticks do not recreate road overlays or reproject the itinerary.
  const activeIndices = JSON.stringify([...new Set(nextStopIndices?.map(index => index === 0 ? 1 : index) ?? [])].sort((a, b) => a - b));

  useEffect(() => {
    onGeometryReady?.(path);
  }, [onGeometryReady, path]);

  useEffect(() => {
    if (!routeId || storedPath.length >= 2) return;
    let active = true;
    void requestRoadGeometry(routeId, direction)
      .then((nextPolyline) => {
        if (active) setRepairedGeometry({ routeId, direction, polyline: nextPolyline });
      })
      .catch((error: unknown) => {
        console.warn(
          `[Routes] Road geometry unavailable for ${routeId}:`,
          error instanceof Error ? error.message : error,
        );
      });
    return () => {
      active = false;
    };
  }, [direction, routeId, storedPath]);

  useEffect(() => {
    if (!map || path.length < 2) return;

    const outline = new google.maps.Polyline({
      path,
      strokeColor: "#09090b",
      strokeWeight: hasBuses ? 9 : 7,
      strokeOpacity: hasBuses ? 0.72 : 0.5,
      zIndex: 20,
      map,
    });
    const line = new google.maps.Polyline({
      path,
      strokeColor: "#71717a",
      strokeWeight: hasBuses ? 5 : 3,
      strokeOpacity: hasBuses ? 1 : 0.8,
      zIndex: 21,
      map,
    });
    const active = (JSON.parse(activeIndices) as number[]).flatMap(index => {
      const leg = legs.get(index);
      return leg ? [new google.maps.Polyline({ path: leg, strokeColor: "#3b82f6", strokeWeight: hasBuses ? 5 : 3, strokeOpacity: 1, zIndex: 23, map })] : [];
    });

    return () => {
      outline.setMap(null);
      line.setMap(null);
      active.forEach(leg => leg.setMap(null));
    };
  }, [map, path, hasBuses, legs, activeIndices]);

  return null;
}
