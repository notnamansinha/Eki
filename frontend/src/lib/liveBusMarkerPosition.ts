import { hasValidBusCoordinates } from "./liveBusFreshness";
import type { LatLng } from "./polyline";
import type { ActiveBusEntry } from "./activeBusEntries";

const MIN_DISPLAY_MATCH_CONFIDENCE = 0.45;

type LiveBusPositionInput = Pick<
  ActiveBusEntry,
  | "rawLocation"
  | "lat"
  | "lng"
  | "timestamp"
  | "matchedLocation"
  | "routeState"
  | "routeVersion"
>;

/**
 * Prefer a backend-accepted route match only when it belongs to the current
 * telemetry sample and active route version. The matched sequence must also
 * equal the raw fix sequence so a stale asynchronous match that shares a
 * sampledAt/version cannot overwrite a newer sample. During ambiguity/
 * off-route/rerouting, immediately fall back to authenticated raw telemetry.
 */
export function liveBusMarkerPosition(
  input: LiveBusPositionInput,
): LatLng | null {
  const matched = input.matchedLocation;
  if (
    matched &&
    (input.routeState === "ON_ROUTE" || input.routeState === "ON_NEW_ROUTE") &&
    matched.matchConfidence >= MIN_DISPLAY_MATCH_CONFIDENCE &&
    matched.seq === input.rawLocation?.seq &&
    matched.sampledAt === input.timestamp &&
    matched.routeVersion === input.routeVersion &&
    hasValidBusCoordinates(matched.lat, matched.lng)
  ) {
    return { lat: matched.lat, lng: matched.lng };
  }
  if (!hasValidBusCoordinates(input.lat, input.lng)) return null;
  return { lat: input.lat as number, lng: input.lng as number };
}
