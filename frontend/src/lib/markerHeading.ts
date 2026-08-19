export function normalizeHeading(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return (((value as number) % 360) + 360) % 360;
}

/**
 * Return an equivalent heading that takes the shortest visual path from the
 * currently rendered angle. This avoids a 359 -> 1 update spinning backwards
 * through almost a full turn.
 */
export function unwrapHeading(next: number | undefined, current: number): number {
  const normalizedNext = normalizeHeading(next);
  const normalizedCurrent = normalizeHeading(current);
  const shortestDelta = ((normalizedNext - normalizedCurrent + 540) % 360) - 180;
  return current + shortestDelta;
}
