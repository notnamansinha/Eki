export type RideDirection = "forward" | "reverse";

/** Resolve only an explicit wire value; unresolved input must stay pending. */
export function normalizeRideDirection(value: unknown): RideDirection | null {
  return isRideDirection(value) ? value : null;
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

/** `total` covers every sampled ride, including the explicit unresolved bucket. */
export function countRidesByDirection(
  rides: Iterable<{ direction?: unknown }>,
): { forward: number; reverse: number; unresolved: number; total: number } {
  let forward = 0;
  let reverse = 0;
  let unresolved = 0;
  let total = 0;
  for (const ride of rides) {
    total++;
    const direction = normalizeRideDirection(ride.direction);
    if (direction === "forward") forward++;
    else if (direction === "reverse") reverse++;
    else unresolved++;
  }
  return { forward, reverse, unresolved, total };
}
