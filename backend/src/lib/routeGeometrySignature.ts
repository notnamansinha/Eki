import { createHash } from "node:crypto";

export interface RouteShapingStop {
  lat: number;
  lng: number;
}

const ROUTING_CONTRACT = {
  travelMode: "DRIVE",
  routingPreference: "TRAFFIC_AWARE_OPTIMAL",
  polylineQuality: "HIGH_QUALITY",
  computeAlternativeRoutes: false,
} as const;

/**
 * Hash every input that can alter stored road geometry. Coordinates are kept
 * at their validated IEEE-754 value (no rounding), so even a fine map-pin edit
 * invalidates geometry while names, colours, and stable stop IDs do not.
 */
export function routeGeometrySignature(
  orderedStops: readonly RouteShapingStop[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      contract: ROUTING_CONTRACT,
      orderedStops: orderedStops.map(({ lat, lng }) => ({ lat, lng })),
    }))
    .digest("hex");
}
