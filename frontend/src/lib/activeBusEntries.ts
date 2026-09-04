import { isActiveRideSnapshot } from "./liveBusSnapshot";
import { isLiveBusTimestamp } from "./liveBusFreshness";

/**
 * One shared shape for every fleet view. Superset of the fields the admin
 * dashboard and fleet panel render; all fields optional except the identity.
 */
export interface ActiveBusEntry {
  busId: string;
  driverId?: string;
  routeId?: string;
  lat?: number;
  lng?: number;
  speed?: number;
  heading?: number;
  timestamp?: number;
  receivedAt?: number;
  status?: "active" | "offline";
  deviceState?: "online" | "offline";
  motionState?: "moving" | "stopped" | "uncertain";
  tripState?: "pre_departure" | "in_service" | "completed";
  currentStopIndex?: number;
  delayMinutes?: number;
  sessionId?: string;
  direction?: "forward" | "reverse";
  originStopId?: string;
  destinationStopId?: string;
  rawLocation?: RawLiveLocation;
  matchedLocation?: MatchedLiveLocation;
  matchConfidence?: number;
  distanceToActiveRoute?: number;
  activeRouteId?: string;
  routeVersion?: number;
  routeSource?: "configured" | "dynamic-reroute";
  routeState?: LiveRouteState;
  routeDirection?: "forward" | "reverse";
}

export interface RawLiveLocation {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  gpsHdop?: number | null;
  motionState: "moving" | "stopped" | "uncertain";
  seq: number;
  sampledAt: number;
}

export interface MatchedLiveLocation {
  lat: number;
  lng: number;
  segmentIndex: number;
  segmentFraction: number;
  alongRouteDistanceM: number;
  distanceToRouteM: number;
  headingDifference?: number | null;
  matchConfidence: number;
  seq: number;
  sampledAt: number;
  routeVersion: number;
}

export type LiveRouteState =
  | "ON_ROUTE"
  | "POSSIBLE_OFF_ROUTE"
  | "OFF_ROUTE"
  | "REROUTING"
  | "ON_NEW_ROUTE";

/** Chat discoverability follows trusted device presence, never trip motion/status. */
export function isLiveChatDeviceOnline(
  entry: Pick<ActiveBusEntry, "deviceState" | "status" | "motionState"> | null | undefined,
): boolean {
  return entry?.deviceState === "online";
}

const OPTIONAL_STRING_FIELDS = [
  "driverId",
  "routeId",
  "sessionId",
  "originStopId",
  "destinationStopId",
  "activeRouteId",
] as const;
const OPTIONAL_NUMBER_FIELDS = [
  "lat",
  "lng",
  "speed",
  "heading",
  "timestamp",
  "receivedAt",
  "currentStopIndex",
  "delayMinutes",
  "matchConfidence",
  "distanceToActiveRoute",
  "routeVersion",
] as const;

function validLatLngRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const location = value as Record<string, unknown>;
  return (
    typeof location.lat === "number" &&
    Number.isFinite(location.lat) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    typeof location.lng === "number" &&
    Number.isFinite(location.lng) &&
    location.lng >= -180 &&
    location.lng <= 180
  );
}

function validRawLocation(value: unknown): boolean {
  if (value === undefined) return true;
  if (!validLatLngRecord(value)) return false;
  return (
    typeof value.speed === "number" && Number.isFinite(value.speed) &&
    typeof value.heading === "number" && Number.isFinite(value.heading) &&
    (value.gpsHdop === undefined || value.gpsHdop === null ||
      (typeof value.gpsHdop === "number" && Number.isFinite(value.gpsHdop) &&
        value.gpsHdop >= 0 && value.gpsHdop <= 99)) &&
    (value.motionState === "moving" ||
      value.motionState === "stopped" ||
      value.motionState === "uncertain") &&
    Number.isSafeInteger(value.seq) &&
    typeof value.sampledAt === "number" && Number.isFinite(value.sampledAt)
  );
}

function validMatchedLocation(value: unknown): boolean {
  if (value === undefined) return true;
  if (!validLatLngRecord(value)) return false;
  return (
    Number.isInteger(value.segmentIndex) && Number(value.segmentIndex) >= 0 &&
    typeof value.segmentFraction === "number" && Number.isFinite(value.segmentFraction) && value.segmentFraction >= 0 && value.segmentFraction <= 1 &&
    typeof value.alongRouteDistanceM === "number" && Number.isFinite(value.alongRouteDistanceM) && value.alongRouteDistanceM >= 0 &&
    typeof value.distanceToRouteM === "number" && Number.isFinite(value.distanceToRouteM) && value.distanceToRouteM >= 0 &&
    (value.headingDifference === undefined || value.headingDifference === null ||
      (typeof value.headingDifference === "number" && Number.isFinite(value.headingDifference) && value.headingDifference >= 0 && value.headingDifference <= 180)) &&
    typeof value.matchConfidence === "number" && Number.isFinite(value.matchConfidence) && value.matchConfidence >= 0 && value.matchConfidence <= 1 &&
    Number.isSafeInteger(value.seq) &&
    typeof value.sampledAt === "number" && Number.isFinite(value.sampledAt) &&
    Number.isSafeInteger(value.routeVersion) && Number(value.routeVersion) > 0
  );
}

