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
  const reportedAccuracy = typeof accuracyMeters === "number" ? accuracyMeters : Number.NaN;
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
  return withinTravelEnvelope(previous, next, elapsedMs);
}

function withinTravelEnvelope(previous: TelemetryMotionSample, next: TelemetryMotionSample, elapsedMs: number): boolean {
  const maximumSpeedKmh = clamp(Math.max(previous.speed, next.speed, 0), 0, 200);
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

export interface OutageReacquisitionEvidence {
  count: 1 | 2;
  startedAt: number;
}

type QualifiedMotionSample = TelemetryMotionSample & { motionState: string };
function usableReacquisitionFix(sample: QualifiedMotionSample): boolean {
  return Number.isFinite(sample.lat) && Math.abs(sample.lat) <= 90 &&
    Number.isFinite(sample.lng) && Math.abs(sample.lng) <= 180 &&
    Number.isFinite(sample.speed) && sample.speed >= 0 && sample.speed <= 200 &&
    Number.isSafeInteger(sample.timestamp) &&
    typeof sample.gpsHdop === "number" && Number.isFinite(sample.gpsHdop) &&
    sample.gpsHdop >= 0 && sample.gpsHdop <= GNSS_HDOP_MAX &&
    (sample.motionState === "moving" || sample.motionState === "stopped");
}

/** A longer travel allowance requires three coherent fixes, never one outlier.
 * Evidence shares the transaction with rawLocation and does not advance the
 * accepted anchor until corroborated. This is a bounded policy, not GNSS proof. */
export function evaluateOutageReacquisition(
  previous: TelemetryMotionSample | null,
  next: QualifiedMotionSample,
  priorRaw: unknown,
  evidence: unknown,
): { accepted: boolean; pending?: OutageReacquisitionEvidence } {
  if (!previous || !usableReacquisitionFix(next)) return { accepted: false };
  const gap = next.timestamp - previous.timestamp;
  if (gap <= TELEMETRY_MAX_TRANSITION_GAP_MS || gap > TELEMETRY_REACQUIRE_AFTER_MS ||
      !withinTravelEnvelope(previous, next, gap)) return { accepted: false };

  const first = { accepted: false, pending: { count: 1 as const, startedAt: next.timestamp } };
  if (!priorRaw || typeof priorRaw !== "object" || !evidence || typeof evidence !== "object") return first;
  const raw = priorRaw as Record<string, unknown>;
  const pending = evidence as Record<string, unknown>;
  // Do not coerce missing/null/string fields into an apparently valid fix.
  if (typeof raw.lat !== "number" || typeof raw.lng !== "number" || typeof raw.speed !== "number" ||
      typeof raw.sampledAt !== "number" || typeof raw.motionState !== "string" ||
      typeof raw.gpsHdop !== "number") return first;
  const previousCandidate = { lat: raw.lat, lng: raw.lng, speed: raw.speed,
    timestamp: raw.sampledAt, motionState: raw.motionState, gpsHdop: raw.gpsHdop };
  const candidateGap = next.timestamp - previousCandidate.timestamp;
  if (!usableReacquisitionFix(previousCandidate) || candidateGap < 500 || candidateGap > 5_000 ||
      !isPlausibleTelemetryTransition(previousCandidate, next) ||
      (pending.count !== 1 && pending.count !== 2) ||
      typeof pending.startedAt !== "number" || !Number.isSafeInteger(pending.startedAt) ||
      pending.startedAt <= previous.timestamp || pending.startedAt > previousCandidate.timestamp ||
      (pending.count === 1 && pending.startedAt !== previousCandidate.timestamp) ||
      (pending.count === 2 && (previousCandidate.timestamp - pending.startedAt < 500 ||
        previousCandidate.timestamp - pending.startedAt > 5_000))) return first;
  if (pending.count === 2) return { accepted: true };
  return { accepted: false, pending: { count: 2, startedAt: pending.startedAt } };
}
