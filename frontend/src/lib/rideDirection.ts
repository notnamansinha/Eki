import type { RouteData } from "@/hooks/useRoutes";

export type RideDirection = "forward" | "reverse";
export type RideDirectionState = RideDirection | null;

export function normalizeRideDirection(value: unknown): RideDirectionState {
  return value === "forward" || value === "reverse" ? value : null;
}

export function directionLabel(
  direction: RideDirectionState,
  stops: RouteData["stops"],
): string {
  if (!direction) return "Direction pending";
  const ordered = direction === "reverse" ? [...stops].reverse() : stops;
  const origin = ordered[0]?.shortName || ordered[0]?.name || "Origin";
  const destination = ordered.at(-1)?.shortName || ordered.at(-1)?.name || "Destination";
  return `${origin} → ${destination}`;
}

/** Uses immutable session endpoints before falling back to the current route. */
export function persistedDirectionLabel(
  direction: RideDirectionState,
  stops: RouteData["stops"],
  originStopId: string | null | undefined,
  destinationStopId: string | null | undefined,
): string {
  if (originStopId && destinationStopId) {
    const stopLabel = (stopId: string) => {
      const stop = stops.find((candidate) => candidate.id === stopId);
      return stop?.shortName || stop?.name || stopId;
    };
    return `${stopLabel(originStopId)} → ${stopLabel(destinationStopId)}`;
  }
  return directionLabel(direction, stops);
}

/** Produces a view-only route whose stops and fallback geometry follow travel order. */
export function routeInRideDirection(
  route: RouteData,
  direction: RideDirection,
): RouteData {
  const hasDirectionalGeometry = Boolean(
    route.forwardPolyline && route.reversePolyline,
  );
  if (direction === "forward") {
    return {
      ...route,
      rideDirection: "forward",
      polyline: route.forwardPolyline ?? route.polyline,
      // Force the authenticated geometry repair endpoint for legacy route
      // records rather than pretending one reversible path is directional.
      polylineQuality: hasDirectionalGeometry ? route.polylineQuality : undefined,
    };
  }
  return {
    ...route,
    rideDirection: "reverse",
    polyline: route.reversePolyline,
    polylineQuality: hasDirectionalGeometry ? route.polylineQuality : undefined,
    distanceMeters: route.reverseDistanceMeters ?? route.distanceMeters,
    duration: route.reverseDuration ?? route.duration,
    stops: [...route.stops].reverse(),
    waypoints: [...route.waypoints].reverse(),
  };
}
