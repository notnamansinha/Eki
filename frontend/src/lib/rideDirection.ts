import type { RouteData } from "@/hooks/useRoutes";

export type RideDirection = "forward" | "reverse";
export type RideDirectionState = RideDirection | null;

/**
 * Normalizes an unknown value to a supported ride direction.
 *
 * @param value - The value to normalize
 * @returns `"forward"` or `"reverse"` when valid, or `null` otherwise
 */
export function normalizeRideDirection(value: unknown): RideDirectionState {
  return value === "forward" || value === "reverse" ? value : null;
}

/**
 * Builds a directional label from the route stops.
 *
 * @param direction - The travel direction, or `null` when it is not set
 * @param stops - The route stops used to determine the origin and destination
 * @returns A direction label, or `"Direction pending"` when no direction is set
 */
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

/**
 * Builds a directional label using persisted endpoint identifiers when available.
 *
 * @param direction - The current ride direction, or `null` when it is pending
 * @param stops - The route stops used to resolve endpoint labels
 * @param originStopId - The persisted origin stop identifier
 * @param destinationStopId - The persisted destination stop identifier
 * @returns A label containing the persisted endpoints, or a label derived from the current direction and stops
 */
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

/**
 * Creates a view-only route aligned with the specified travel direction.
 *
 * @param route - The route to orient for travel.
 * @param direction - The direction of travel.
 * @returns A route with direction-specific geometry, metrics, and reversed stops and waypoints when traveling in reverse.
 */
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
