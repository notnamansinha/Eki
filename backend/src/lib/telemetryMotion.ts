import { haversineMeters, type LatLng } from "./geo";

/**
 * The fixed 250 m allowance admitted a large lateral jump during a short
 * signal disturbance. Keep the receiver uncertainty bounded and account for
 * travel separately using the elapsed time and reported speed.
 */
export const GNSS_ERROR_MIN_M = 15;
export const GNSS_ERROR_MAX_M = 50;
export const GNSS_STATIONARY_SPEED_KMH = 2.5;
export const GNSS_HDOP_MAX = 4;
export const TELEMETRY_MAX_TRANSITION_GAP_MS = 60_000;
export const TELEMETRY_REACQUIRE_AFTER_MS = 5 * 60_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Convert the available fix-quality signal into a bounded horizontal error
 * budget. A missing or unusable HDOP is deliberately conservative; it does
 * not discard the raw fix, but it must not make route decisions confident.
 * The optional accuracy argument supports receivers that expose metres
 * directly without changing the current nine-field device contract.
 */
export function adaptiveGnssErrorMeters(
  gpsHdop: number | null | undefined,
  speedKmh: number,
  previousSpeedKmh = speedKmh,
  elapsedMs = 0,
  accuracyMeters?: number | null,
): number {
  const hdop = typeof gpsHdop === "number" ? gpsHdop : Number.NaN;
  const hdopError = Number.isFinite(hdop) && hdop >= 0 && hdop <= 99
    ? GNSS_ERROR_MIN_M + hdop * 7
    : GNSS_ERROR_MAX_M;
  const reportedAccuracy = Number(accuracyMeters);
  const qualityError = Number.isFinite(reportedAccuracy) && reportedAccuracy >= 0
    ? reportedAccuracy
    : hdopError;
  const stationary =
    Math.max(speedKmh, previousSpeedKmh, 0) <= GNSS_STATIONARY_SPEED_KMH;
  const multipathAllowance = stationary ? 10 : 0;
  const gapAllowance = clamp(Math.max(0, elapsedMs - 10_000) / 2_000, 0, 10);
  return clamp(qualityError + multipathAllowance + gapAllowance, GNSS_ERROR_MIN_M, GNSS_ERROR_MAX_M);
}

export interface TelemetryMotionSample extends LatLng {
  speed: number;
  timestamp: number;
  gpsHdop?: number | null;
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
  const errorBudget = Math.max(
    adaptiveGnssErrorMeters(
      previous.gpsHdop,
      previous.speed,
      next.speed,
      elapsedMs,
    ),
    adaptiveGnssErrorMeters(
      next.gpsHdop,
      next.speed,
      previous.speed,
      elapsedMs,
    ),
  );
  const reachableMeters =
    errorBudget + (maximumSpeedKmh / 3.6) * (elapsedMs / 1000);

  return haversineMeters(previous, next) <= reachableMeters;
}
