import type { RouteData } from "@/hooks/useRoutes";

export type RideDirection = "forward" | "reverse";

export function normalizeRideDirection(value: unknown): RideDirection {
  return value === "reverse" ? "reverse" : "forward";
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

/** Uses immutable session endpoints before falling back to the current route. */
export function persistedDirectionLabel(
  direction: RideDirection,
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
  if (direction === "forward") return route;
  return {
    ...route,
    rideDirection: "reverse",
    stops: [...route.stops].reverse(),
    waypoints: [...route.waypoints].reverse(),
  };
}
