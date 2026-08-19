import { haversineMeters, type LatLng } from "./geo";

/** A GNSS fix may be delayed, but it must still be reachable from the last fix. */
export const TELEMETRY_JUMP_MARGIN_M = 250;
export const TELEMETRY_MAX_TRANSITION_GAP_MS = 60_000;
export const TELEMETRY_REACQUIRE_AFTER_MS = 5 * 60_000;

export interface TelemetryMotionSample extends LatLng {
  speed: number;
  timestamp: number;
}

export function isPlausibleTelemetryTransition(
  previous: TelemetryMotionSample | null,
  next: TelemetryMotionSample,
): boolean {
  if (!previous) return true;

  const transitionGapMs = Math.max(0, next.timestamp - previous.timestamp);
  // A short outage must not teleport a live marker. After a prolonged outage,
  // however, the vehicle may have legitimately travelled beyond the bounded
  // speed envelope; allow a fresh validated fix to establish a new anchor.
  if (transitionGapMs > TELEMETRY_REACQUIRE_AFTER_MS) return true;
  const elapsedMs = Math.min(
    TELEMETRY_MAX_TRANSITION_GAP_MS,
    transitionGapMs,
  );
  const maximumSpeedKmh = Math.max(previous.speed, next.speed, 0);
  const reachableMeters =
    TELEMETRY_JUMP_MARGIN_M + (maximumSpeedKmh / 3.6) * (elapsedMs / 1000);

  return haversineMeters(previous, next) <= reachableMeters;
}
