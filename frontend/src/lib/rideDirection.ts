import type { RouteData, RouteGeometry } from "@/hooks/useRoutes";

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

export function geometryForDirection(
  route: RouteData,
  direction: RideDirection,
): RouteGeometry | undefined {
  if (direction === "reverse") return route.reverseGeometry;
  return route.forwardGeometry ?? (
    route.polyline &&
    route.polylineQuality === "HIGH_QUALITY" &&
    typeof route.distanceMeters === "number" &&
    typeof route.duration === "string"
      ? {
          polyline: route.polyline,
          polylineQuality: route.polylineQuality,
          distanceMeters: route.distanceMeters,
          duration: route.duration,
        }
      : undefined
  );
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
  const geometry = geometryForDirection(route, direction);
  const withGeometry = {
    ...route,
    rideDirection: direction,
    polyline: geometry?.polyline,
    polylineQuality: geometry?.polylineQuality,
    distanceMeters: geometry?.distanceMeters,
    duration: geometry?.duration,
  };
  if (direction === "forward") return withGeometry;
  return {
    ...withGeometry,
    stops: [...route.stops].reverse(),
    waypoints: [...route.waypoints].reverse(),
  };
}
