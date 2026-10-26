import { normalizeRideDirection } from "../lib/rideDirection";

export interface DelayPreference {
  delayMinutes: number;
  delayUpdatedAt: number;
}

function validDelayMinutes(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1440
    ? Number(value)
    : null;
}

function validDelayRevision(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : 0;
}

/**
 * Pick the freshest announced delay between the live RTDB node and the
 * durable active_rides copy.
 *
 * The delay route writes both stores with the same `delayUpdatedAt` epoch,
 * but the two writes are not atomic, so one can be stale after a partial
 * failure. The newer timestamp wins; on a tie the live value is preferred
 * because it is what passengers are currently seeing. Legacy rows without
 * a timestamp default to 0 and therefore never override a newer value.
 */
export function freshestDelayMinutes(
  live: Record<string, unknown> | null,
  durable: Record<string, unknown> | null,
): DelayPreference {
  const liveMinutes = validDelayMinutes(live?.delayMinutes);
  const durableMinutes = validDelayMinutes(durable?.delayMinutes);
  const liveAt = validDelayRevision(live?.delayUpdatedAt);
  const durableAt = validDelayRevision(durable?.delayUpdatedAt);

  if (durableMinutes !== null && (liveMinutes === null || durableAt > liveAt)) {
    return { delayMinutes: durableMinutes, delayUpdatedAt: durableAt };
  }
  return {
    delayMinutes: liveMinutes ?? durableMinutes ?? 0,
    delayUpdatedAt: liveAt,
  };
}

export function shouldApplyRestoreTelemetry(
  existingTimestamp: unknown,
  candidateTimestamp: number,
): boolean {
  const existing = Number(existingTimestamp);
  return !Number.isFinite(existing) || existing < candidateTimestamp;
}

export function durableLifecycle(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  const direction = normalizeRideDirection(value.direction);
  if (
    value.status !== "active" ||
    typeof value.sessionId !== "string" ||
    typeof value.driverId !== "string" ||
    (value.tripState !== "pre_departure" &&
      value.tripState !== "in_service") ||
    !direction
  ) {
    return null;
  }
  return {
    sessionId: value.sessionId,
    driverId: value.driverId,
    status: "active",
    direction,
    originStopId: typeof value.originStopId === "string" ? value.originStopId : null,
    destinationStopId:
      typeof value.destinationStopId === "string" ? value.destinationStopId : null,
    automaticTurnaround: value.automaticTurnaround === true,
    directionState: "resolved",
    directionEndpointVersion: typeof value.directionEndpointVersion === "string" ? value.directionEndpointVersion : null,
    directionFirestoreSynced: value.directionFirestoreSynced === true,
    previousSessionId:
      typeof value.previousSessionId === "string" ? value.previousSessionId : null,
    completedAt: null,
    turnaroundEligibleAt: null,
    turnaroundSampledAt: null,
    turnaroundClaimId: null,
    turnaroundClaimedAt: null,
    tripState: value.tripState,
    currentStopIndex: Number.isInteger(value.currentStopIndex)
      ? value.currentStopIndex
      : 0,
    hasDepartedOrigin: value.hasDepartedOrigin === true,
    terminalArrival: value.terminalArrival ?? null,
    gnssGap: typeof value.gnssGapSince === "number" && typeof value.sessionId === "string"
      ? { sessionId: value.sessionId, since: value.gnssGapSince } : null,
    // A restored same-session stream must not revive a lower geometry revision.
    ...(Number.isSafeInteger(value.lastRouteVersion) && Number(value.lastRouteVersion) > 0
      ? { routeVersion: Number(value.lastRouteVersion) + 1 } : {}),
    delayMinutes:
      typeof value.delayMinutes === "number" ? value.delayMinutes : 0,
    delayUpdatedAt:
      typeof value.delayUpdatedAt === "number" ? value.delayUpdatedAt : 0,
  };
}

/** New checkpoints only: legacy history is not proof of qualified service. */
export function durableTerminalLifecycle(value: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!value || value.consumedBy !== null || !normalizeRideDirection(value.direction) ||
    typeof value.sessionId !== "string" || typeof value.driverId !== "string" ||
    typeof value.directionEndpointVersion !== "string" ||
    !Number.isFinite(value.completedAt) || !Number.isFinite(value.turnaroundEligibleAt) ||
    !Number.isFinite(value.turnaroundSampledAt) || value.hasDepartedOrigin !== true ||
    !Number.isInteger(value.currentStopIndex)) return null;
  return { ...value, status: "offline", tripState: "completed", terminalArrival: null,
    terminalArrivalConfirmedAt: value.completedAt, directionState: "resolved",
    turnaroundClaimId: null, turnaroundClaimedAt: null,
    lastCompletedSessionId: value.sessionId, lastCompletedAt: value.completedAt, lastCompletedRouteId: value.routeId };
}

