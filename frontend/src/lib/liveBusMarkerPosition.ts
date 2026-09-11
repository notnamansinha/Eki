import { SIGNAL_LOST_MS, hasValidBusCoordinates } from "./liveBusFreshness";
import type { LatLng } from "./polyline";
import type { ActiveBusEntry, MatchedLiveLocation } from "./activeBusEntries";
import { directionsMatch } from "./rideDirection";

const MIN_DISPLAY_MATCH_CONFIDENCE = 0.45;

/**
 * Route matching normally completes well inside one moving telemetry period.
 * This small grace window hides raw-to-matched excursions without allowing a
 * stalled matcher to freeze a bus indefinitely.
 */
export const MATCH_PENDING_HOLD_MS = 2_000;

export type LiveBusMarkerDecision =
  | "matched"
  | "match_pending"
  | "raw"
  | "none";

export type LiveBusMarkerReason =
  | "current_match"
  | "awaiting_match"
  | "match_timeout"
  | "match_unavailable"
  | "off_route"
  | "route_changed"
  | "reconnected"
  | "signal_uncertain"
  | "direction_pending"
  | "raw_only"
  | "invalid_position"
  | "older_snapshot";

export type LiveBusPositionInput = Partial<Pick<
  ActiveBusEntry,
  | "busId"
  | "routeId"
  | "sessionId"
  | "lat"
  | "lng"
  | "timestamp"
  | "deviceState"
  | "motionState"
  | "direction"
  | "rawLocation"
  | "matchedLocation"
  | "mapMatchSeq"
  | "mapMatchSampledAt"
  | "activeRouteId"
  | "routeState"
  | "routeVersion"
  | "routeDirection"
>>;

interface SampleIdentity {
  seq?: number;
  sampledAt?: number;
}

interface RetainedMatch {
  position: LatLng;
  sample: SampleIdentity;
}

export interface LiveBusMarkerSelection {
  decision: LiveBusMarkerDecision;
  reason: LiveBusMarkerReason;
  position: LatLng | null;
  /** True when the marker is held or represents an unconfirmed raw position. */
  uncertain: boolean;
  pendingUntil?: number;
  contextKey: string;
  identityKey: string;
  latestSample: SampleIdentity;
  rawPosition: LatLng | null;
  retainedMatch?: RetainedMatch;
}

const ON_ROUTE_STATES = new Set(["ON_ROUTE", "ON_NEW_ROUTE"]);

function routeContextKey(input: LiveBusPositionInput): string {
  return [
    input.busId ?? "",
    input.routeId ?? "",
    input.sessionId ?? "",
    input.routeVersion ?? "",
    input.activeRouteId ?? "",
    input.routeDirection ?? input.direction ?? "",
  ].join("|");
}

function rideIdentityKey(input: LiveBusPositionInput): string {
  return [input.busId ?? "", input.routeId ?? "", input.sessionId ?? ""].join("|");
}

function sampleIdentity(input: LiveBusPositionInput): SampleIdentity {
  return {
    seq: Number.isSafeInteger(input.rawLocation?.seq)
      ? input.rawLocation?.seq
      : undefined,
    sampledAt: Number.isFinite(input.rawLocation?.sampledAt)
      ? input.rawLocation?.sampledAt
      : Number.isFinite(input.timestamp)
        ? input.timestamp
        : undefined,
  };
}

function compareSamples(left: SampleIdentity, right: SampleIdentity): number {
  if (left.sampledAt !== right.sampledAt) {
    if (left.sampledAt === undefined) return -1;
    if (right.sampledAt === undefined) return 1;
    return left.sampledAt - right.sampledAt;
  }
  if (left.seq === right.seq) return 0;
  if (left.seq === undefined) return -1;
  if (right.seq === undefined) return 1;
  return left.seq - right.seq;
}

function sameSample(left: SampleIdentity, right: SampleIdentity): boolean {
  return left.seq === right.seq && left.sampledAt === right.sampledAt;
}

