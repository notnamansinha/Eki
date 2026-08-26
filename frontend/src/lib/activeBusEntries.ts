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
}

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
] as const;
const OPTIONAL_NUMBER_FIELDS = [
  "lat",
  "lng",
  "speed",
  "heading",
  "timestamp",
  "currentStopIndex",
  "delayMinutes",
] as const;

function hasValidOptionalFields(bus: Record<string, unknown>): boolean {
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
 * Sound type guard for raw RTDB snapshot values. Every ActiveBusEntry field
 * is optional except `busId`, so a valid string busId (plus fresh telemetry
 * or an active ride) fully characterizes an entry.
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
    typeof bus.timestamp === "number" ? bus.timestamp : undefined,
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
