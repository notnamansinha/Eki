import { hasValidBusCoordinates } from "./liveBusFreshness";
import type { LatLng } from "./polyline";

/**
 * Keep the map marker tied to the authenticated telemetry accepted into RTDB.
 * Route geometry may be used for ETAs, but it must not rewrite the reported
 * physical location shown to administrators or passengers.
 */
export function liveBusMarkerPosition(
  lat: number | undefined,
  lng: number | undefined,
): LatLng | null {
  if (!hasValidBusCoordinates(lat, lng)) return null;
  return { lat: lat as number, lng: lng as number };
}