function hasValidOptionalFields(bus: Record<string, unknown>): boolean {
  if (!validRawLocation(bus.rawLocation) || !validMatchedLocation(bus.matchedLocation)) {
    return false;
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (bus[field] !== undefined && typeof bus[field] !== "string") return false;
  }
  for (const field of OPTIONAL_NUMBER_FIELDS) {
    if (
      bus[field] !== undefined &&
      (typeof bus[field] !== "number" || !Number.isFinite(bus[field]))
    ) {
      return false;
    }
  }
  if (typeof bus.lat === "number" && (bus.lat < -90 || bus.lat > 90)) return false;
  if (typeof bus.lng === "number" && (bus.lng < -180 || bus.lng > 180)) return false;
  if (
    bus.direction !== undefined &&
    bus.direction !== "forward" &&
    bus.direction !== "reverse"
  ) {
    return false;
  }
  if (
    bus.routeDirection !== undefined &&
    bus.routeDirection !== "forward" &&
    bus.routeDirection !== "reverse"
  ) {
    return false;
  }
  if (
    bus.routeSource !== undefined &&
    bus.routeSource !== "configured" &&
    bus.routeSource !== "dynamic-reroute"
  ) {
    return false;
  }
  if (
    bus.routeState !== undefined &&
    bus.routeState !== "ON_ROUTE" &&
    bus.routeState !== "POSSIBLE_OFF_ROUTE" &&
    bus.routeState !== "OFF_ROUTE" &&
    bus.routeState !== "REROUTING" &&
    bus.routeState !== "ON_NEW_ROUTE"
  ) {
    return false;
  }
  if (
    typeof bus.matchConfidence === "number" &&
    (bus.matchConfidence < 0 || bus.matchConfidence > 1)
  ) {
    return false;
  }
  if (
    typeof bus.routeVersion === "number" &&
    (!Number.isSafeInteger(bus.routeVersion) || bus.routeVersion <= 0)
  ) {
    return false;
  }
  if (
    typeof bus.currentStopIndex === "number" &&
    (!Number.isInteger(bus.currentStopIndex) || bus.currentStopIndex < 0)
  ) {
    return false;
  }
  if (
    bus.status !== undefined &&
    bus.status !== "active" &&
    bus.status !== "offline"
  ) {
    return false;
  }
  if (
    bus.deviceState !== undefined &&
    bus.deviceState !== "online" &&
    bus.deviceState !== "offline"
  ) {
    return false;
  }
  if (
    bus.motionState !== undefined &&
    bus.motionState !== "moving" &&
    bus.motionState !== "stopped" &&
    bus.motionState !== "uncertain"
  ) {
    return false;
  }
  if (
    bus.tripState !== undefined &&
    bus.tripState !== "pre_departure" &&
    bus.tripState !== "in_service" &&
    bus.tripState !== "completed"
  ) {
    return false;
  }
  return true;
}

/**
 * Determines whether a value represents a live active bus entry.
 *
 * @param value - The value to validate.
 * @param now - The reference time used to determine telemetry freshness.
 * @returns `true` if the value has a valid bus identifier and represents fresh telemetry or an active ride, `false` otherwise.
 */
export function isActiveBusEntry(
  value: unknown,
  now = Date.now(),
): value is ActiveBusEntry {
  if (typeof value !== "object" || value === null) return false;
  const bus = value as Record<string, unknown>;
  if (typeof bus.busId !== "string" || bus.busId.trim().length === 0) return false;
  if (!hasValidOptionalFields(bus)) return false;
  // A terminal ride is no longer live even if its final telemetry sample is
  // still inside the freshness window. Completion must take precedence over
  // generic telemetry freshness so fleet views do not show ended service.
  if (bus.tripState === "completed") return false;
  const fresh = isLiveBusTimestamp(
    typeof bus.receivedAt === "number"
      ? bus.receivedAt
      : typeof bus.timestamp === "number" ? bus.timestamp : undefined,
    now,
  );
  return fresh || isActiveRideSnapshot(bus);
}

/**
 * The single filter semantics shared by every fleet view: an entry is shown
 * when it is non-terminal, has a valid bus identity, AND has either fresh
 * telemetry or a live ride.
 *
 * Before this function existed, the admin dashboard and the fleet panel each
 * implemented their own filtering (Dashboard: valid busId + fresh/active-ride;
 * Fleet: every raw RTDB entry), so the two panels could disagree about the
 * fleet state. `now` is injectable for deterministic tests.
 */
export function filterActiveBusEntries(
  data: Record<string, unknown> | null | undefined,
  now = Date.now(),
): ActiveBusEntry[] {
  if (!data) return [];
  return Object.values(data).filter(
    (value): value is ActiveBusEntry => isActiveBusEntry(value, now),
  );
}