function acceptedRawPosition(input: LiveBusPositionInput): LatLng | null {
  if (!hasValidBusCoordinates(input.lat, input.lng)) return null;
  return { lat: input.lat as number, lng: input.lng as number };
}

function validMatch(
  match: MatchedLiveLocation | undefined,
  routeVersion: number | undefined,
): match is MatchedLiveLocation {
  return Boolean(
    match &&
    match.matchConfidence >= MIN_DISPLAY_MATCH_CONFIDENCE &&
    match.routeVersion === routeVersion &&
    hasValidBusCoordinates(match.lat, match.lng),
  );
}

function matchSample(match: MatchedLiveLocation): SampleIdentity {
  return { seq: match.seq, sampledAt: match.sampledAt };
}

function currentMatch(
  input: LiveBusPositionInput,
  sample: SampleIdentity,
): RetainedMatch | null {
  const match = input.matchedLocation;
  if (
    !ON_ROUTE_STATES.has(input.routeState ?? "") ||
    !validMatch(match, input.routeVersion) ||
    !sameSample(matchSample(match), sample)
  ) {
    return null;
  }
  return {
    position: { lat: match.lat, lng: match.lng },
    sample: matchSample(match),
  };
}

function staleMatchAtStartup(
  input: LiveBusPositionInput,
  sample: SampleIdentity,
): RetainedMatch | null {
  const match = input.matchedLocation;
  if (
    !validMatch(match, input.routeVersion) ||
    compareSamples(matchSample(match), sample) >= 0
  ) {
    return null;
  }
  return {
    position: { lat: match.lat, lng: match.lng },
    sample: matchSample(match),
  };
}

function retainedMatchForPending(
  input: LiveBusPositionInput,
  sample: SampleIdentity,
  previous: LiveBusMarkerSelection | null,
  sameContext: boolean,
): RetainedMatch | undefined {
  const fromInput = staleMatchAtStartup(input, sample) ?? undefined;
  if (!sameContext || !previous) return fromInput;
  if (!fromInput) return previous.retainedMatch;
  if (
    previous.retainedMatch &&
    compareSamples(fromInput.sample, previous.retainedMatch.sample) > 0
  ) {
    return fromInput;
  }
  if (
    !previous.retainedMatch &&
    sameSample(fromInput.sample, previous.latestSample)
  ) {
    return fromInput;
  }
  return previous.retainedMatch;
}

function selection(
  input: LiveBusPositionInput,
  decision: LiveBusMarkerDecision,
  reason: LiveBusMarkerReason,
  position: LatLng | null,
  uncertain: boolean,
  latestSample: SampleIdentity,
  rawPosition: LatLng | null,
  retainedMatch?: RetainedMatch,
  pendingUntil?: number,
): LiveBusMarkerSelection {
  return {
    decision,
    reason,
    position,
    uncertain,
    contextKey: routeContextKey(input),
    identityKey: rideIdentityKey(input),
    latestSample,
    rawPosition,
    ...(retainedMatch ? { retainedMatch } : {}),
    ...(pendingUntil !== undefined ? { pendingUntil } : {}),
  };
}

function expiredSelection(
  previous: LiveBusMarkerSelection,
  now: number,
): LiveBusMarkerSelection {
  if (
    previous.decision !== "match_pending" ||
    previous.pendingUntil === undefined ||
    now < previous.pendingUntil
  ) {
    return previous;
  }
  return {
    ...previous,
    decision: previous.rawPosition ? "raw" : "none",
    reason: previous.rawPosition ? "match_timeout" : "invalid_position",
    position: previous.rawPosition,
    uncertain: true,
    pendingUntil: undefined,
    retainedMatch: undefined,
  };
}

/**
 * Select one display target while carrying only the small amount of state
 * needed to bridge an asynchronous route match. The raw position is the
 * backend's plausibility-filtered accepted coordinate, never an invented fix.
 */
