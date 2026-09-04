import { hasValidBusCoordinates } from "./liveBusFreshness";
import type { LatLng } from "./polyline";
import { snapToPolyline } from "./snapToPolyline";

export interface LiveBusMarkerOptions {
  path?: readonly LatLng[];
  heading?: number;
  hdop?: number;
  preferredSegmentIndex?: number;
}

export interface LiveBusMarkerResult {
  point: LatLng;
  segmentIndex: number | null;
  snapped: boolean;
}

/**
 * Keep the map marker tied to the authenticated telemetry accepted into RTDB.
 * Route geometry and animation may be used elsewhere, but neither may rewrite
 * or delay the physical location shown to administrators or passengers.
 */
export function liveBusMarkerPosition(
  lat: number | undefined,
  lng: number | undefined,
  options: LiveBusMarkerOptions = {},
): LiveBusMarkerResult | null {
  if (!hasValidBusCoordinates(lat, lng)) return null;
  const rawPoint = { lat: lat as number, lng: lng as number };
  const canSnap =
    (options.path?.length ?? 0) >= 2 &&
    (options.hdop === undefined || (options.hdop >= 0 && options.hdop <= 5));
  const result = snapToPolyline(rawPoint, options.path!, {
    headingDegrees: options.heading,
    preferredSegmentIndex: options.preferredSegmentIndex,
    maxSegmentJump: 30,
    maxDistanceM: 60,
  });
  return {
    point: result.point,
    segmentIndex: result.snapped ? result.segmentIndex : null,
    snapped: result.snapped,
  };
}
