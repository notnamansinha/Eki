import type { RouteData } from "@/hooks/useRoutes";

export type RideDirection = "forward" | "reverse";
export type RideDirectionState = RideDirection | "pending";
export type DirectedRouteData = RouteData & { rideDirection: RideDirection };

/** Resolve only explicit directions; missing and malformed values stay pending. */
export function normalizeRideDirection(value: unknown): RideDirectionState {
  return isRideDirection(value) ? value : "pending";
}

export function isRideDirection(value: unknown): value is RideDirection {
  return value === "forward" || value === "reverse";
}

export function isResolvedRideDirection(
  value: RideDirectionState,
): value is RideDirection {
  return value === "forward" || value === "reverse";
}

/** Pending never matches, including another pending value. */
export function directionsMatch(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeRideDirection(left);
  const normalizedRight = normalizeRideDirection(right);
  return isResolvedRideDirection(normalizedLeft) &&
    isResolvedRideDirection(normalizedRight) &&
    normalizedLeft === normalizedRight;
}

export function directionLabel(
  direction: RideDirection,
  stops: RouteData["stops"],
): string {
  const ordered = direction === "reverse" ? [...stops].reverse() : stops;
  const origin = ordered[0]?.shortName || ordered[0]?.name || "Origin";
  const destination = ordered.at(-1)?.shortName || ordered.at(-1)?.name || "Destination";
  return `${origin} → ${destination}`;
}

export function directionLabelState(
  direction: RideDirectionState,
  stops: RouteData["stops"],
): string {
  return isResolvedRideDirection(direction)
    ? directionLabel(direction, stops)
    : "Direction pending";
}

/** Uses immutable session endpoints before falling back to the current route. */
export function persistedDirectionLabel(
  direction: RideDirection | null | undefined,
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
  if (!isRideDirection(direction)) return "Direction pending";
  return directionLabel(direction, stops);
}

export function persistedDirectionLabelState(
  direction: RideDirectionState,
  stops: RouteData["stops"],
  originStopId: string | null | undefined,
  destinationStopId: string | null | undefined,
): string {
  return isResolvedRideDirection(direction)
    ? persistedDirectionLabel(
        direction,
        stops,
        originStopId,
        destinationStopId,
      )
    : "Direction pending";
}

/** Produces a view-only route whose stops and fallback geometry follow travel order. */
export function routeInRideDirection(
  route: RouteData,
  direction: RideDirection,
): DirectedRouteData {
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

/** Direction-derived routes do not exist until travel direction is resolved. */
export function routeInRideDirectionState(
  route: RouteData | undefined,
  direction: RideDirectionState,
): DirectedRouteData | undefined {
  return route && isResolvedRideDirection(direction)
    ? routeInRideDirection(route, direction)
    : undefined;
}
