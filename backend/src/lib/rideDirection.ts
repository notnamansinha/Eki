export type RideDirection = "forward" | "reverse";

/** Read-boundary view of a raw direction: missing/unknown stays "pending". */
export type RideDirectionState = RideDirection | "pending";

/**
 * Read-boundary tri-state. Internal trip-engine math still uses
 * normalizeRideDirection (binary); this surfaces an unresolved direction as
 * "pending" so it is never silently treated as forward at a read boundary.
 */
export function rideDirectionState(value: unknown): RideDirectionState {
  if (value === "forward" || value === "reverse") return value;
  return "pending";
}

export function normalizeRideDirection(value: unknown): RideDirection {
  return value === "reverse" ? "reverse" : "forward";
}

export function isRideDirection(value: unknown): value is RideDirection {
  return value === "forward" || value === "reverse";
}

/** Returns a new array in immutable travel order for this ride. */
export function stopsInRideDirection<T>(
  stops: readonly T[],
  direction: RideDirection,
): T[] {
  return direction === "reverse" ? [...stops].reverse() : [...stops];
}

export function countRidesByDirection(
  rides: Iterable<{ direction?: unknown }>,
): { forward: number; reverse: number; total: number } {
  let forward = 0;
  let reverse = 0;
  for (const ride of rides) {
    if (ride.direction === "reverse") reverse++;
    else forward++;
  }
  return { forward, reverse, total: forward + reverse };
}
