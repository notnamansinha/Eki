import type { LatLng } from "./polyline";

/**
 * Preserve the authenticated fix for diagnostics and for the live-map
 * fallback used whenever a current route match is unavailable or uncertain.
 */
export function telemetryMarkerPosition(position: LatLng): LatLng {
  return { lat: position.lat, lng: position.lng };
}
