import { describe, expect, it } from "vitest";
import { SIGNAL_LOST_MS } from "./liveBusFreshness";
import {
  MATCH_PENDING_HOLD_MS,
  selectLiveBusMarkerPosition,
  type LiveBusPositionInput,
} from "./liveBusMarkerPosition";

function matchedLocation(seq: number, sampledAt = seq * 1_000, routeVersion = 4) {
  return {
    lat: 23 + seq / 100_000,
    lng: 72 + seq / 100_000,
    segmentIndex: seq,
    segmentFraction: 0.5,
    alongRouteDistanceM: seq * 100,
    distanceToRouteM: 5,
    headingDifference: 2,
    matchConfidence: 0.92,
    seq,
    sampledAt,
    routeVersion,
  };
}

function busSample(
  seq: number,
  overrides: LiveBusPositionInput = {},
): LiveBusPositionInput {
  const sampledAt = seq * 1_000;
  return {
    busId: "bus_1",
    routeId: "route_1",
    sessionId: "session_1",
    lat: 23.01 + seq / 100_000,
    lng: 72.45 + seq / 100_000,
    timestamp: sampledAt,
    deviceState: "online",
    motionState: "moving",
    direction: "forward",
    routeDirection: "forward",
    activeRouteId: "route_1:configured:forward",
    routeState: "ON_ROUTE",
    routeVersion: 4,
    rawLocation: {
      lat: 23.01 + seq / 100_000,
      lng: 72.45 + seq / 100_000,
      speed: 18,
      heading: 94,
      gpsHdop: 2,
      motionState: "moving",
      seq,
      sampledAt,
    },
    ...overrides,
  };
}

