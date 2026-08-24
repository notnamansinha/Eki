"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { LatLng } from "@/lib/polyline";
import { auth } from "@/lib/firebaseAuth";
import { apiRequest } from "@/lib/apiClient";
import { routeDisplayPath } from "@/lib/routeDisplayPath";

const geometryRequests = new Map<string, Promise<string>>();

function requestRoadGeometry(routeId: string): Promise<string> {
  const existing = geometryRequests.get(routeId);
  if (existing) return existing;
  const request = (async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("Route geometry requires authentication.");
    const token = await currentUser.getIdToken();
    const payload = await apiRequest<{ polyline?: unknown }>(
      `/api/routes/${encodeURIComponent(routeId)}/geometry`,
      {
        headers: { Authorization: `Bearer ${token}` },
        fallbackError: "Unable to load road geometry.",
      },
    );
    if (
      typeof payload.polyline !== "string" ||
      routeDisplayPath(payload.polyline, [], true).length < 2
    ) {
      throw new Error("Route geometry service returned an invalid polyline.");
    }
    return payload.polyline;
  })().finally(() => {
    if (geometryRequests.get(routeId) === request) {
      geometryRequests.delete(routeId);
    }
  });
  geometryRequests.set(routeId, request);
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
}

/**
 * Renders the road-snapped geometry stored with the route. This deliberately
 * does not call the browser Directions service: rendering a map must not add
 * routing cost, quota pressure, or delay to the live GNSS stream.
 */
export default function DirectionsRoute({ routeId, stops, polyline, polylineQuality, color = "#3b82f6", hasBuses = false }: DirectionsRouteProps) {
  const map = useMap();
  const outlineRef = useRef<google.maps.Polyline | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const [repairedGeometry, setRepairedGeometry] = useState<{
    routeId: string;
    polyline: string;
  } | null>(null);
  const trustedStoredPolyline =
    !routeId || polylineQuality === "HIGH_QUALITY" ? polyline : undefined;
  const storedPath = useMemo(
    () => routeDisplayPath(trustedStoredPolyline, stops, Boolean(routeId)),
    [routeId, stops, trustedStoredPolyline],
  );
  const repairedPolyline =
    repairedGeometry && repairedGeometry.routeId === routeId
      ? repairedGeometry.polyline
      : undefined;
  const path = useMemo(() => {
    return repairedPolyline
      ? routeDisplayPath(repairedPolyline, stops, Boolean(routeId))
      : storedPath;
  }, [repairedPolyline, routeId, stops, storedPath]);

  useEffect(() => {
    if (!routeId || storedPath.length >= 2) return;
    let active = true;
    void requestRoadGeometry(routeId)
      .then((nextPolyline) => {
        if (active) setRepairedGeometry({ routeId, polyline: nextPolyline });
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
  }, [routeId, storedPath]);

  useEffect(() => {
    outlineRef.current?.setMap(null);
    outlineRef.current = null;
    lineRef.current?.setMap(null);
    lineRef.current = null;
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
      strokeColor: color,
      strokeWeight: hasBuses ? 5 : 3,
      strokeOpacity: hasBuses ? 1 : 0.8,
      zIndex: 21,
      map,
    });
    outlineRef.current = outline;
    lineRef.current = line;

    return () => {
      outline.setMap(null);
      line.setMap(null);
    };
  }, [map, path, color, hasBuses]);

  return null;
}
