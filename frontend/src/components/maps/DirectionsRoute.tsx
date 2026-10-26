"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { LatLng } from "@/lib/polyline";
import { auth } from "@/lib/firebaseAuth";
import { apiRequest } from "@/lib/apiClient";
import { routeDisplayPath } from "@/lib/routeDisplayPath";
import { routeLegPaths } from "@/lib/routeLegPaths";
import { publishedStopIndex } from "@/lib/publishedStopIndex";
import { routeProgressPaths } from "@/lib/routeProgressPaths";

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
  /** Backend indices in travel order. Omit for a colored preview; [] is a live road with no known active leg. */
  nextStopIndices?: readonly number[];
  /** Current accepted, confident match on this exact path; never an animated marker projection. */
  progressDistanceM?: number;
  /** Keep the confirmed configured prefix when this bus follows a separate reroute. */
  completedStopIndex?: number;
  /** A separate live geometry replaces this road's remaining itinerary. */
  hideRemaining?: boolean;
  /** Prevent retained configured progress crossing sessions or itinerary revisions. */
  progressContext?: string;
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
export default function DirectionsRoute({ routeId, stops, polyline, polylineQuality, color, hasBuses = false, nextStopIndices, progressDistanceM, completedStopIndex, hideRemaining = false, progressContext, firstStopIndex = 0, direction, onGeometryReady }: DirectionsRouteProps) {
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
  // Repair is only a fallback: a later trusted route edit must replace it.
  const path = useMemo(() => {
    return repairedPolyline && storedPath.length < 2
      ? routeDisplayPath(repairedPolyline, stableStops, Boolean(routeId))
      : storedPath;
  }, [repairedPolyline, routeId, stableStops, storedPath]);
  const legs = useMemo(() => routeLegPaths(path, stableStops, firstStopIndex), [path, stableStops, firstStopIndex]);
  // Location ticks do not recreate road overlays or reproject the itinerary.
  const activeIndices = JSON.stringify([...new Set(nextStopIndices?.flatMap(value => {
    const index = publishedStopIndex(value, stableStops.length);
    return index === undefined ? [] : [index === 0 ? 1 : index];
  }) ?? [])].sort((a, b) => a - b));
  const baseColor = nextStopIndices !== undefined ? "#3b82f6" : (color ?? "#3b82f6");
  const singleProgress = (JSON.parse(activeIndices) as number[]).length === 1;
  const completedIndex = publishedStopIndex(completedStopIndex, stableStops.length);
  const confirmedPrefix = useRef<{ path: LatLng[]; context: string; nextStopIndex: number;
    sections: ReturnType<typeof routeProgressPaths> } | null>(null);

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
    if (!map || path.length < 2 || hideRemaining) return;

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
      strokeColor: baseColor,
      strokeWeight: hasBuses ? 5 : 3,
      strokeOpacity: hasBuses ? 1 : 0.8,
      zIndex: 21,
      map,
    });
    return () => {
      outline.setMap(null);
      line.setMap(null);
    };
  }, [map, path, hasBuses, baseColor, hideRemaining]);

  useEffect(() => {
    if (!map || path.length < 2) return;
    if (confirmedPrefix.current?.path !== path || confirmedPrefix.current?.context !== progressContext) {
      confirmedPrefix.current = null;
    }
    const overlays: google.maps.Polyline[] = [];
    const add = (section: LatLng[], strokeColor: string, zIndex: number) => {
      if (section.length >= 2) overlays.push(new google.maps.Polyline({ path: section, strokeColor,
        strokeWeight: hasBuses ? 5 : 3, strokeOpacity: 1, zIndex, map }));
    };
    if (completedIndex !== undefined && completedIndex > 0) {
      add(confirmedPrefix.current?.sections.completed ?? routeProgressPaths(path, legs, completedIndex).completed, "#71717a", 22);
    }
    for (const index of JSON.parse(activeIndices) as number[]) {
      if (singleProgress) {
        const measured = routeProgressPaths(path, legs, index, progressDistanceM);
        const sections = measured.matchedDistanceM === undefined && confirmedPrefix.current?.nextStopIndex === index
          ? confirmedPrefix.current.sections : measured;
        if (progressContext && !hideRemaining && (measured.matchedDistanceM !== undefined ||
            !confirmedPrefix.current || confirmedPrefix.current.nextStopIndex !== index)) {
          confirmedPrefix.current = { path, context: progressContext, nextStopIndex: index, sections };
        }
        add(sections.completed, "#71717a", 22);
        if (!hideRemaining) add(sections.active, "#3b82f6", 23);
      } else {
        // A fleet has no shared completed distance. Preserve each active leg.
        if (!hideRemaining) add(legs.get(index) ?? [], "#3b82f6", 23);
      }
    }
    return () => overlays.forEach(line => line.setMap(null));
  }, [map, path, hasBuses, legs, activeIndices, singleProgress, progressDistanceM, completedIndex, hideRemaining, progressContext]);

  return null;
}