describe("live bus marker selection", () => {
  it("exposes raw and none decisions during startup", () => {
    const raw = selectLiveBusMarkerPosition(busSample(1), null, 100);
    expect(raw).toMatchObject({
      decision: "raw",
      reason: "raw_only",
      position: { lat: 23.01001, lng: 72.45001 },
      uncertain: false,
    });

    const none = selectLiveBusMarkerPosition(
      busSample(1, { lat: 91 }),
      null,
      100,
    );
    expect(none).toMatchObject({
      decision: "none",
      reason: "invalid_position",
      position: null,
    });
  });

  it("uses a confident match only for the current sample and route version", () => {
    const input = busSample(10, {
      matchedLocation: matchedLocation(10),
      mapMatchSeq: 10,
      mapMatchSampledAt: 10_000,
    });

    expect(selectLiveBusMarkerPosition(input, null, 100)).toMatchObject({
      decision: "matched",
      reason: "current_match",
      position: { lat: 23.0001, lng: 72.0001 },
      uncertain: false,
    });
  });

  it.each([undefined, null, "", "sideways", 123])(
    "uses raw telemetry and drops retained matches while direction %p is pending",
    (direction) => {
      const prior = selectLiveBusMarkerPosition(
        busSample(10, {
          matchedLocation: matchedLocation(10),
          mapMatchSeq: 10,
          mapMatchSampledAt: 10_000,
        }),
        null,
        50,
      );
      const result = selectLiveBusMarkerPosition(
        busSample(11, {
          direction,
          matchedLocation: matchedLocation(10),
        }),
        prior,
        100,
      );

      expect(result).toMatchObject({
        decision: "raw",
        reason: "direction_pending",
        position: { lat: busSample(11).lat, lng: busSample(11).lng },
        uncertain: true,
      });
      expect(result.retainedMatch).toBeUndefined();
      expect(result.pendingUntil).toBeUndefined();
    },
  );

  it("marks signal-loss positions uncertain even when a match completed", () => {
    const result = selectLiveBusMarkerPosition(
      busSample(10, {
        motionState: "uncertain",
        matchedLocation: matchedLocation(10),
        mapMatchSeq: 10,
        mapMatchSampledAt: 10_000,
      }),
      null,
      100,
    );

    expect(result).toMatchObject({
      decision: "raw",
      reason: "signal_uncertain",
      uncertain: true,
    });
  });

  it("holds the previous confident match while a new match is pending", () => {
    const prior = selectLiveBusMarkerPosition(
      busSample(10, {
        matchedLocation: matchedLocation(10),
        mapMatchSeq: 10,
        mapMatchSampledAt: 10_000,
      }),
      null,
      50,
    );
    const nextInput = busSample(11, {
      matchedLocation: matchedLocation(10),
      mapMatchSeq: 10,
      mapMatchSampledAt: 10_000,
    });
    const pending = selectLiveBusMarkerPosition(nextInput, prior, 100);

    expect(pending).toMatchObject({
      decision: "match_pending",
      reason: "awaiting_match",
      position: prior.position,
      pendingUntil: 100 + MATCH_PENDING_HOLD_MS,
      uncertain: true,
    });

    const resolved = selectLiveBusMarkerPosition(
      busSample(11, {
        matchedLocation: matchedLocation(11),
        mapMatchSeq: 11,
        mapMatchSampledAt: 11_000,
      }),
      pending,
      200,
    );
    expect(resolved).toMatchObject({
      decision: "matched",
      position: { lat: 23.00011, lng: 72.00011 },
    });
  });

  it("falls back to accepted raw telemetry when the pending bound expires", () => {
    const pending = selectLiveBusMarkerPosition(
      busSample(11, { matchedLocation: matchedLocation(10) }),
      null,
      100,
    );
    const expired = selectLiveBusMarkerPosition(
      busSample(11, { matchedLocation: matchedLocation(10) }),
      pending,
      100 + MATCH_PENDING_HOLD_MS,
    );

    expect(expired).toMatchObject({
      decision: "raw",
      reason: "match_timeout",
      position: { lat: busSample(11).lat, lng: busSample(11).lng },
      uncertain: true,
    });
    expect(expired.pendingUntil).toBeUndefined();
    expect(expired.retainedMatch).toBeUndefined();
  });

  it("does not extend the hold when newer raw samples outrun the matcher", () => {
    const firstPending = selectLiveBusMarkerPosition(
      busSample(11, { matchedLocation: matchedLocation(10) }),
      null,
      100,
    );
    const newerRaw = selectLiveBusMarkerPosition(
      busSample(12, { matchedLocation: matchedLocation(10) }),
      firstPending,
      1_000,
    );

    expect(newerRaw).toMatchObject({
      decision: "match_pending",
      pendingUntil: 100 + MATCH_PENDING_HOLD_MS,
      position: {
        lat: matchedLocation(10).lat,
        lng: matchedLocation(10).lng,
      },
    });

    const expired = selectLiveBusMarkerPosition(
      busSample(13, { matchedLocation: matchedLocation(10) }),
      newerRaw,
      100 + MATCH_PENDING_HOLD_MS,
    );
    expect(expired).toMatchObject({
      decision: "raw",
      reason: "match_timeout",
      position: { lat: busSample(13).lat, lng: busSample(13).lng },
    });
  });

  it("does not wait after matching completed without a displayable match", () => {
    const prior = selectLiveBusMarkerPosition(
      busSample(10, { matchedLocation: matchedLocation(10) }),
      null,
      50,
    );
    const result = selectLiveBusMarkerPosition(
      busSample(11, {
        matchedLocation: undefined,
        mapMatchSeq: 11,
        mapMatchSampledAt: 11_000,
      }),
      prior,
      100,
    );

    expect(result).toMatchObject({
      decision: "raw",
      reason: "match_unavailable",
      uncertain: true,
    });

    const lowConfidence = selectLiveBusMarkerPosition(
      busSample(11, {
        matchedLocation: {
          ...matchedLocation(11),
          matchConfidence: 0.2,
        },
        mapMatchSeq: 11,
        mapMatchSampledAt: 11_000,
      }),
      prior,
      100,
    );
    expect(lowConfidence).toMatchObject({
      decision: "raw",
      reason: "match_unavailable",
      uncertain: true,
    });
  });

  it.each(["POSSIBLE_OFF_ROUTE", "OFF_ROUTE", "REROUTING"] as const)(
    "shows quality-filtered raw telemetry immediately while %s",
    (routeState) => {
      const prior = selectLiveBusMarkerPosition(
        busSample(10, { matchedLocation: matchedLocation(10) }),
        null,
        50,
      );
      const result = selectLiveBusMarkerPosition(
        busSample(11, {
          routeState,
          matchedLocation: matchedLocation(10),
        }),
        prior,
        100,
      );

      expect(result).toMatchObject({
        decision: "raw",
        reason: "off_route",
        position: { lat: busSample(11).lat, lng: busSample(11).lng },
        uncertain: true,
      });
    },
  );

  it.each([
    { routeVersion: 5, activeRouteId: "route_1:reroute:5" },
    { direction: "reverse" as const, routeDirection: "reverse" as const },
    { sessionId: "session_2" },
  ])("does not retain an old point after route context changes", (change) => {
    const prior = selectLiveBusMarkerPosition(
      busSample(10, { matchedLocation: matchedLocation(10) }),
      null,
      50,
    );
    const result = selectLiveBusMarkerPosition(
      busSample(11, {
        ...change,
        matchedLocation: matchedLocation(10),
      }),
      prior,
      100,
    );

    expect(result).toMatchObject({
      decision: "raw",
      reason: "route_changed",
      position: { lat: busSample(11).lat, lng: busSample(11).lng },
    });
  });

  it("uses raw telemetry after a reconnect-sized sample gap", () => {
    const priorSampledAt = 10_000;
    const nextSampledAt = priorSampledAt + SIGNAL_LOST_MS + 1;
    const prior = selectLiveBusMarkerPosition(
      busSample(10, {
        timestamp: priorSampledAt,
        rawLocation: {
          ...busSample(10).rawLocation!,
          sampledAt: priorSampledAt,
        },
        matchedLocation: matchedLocation(10, priorSampledAt),
      }),
      null,
      50,
    );
    const result = selectLiveBusMarkerPosition(
      busSample(11, {
        timestamp: nextSampledAt,
        rawLocation: {
          ...busSample(11).rawLocation!,
          sampledAt: nextSampledAt,
        },
        matchedLocation: matchedLocation(10, priorSampledAt),
      }),
      prior,
      100,
    );

    expect(result).toMatchObject({
      decision: "raw",
      reason: "reconnected",
      uncertain: true,
    });
  });

  it("ignores an older raw snapshot and a late match for an older sample", () => {
    const current = selectLiveBusMarkerPosition(
      busSample(11, { matchedLocation: matchedLocation(11) }),
      null,
      50,
    );
    const pending = selectLiveBusMarkerPosition(
      busSample(12, { matchedLocation: matchedLocation(11) }),
      current,
      100,
    );
    const lateMatch = selectLiveBusMarkerPosition(
      busSample(12, {
        matchedLocation: matchedLocation(10),
        mapMatchSeq: 10,
        mapMatchSampledAt: 10_000,
      }),
      pending,
      200,
    );
    expect(lateMatch).toMatchObject({
      decision: "match_pending",
      position: current.position,
    });

    const olderSnapshot = selectLiveBusMarkerPosition(
      busSample(10, { matchedLocation: matchedLocation(10) }),
      lateMatch,
      300,
    );
    expect(olderSnapshot).toMatchObject({
      reason: "older_snapshot",
      position: current.position,
      latestSample: { seq: 12, sampledAt: 12_000 },
    });
  });
});
