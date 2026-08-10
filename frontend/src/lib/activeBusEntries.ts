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
  deviceState?: "online" | "offline";
  motionState?: "moving" | "stopped" | "uncertain";
  tripState?: "pre_departure" | "in_service" | "completed";
  currentStopIndex?: number;
  delayMinutes?: number;
  sessionId?: string;
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
  if (typeof bus.busId !== "string" || bus.busId.length === 0) return false;
  const fresh = isLiveBusTimestamp(
    typeof bus.timestamp === "number" ? bus.timestamp : undefined,
    now,
  );
  return fresh || isActiveRideSnapshot(bus);
}

/**
 * The single filter semantics shared by every fleet view: an entry is shown
 * when it has a valid bus identity AND either fresh telemetry or a live ride.
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
