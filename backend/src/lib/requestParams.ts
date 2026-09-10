/**
 * Return an Express route parameter only when it is a scalar string.
 *
 * Express 5 models parameters as `string | string[]` because wildcard routes
 * can capture multiple segments. Eki identifier routes use one named segment,
 * so arrays must be rejected instead of coerced into a database path.
 */
export function singleRouteParam(
  value: string | string[] | undefined,
): string | null {
  return typeof value === "string" ? value : null;
}
