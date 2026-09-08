import type { RouteData } from "@/hooks/useRoutes";

export type RideDirection = "forward" | "reverse";

/**
 * A ride direction may be unresolved. "pending" is a first-class state so a
 * device-only or pre-departure bus is never silently presented as A → B.
 */
export type RideDirectionState = RideDirection | "pending";

/**
 * Normalize a raw direction value into a tri-state.
 *
 * Only the literal "forward"/"reverse" resolve; everything else (missing,
 * empty, malformed) is "pending". This fixes the previous behavior where
 * normalizeRideDirection(undefined) returned "forward" and a directionless
 * bus appeared as an active A → B service (issue #149 problem 1).
 */
export function normalizeRideDirection(value: unknown): RideDirectionState {
  if (value === "forward") return "forward";
  if (value === "reverse") return "reverse";
  return "pending";
}

/** Type guard for the unresolved direction state. */
export function isPendingDirection(
  state: RideDirectionState,
): state is "pending" {
  return state === "pending";
}

/**
 * True only when both raw directions resolve to the same non-pending value.
 * Two pending values do NOT match (no geometry selection while unresolved).
 */
export function directionsMatch(a: unknown, b: unknown): boolean {
  const na = normalizeRideDirection(a);
  const nb = normalizeRideDirection(b);
  if (na === "pending" || nb === "pending") return false;
  return na === nb;
}

/**
 * Label a direction state. Unresolved renders "Direction pending" instead of
 * fabricating A → B, so ordering/ETA surfaces never invent a route.
 */
export function directionLabelState(
  state: RideDirectionState,
  stops: RouteData["stops"],
): string {
  if (state === "pending") return "Direction pending";
  return directionLabel(state, stops);
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
  const hasDirectionalGeometry = Boolean(
    route.forwardPolyline && route.reversePolyline,
  );
  if (direction === "forward") {
    return {
      ...route,
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