export function selectLiveBusMarkerPosition(
  input: LiveBusPositionInput,
  previous: LiveBusMarkerSelection | null = null,
  now = Date.now(),
): LiveBusMarkerSelection {
  const contextKey = routeContextKey(input);
  const latestSample = sampleIdentity(input);
  const rawPosition = acceptedRawPosition(input);
  const sameContext = previous?.contextKey === contextKey;
  const sameIdentity = previous?.identityKey === rideIdentityKey(input);
  const signalUncertain =
    input.deviceState === "offline" || input.motionState === "uncertain";

  if (
    sameIdentity &&
    previous &&
    compareSamples(latestSample, previous.latestSample) < 0
  ) {
    const current = expiredSelection(previous, now);
    return current === previous
      ? { ...current, reason: "older_snapshot" }
      : current;
  }

  // Never display or retain route-derived geometry until both lifecycle and
  // matching context agree on one explicit direction. This follows the older
  // snapshot guard so a late pending snapshot cannot move the marker back.
  if (!directionsMatch(input.direction, input.routeDirection)) {
    return selection(
      input,
      rawPosition ? "raw" : "none",
      rawPosition ? "direction_pending" : "invalid_position",
      rawPosition,
      true,
      latestSample,
      rawPosition,
    );
  }

  const matched = currentMatch(input, latestSample);
  if (matched && !signalUncertain) {
    return selection(
      input,
      "matched",
      "current_match",
      matched.position,
      false,
      latestSample,
      rawPosition,
      matched,
    );
  }

  const contextChanged = Boolean(previous && !sameContext);
  const reconnected = Boolean(
    sameContext &&
    previous?.latestSample.sampledAt !== undefined &&
    latestSample.sampledAt !== undefined &&
    latestSample.sampledAt - previous.latestSample.sampledAt > SIGNAL_LOST_MS,
  );
  const offRoute =
    input.routeState === "POSSIBLE_OFF_ROUTE" ||
    input.routeState === "OFF_ROUTE" ||
    input.routeState === "REROUTING";
  const matchingCompleted =
    latestSample.seq !== undefined &&
    latestSample.sampledAt !== undefined &&
    input.mapMatchSeq === latestSample.seq &&
    input.mapMatchSampledAt === latestSample.sampledAt;

  if (
    !contextChanged &&
    !reconnected &&
    !signalUncertain &&
    !offRoute &&
    ON_ROUTE_STATES.has(input.routeState ?? "") &&
    !matchingCompleted
  ) {
    const retained = retainedMatchForPending(
      input,
      latestSample,
      previous,
      Boolean(sameContext),
    );
    if (retained && compareSamples(retained.sample, latestSample) < 0) {
      const samePendingMatch =
        previous?.decision === "match_pending" &&
        previous.retainedMatch !== undefined &&
        sameSample(previous.retainedMatch.sample, retained.sample);
      const pendingUntil = samePendingMatch && previous.pendingUntil !== undefined
        ? previous.pendingUntil
        : now + MATCH_PENDING_HOLD_MS;
      if (now < pendingUntil) {
        return selection(
          input,
          "match_pending",
          "awaiting_match",
          retained.position,
          true,
          latestSample,
          rawPosition,
          retained,
          pendingUntil,
        );
      }
    }
  }

  if (!rawPosition) {
    return selection(
      input,
      "none",
      "invalid_position",
      null,
      true,
      latestSample,
      null,
    );
  }

  const reason: LiveBusMarkerReason = contextChanged
    ? "route_changed"
    : reconnected
      ? "reconnected"
      : signalUncertain
        ? "signal_uncertain"
        : offRoute
          ? "off_route"
          : previous?.decision === "match_pending" &&
              previous.pendingUntil !== undefined &&
              now >= previous.pendingUntil
            ? "match_timeout"
            : (previous?.decision === "match_pending" ||
              previous?.reason === "match_timeout") &&
              previous !== null &&
              sameSample(previous.latestSample, latestSample)
            ? "match_timeout"
            : matchingCompleted
              ? "match_unavailable"
              : "raw_only";
  return selection(
    input,
    "raw",
    reason,
    rawPosition,
    reason !== "raw_only",
    latestSample,
    rawPosition,
  );
}
