import { getDistanceMeters } from "./mapUtils";
import type { LatLng } from "./polyline";

const POSITION_JUMP_MARGIN_M = 250;
const POSITION_SPEED_MARGIN_M = 150;
const POSITION_MAX_TRANSITION_GAP_MS = 60_000;
const POSITION_REACQUIRE_AFTER_MS = 5 * 60_000;

export interface MarkerPositionSample {
  point: LatLng;
  timestamp: number;
  speedKmh: number;
  sessionId?: string;
  trustworthy: boolean;
}

export interface StableMarkerDecision {
  point: LatLng;
  accepted: MarkerPositionSample | null;
}

export function selectStableMarkerPosition(
  previous: MarkerPositionSample | null,
  next: MarkerPositionSample,
): StableMarkerDecision {
  const current = previous?.sessionId === next.sessionId ? previous : null;
  if (!next.trustworthy) {
    // A session transition must not make an unsnapped/untrusted coordinate
    // eligible. Keep the prior physical anchor until a trustworthy fix arrives.
    return { point: previous?.point ?? next.point, accepted: previous };
  }
  if (current && next.timestamp <= current.timestamp) {
    return { point: current.point, accepted: current };
  }
  if (current) {
    const gapMs = Math.max(0, next.timestamp - current.timestamp);
    if (gapMs <= POSITION_REACQUIRE_AFTER_MS) {
      const elapsedSeconds =
        Math.min(POSITION_MAX_TRANSITION_GAP_MS, gapMs) / 1_000;
      const reachableMeters = Math.max(
        POSITION_JUMP_MARGIN_M,
        (Math.max(0, next.speedKmh) / 3.6) * elapsedSeconds +
          POSITION_SPEED_MARGIN_M,
      );
      if (getDistanceMeters(current.point, next.point) > reachableMeters) {
        return { point: current.point, accepted: current };
      }
    }
  }
  return { point: next.point, accepted: next };
}
