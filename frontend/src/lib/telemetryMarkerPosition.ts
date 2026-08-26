import type { LatLng } from "./polyline";

/**
 * Live-map policy: render the authenticated telemetry fix itself.
 * Route projection is useful for ETA calculations, but it must never replace
 * the physical GNSS coordinate shown to administrators or passengers.
 */
export function telemetryMarkerPosition(position: LatLng): LatLng {
  return { lat: position.lat, lng: position.lng };
}
