/**
 * Route-geometry signature used to decide whether a save must recompute
 * Google routing (issue #149 problem 8).
 *
 * A metadata-only edit (stop/route name or color) leaves coordinates, order,
 * and stop IDs untouched, so its signature matches the stored route and the
 * backend can preserve the cached directional geometry without a billable
 * Google call. Any geometric change (coordinate move, add/remove, reorder,
 * swap) changes the signature and forces a recompute.
 */
export interface RouteGeometryStop {
  id: string;
  lat: number;
  lng: number;
}

/** Quantize to 1e-6 (~0.1 mm) so Firestore float round-trips never alter the key. */
function compactCoord(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1e6)) : "x";
}

/** Ordered geometry signature: id + quantized coordinate per stop, join with "|". */
export function routeGeometrySignature(stops: readonly RouteGeometryStop[] | null | undefined): string {
  if (!Array.isArray(stops)) return "";
  return stops.map((stop) => `${stop.id}:${compactCoord(stop.lat)},${compactCoord(stop.lng)}`).join("|");
}

/**
 * True when the incoming and stored stop sets describe the same geometry, so a
 * save can skip Google recomputation and reuse the cached directional route.
 * Any add/remove/reorder/coordinate change returns false.
 */
export function geometryIsUnchanged(
  incoming: readonly RouteGeometryStop[] | null | undefined,
  stored: readonly RouteGeometryStop[] | null | undefined,
): boolean {
  if (!Array.isArray(incoming) || !Array.isArray(stored)) return false;
  return routeGeometrySignature(incoming) === routeGeometrySignature(stored);
}