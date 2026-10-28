import { describe, expect, it } from "vitest";
import { ORIGIN_DEPARTURE_M, reduceTripState, type TripStateResult } from "./tripStateReducer";

const origin = { lat: 23.012441, lng: 72.458011 };
const about200mNorth = { lat: origin.lat + 0.0018, lng: origin.lng };

function input(overrides: Partial<Parameters<typeof reduceTripState>[0]> = {}) {
  return {
    lat: origin.lat,
    lng: origin.lng,
    motionState: "stopped" as const,
    currentTripState: "in_service" as const,
    currentStopIndex: 0,
    stops: [origin, about200mNorth],
    hasDepartedOrigin: false,
    timestamp: 10_000, gpsHdop: 1, speed: 0,
    terminalArrival: { startedAt: 8_000, lastSampledAt: 9_000 },
    ...overrides,
  };
}

describe("reduceTripState", () => {
  it.each([4.00001, 10, NaN, -1])("does not consume departure or an intermediate stop from explicitly poor HDOP %s", gpsHdop => {
    const stops = [origin, about200mNorth, { ...origin, lat: origin.lat + 0.004 }];
    expect(reduceTripState(input({ stops, lat: about200mNorth.lat, currentStopIndex: 1,
      motionState: "moving", hasDepartedOrigin: true, gpsHdop })).currentStopIndex).toBe(1);
    expect(reduceTripState(input({ stops, lat: about200mNorth.lat, currentTripState: "pre_departure",
      motionState: "moving", gpsHdop })).tripState).toBe("pre_departure");
  });
  it("does not join an unreliable prior fix into a seemingly precise stop crossing", () => {
    const stops = [origin, about200mNorth, { ...origin, lat: origin.lat + 0.004 }];
    for (const quality of [{ gpsHdop: 10 }, { motionState: "uncertain" as const }]) {
      expect(reduceTripState(input({ stops, lat: about200mNorth.lat + 0.0001, currentStopIndex: 1,
        hasDepartedOrigin: true, motionState: "moving",
        previousPosition: { lat: about200mNorth.lat - 0.0001, lng: origin.lng, ...quality } })).currentStopIndex).toBe(1);
    }
  });
  it.each(["pre_departure", "in_service"] as const)("retains the 10m origin departure minimum for short routes in %s", currentTripState => {
    const shortStops = [origin, { ...origin, lat: origin.lat + 8 / 6_371_000 * 180 / Math.PI }];
    const near = reduceTripState(input({ currentTripState, stops: shortStops, motionState: "moving",
      lat: origin.lat + 5 / 6_371_000 * 180 / Math.PI }));
    expect(near.hasDepartedOrigin).toBe(false);
    expect(near.currentStopIndex).toBe(0);
    expect(near.tripState).toBe(currentTripState);
    const departed = reduceTripState(input({ currentTripState, stops: shortStops, motionState: "moving",
      lat: origin.lat + 10.1 / 6_371_000 * 180 / Math.PI }));
    expect(departed.hasDepartedOrigin).toBe(true);
    expect(departed.currentStopIndex).toBe(1);
  });
  it.each([
    { motionState: "moving" as const }, { motionState: "uncertain" as const },
    { gpsHdop: null }, { gpsHdop: 4.1 }, { speed: 2.6 },
    { timestamp: 9_000 }, { timestamp: 9_999 },
    { now: 70_001 }, { now: -1 },
  ])("does not complete at the final stop without reliable confirmed arrival: %j", overrides => {
    const result = reduceTripState(input({ lat: about200mNorth.lat, currentStopIndex: 1,
      hasDepartedOrigin: true, ...overrides }));
    expect(result.tripState).toBe("in_service");
  });
  it("uses a 2.5m arrival circle in both directions without advancing outside it", () => {
    const metersToLatitude = (meters: number) => meters / 6_371_000 * 180 / Math.PI;
    const middle = about200mNorth;
    const terminal = { lat: origin.lat + 0.004, lng: origin.lng };
    for (const stops of [[origin, middle, terminal], [terminal, middle, origin]]) {
      for (const [distance, expectedIndex] of [[2.6, 1], [9, 1], [2.4, 2], [0, 2]] as const) {
        const result = reduceTripState(input({ stops, lat: middle.lat + metersToLatitude(distance),
          currentStopIndex: 1, hasDepartedOrigin: true }));
        expect(result.currentStopIndex).toBe(expectedIndex);
        expect(result.tripState).toBe("in_service");
      }
    }
  });

  it("limits between-fix stop crossings to the same 2.5m circle", () => {
    const middle = about200mNorth;
    const terminal = { lat: origin.lat + 0.004, lng: origin.lng };
    for (const [distance, expectedIndex] of [[2.6, 1], [2.4, 2]] as const) {
      const lngOffset = distance / (111_320 * Math.cos(middle.lat * Math.PI / 180));
      const result = reduceTripState(input({ stops: [origin, middle, terminal],
        previousPosition: { lat: middle.lat - 0.0003, lng: middle.lng + lngOffset },
        lat: middle.lat + 0.0003, lng: middle.lng + lngOffset,
        currentStopIndex: 1, hasDepartedOrigin: true }));
      expect(result.currentStopIndex).toBe(expectedIndex);
    }
  });

  it("clears terminal confirmation outside 2.5m and requires fresh evidence on reentry", () => {
    const terminal = about200mNorth;
    const outside = reduceTripState(input({ lat: terminal.lat + 2.6 / 6_371_000 * 180 / Math.PI,
      currentStopIndex: 1, hasDepartedOrigin: true }));
    expect(outside.tripState).toBe("in_service");
    expect(outside.terminalArrival).toBeUndefined();
    const reentry = reduceTripState(input({ ...outside, lat: terminal.lat, timestamp: 11_000,
      terminalArrival: outside.terminalArrival }));
    expect(reentry.tripState).toBe("in_service");
    expect(reentry.terminalArrival).toEqual({ startedAt: 11_000, lastSampledAt: 11_000 });
    const confirmed = reduceTripState(input({ ...reentry, lat: terminal.lat, timestamp: 13_000 }));
    expect(confirmed.tripState).toBe("completed");
  });

  it("does not complete repeatedly when a route revisits its origin", () => {
    const stops = [origin, origin];
    const first = reduceTripState(input({ stops }));
    const second = reduceTripState(input({ stops, ...first }));

    expect(first.tripState).toBe("in_service");
    expect(second.tripState).toBe("in_service");
    expect(second.hasDepartedOrigin).toBe(false);
  });

  it("does not complete when the terminal is close to the origin", () => {
    const nearbyTerminal = { lat: origin.lat + 0.0001, lng: origin.lng };
    const result = reduceTripState(input({ stops: [origin, nearbyTerminal] }));

    expect(result.tripState).toBe("in_service");
  });

  it("requires departure when the driver starts directly in service", () => {
    const result = reduceTripState(input());

    expect(result.tripState).toBe("in_service");
    expect(result.hasDepartedOrigin).toBe(false);
  });

  it("persists departure evidence after moving beyond the origin radius", () => {
    const result = reduceTripState(
      input({
        lat: origin.lat + 0.0015,
        stops: [origin, { lat: origin.lat + 0.003, lng: origin.lng }],
      }),
    );

    expect(result.hasDepartedOrigin).toBe(true);
    expect(ORIGIN_DEPARTURE_M).toBe(150);
  });

  it("does not complete before end-of-route progress", () => {
    const terminal = { lat: origin.lat + 0.004, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: terminal.lat,
        lng: terminal.lng,
        stops: [origin, about200mNorth, { lat: origin.lat + 0.003, lng: origin.lng }, terminal],
        hasDepartedOrigin: true,
        currentStopIndex: 0,
      }),
    );

    expect(result.tripState).toBe("in_service");
  });

  it("completes once after departure, route progress, and terminal arrival", () => {
    const terminal = { lat: origin.lat + 0.004, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: terminal.lat,
        lng: terminal.lng,
        stops: [origin, about200mNorth, { lat: origin.lat + 0.003, lng: origin.lng }, terminal],
        hasDepartedOrigin: true,
        currentStopIndex: 3,
      }),
    );

    expect(result).toEqual({
      tripState: "completed",
      currentStopIndex: 3,
      hasDepartedOrigin: true,
    });
  });

  it("does not trust a client index to complete a straight two-stop trip in one update", () => {
    const result = reduceTripState(
      input({
        lat: about200mNorth.lat,
        lng: about200mNorth.lng,
        hasDepartedOrigin: true,
      }),
    );

    expect(result).toEqual({
      tripState: "in_service",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
    });
  });

  it("advances from the origin to the first destination after departure", () => {
    const middle = { lat: origin.lat + 0.003, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: origin.lat + 0.0015,
        stops: [origin, middle, { lat: origin.lat + 0.006, lng: origin.lng }],
      }),
    );

    expect(result.currentStopIndex).toBe(1);
    expect(result.hasDepartedOrigin).toBe(true);
    expect(result.tripState).toBe("in_service");
  });

  it("advances one stop at a time when entering an intermediate geofence", () => {
    const middle = { lat: origin.lat + 0.003, lng: origin.lng };
    const terminal = { lat: origin.lat + 0.006, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: middle.lat,
        lng: middle.lng,
        stops: [origin, middle, terminal],
        currentStopIndex: 1,
        hasDepartedOrigin: true,
      }),
    );

    expect(result).toEqual({
      tripState: "in_service",
      currentStopIndex: 2,
      hasDepartedOrigin: true,
    });
  });

  it("advances when an intermediate stop is crossed between telemetry fixes", () => {
    const middle = { lat: origin.lat + 0.003, lng: origin.lng };
    const terminal = { lat: origin.lat + 0.006, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: middle.lat + 0.00045,
        lng: middle.lng,
        previousPosition: { lat: middle.lat - 0.00045, lng: middle.lng },
        stops: [origin, middle, terminal],
        currentStopIndex: 1,
        hasDepartedOrigin: true,
      }),
    );

    expect(result).toEqual({
      tripState: "in_service",
      currentStopIndex: 2,
      hasDepartedOrigin: true,
    });
  });

  it("does not skip the expected stop when the bus reaches a downstream stop", () => {
    const missed = { lat: origin.lat + 0.002, lng: origin.lng };
    const downstream = { lat: origin.lat + 0.004, lng: origin.lng };
    const terminal = { lat: origin.lat + 0.006, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: downstream.lat,
        lng: downstream.lng,
        stops: [origin, missed, downstream, terminal],
        currentStopIndex: 1,
        hasDepartedOrigin: true,
      }),
    );

    expect(result.currentStopIndex).toBe(1);
    expect(result.tripState).toBe("in_service");
  });

  it("does not infer crossed stops from an implausibly long GPS jump", () => {
    const middle = { lat: origin.lat + 0.003, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: origin.lat + 0.006,
        previousPosition: { lat: origin.lat - 0.006, lng: origin.lng },
        stops: [origin, middle, { lat: origin.lat + 0.009, lng: origin.lng }],
        currentStopIndex: 1,
        hasDepartedOrigin: true,
      }),
    );

    expect(result.currentStopIndex).toBe(1);
  });

  it("requires the authoritative terminal index before completion", () => {
    const result = reduceTripState(
      input({
        lat: about200mNorth.lat,
        lng: about200mNorth.lng,
        currentStopIndex: 1,
        hasDepartedOrigin: true,
      }),
    );

    expect(result.tripState).toBe("completed");
  });

  it("keeps the ride active when GNSS becomes uncertain", () => {
    const lost = reduceTripState(input({ motionState: "uncertain" }));
    const recovered = reduceTripState(
      input({
        currentTripState: "maintenance",
        hasDepartedOrigin: lost.hasDepartedOrigin,
      }),
    );

    expect(lost.tripState).toBe("in_service");
    expect(recovered.tripState).toBe("in_service");
  });

  it("keeps a parked armed ride ready until observed departure", () => {
    const waiting = reduceTripState(
      input({
        currentTripState: "pre_departure",
        lat: origin.lat + 0.001,
      }),
    );
    const uncertainAtOrigin = reduceTripState(
      input({
        currentTripState: "pre_departure",
        motionState: "uncertain",
      }),
    );
    const arrived = reduceTripState(
      input({ currentTripState: "pre_departure" }),
    );

    expect(waiting.tripState).toBe("pre_departure");
    expect(uncertainAtOrigin.tripState).toBe("pre_departure");
    expect(arrived.tripState).toBe("pre_departure");
  });
});

it("completes 100 stops in both travel orders without skipping an intermediate stop", () => {
  const natural = Array.from({ length: 100 }, (_, i) => ({ lat: 23 + i * 0.0005, lng: 72 }));
  for (const stops of [natural, [...natural].reverse()]) {
    let state = { tripState: "in_service" as const, currentStopIndex: 0, hasDepartedOrigin: false } as ReturnType<typeof reduceTripState>;
    const start = stops[0];
    const next = stops[1];
    state = reduceTripState({ ...start, motionState: "moving", stops, currentTripState: state.tripState, currentStopIndex: state.currentStopIndex, hasDepartedOrigin: state.hasDepartedOrigin,
      lat: start.lat + (next.lat - start.lat) * 0.6 });
    expect(state.currentStopIndex).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      state = reduceTripState({ ...stops[i], stops, motionState: "stopped", currentTripState: state.tripState,
        currentStopIndex: state.currentStopIndex, hasDepartedOrigin: state.hasDepartedOrigin,
        timestamp: 10_000, gpsHdop: 1, speed: 0, terminalArrival: { startedAt: 8_000, lastSampledAt: 9_000 } });
      expect(state.currentStopIndex).toBe(Math.min(i + 1, stops.length - 1));
      expect(state.tripState).toBe(i === stops.length - 1 ? "completed" : "in_service");
    }
  }
});

it("consumes nearby stops crossed in order during one bounded telemetry segment", () => {
  const stops = [0, 1, 2, 3].map(i => ({ lat: 23 + i * 0.0005, lng: 72 }));
  const result = reduceTripState({ lat: 23.0011, lng: 72, previousPosition: { lat: 23.0002, lng: 72 },
    currentTripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true, motionState: "moving", stops });
  expect(result.currentStopIndex).toBe(3);
  expect(result.tripState).toBe("in_service");
});

it.each(["pre_departure", "in_service"] as const)(
  "consumes a closely spaced first stop crossed by the %s origin-departure segment",
  currentTripState => {
    const north = (meters: number) => ({ lat: 23 + meters / 6_371_000 * 180 / Math.PI, lng: 72 });
    // Departure radius is 20m here, so one 30m heartbeat can both leave the
    // origin and pass stop 1. Dropping that crossing would strand the ride at
    // index 1 because only the next ordered stop may ever advance it.
    const stops = [north(0), north(40), north(200), north(400)];
    const departed = reduceTripState({ ...north(45), previousPosition: north(15), motionState: "moving",
      currentTripState, currentStopIndex: 0, stops, hasDepartedOrigin: false });
    expect(departed).toEqual({ tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true });
  },
);

it("does not reuse prior terminal evidence in the update that leaves the origin", () => {
  const north = (meters: number) => ({ lat: 23 + meters / 6_371_000 * 180 / Math.PI, lng: 72 });
  const stops = [north(0), north(30)];
  const result = reduceTripState({ ...north(30), previousPosition: north(5), motionState: "stopped",
    currentTripState: "in_service", currentStopIndex: 0, stops, hasDepartedOrigin: true,
    timestamp: 10_000, gpsHdop: 1, speed: 0, terminalArrival: { startedAt: 1_000, lastSampledAt: 9_000 } });
  expect(result.tripState).toBe("in_service");
  expect(result.currentStopIndex).toBe(1);
});

it.each(["pre_departure", "in_service"] as const)(
  "treats a %s crossing of a first stop inside the minimum departure radius as departure",
  currentTripState => {
    const north = (meters: number) => ({ lat: 23 + meters / 6_371_000 * 180 / Math.PI, lng: 72 });
    // Stop 1 is 6m from the origin, inside the 10m minimum departure radius.
    // The 3m->9m heartbeat passes it before departure is otherwise proven; the
    // next 9m->14m segment no longer touches it, so the ride would be stranded.
    const stops = [north(0), north(6), north(300)];
    let state = { tripState: currentTripState as "pre_departure" | "in_service", currentStopIndex: 0, hasDepartedOrigin: false };
    let previous: { lat: number; lng: number } | undefined;
    for (const meters of [0, 3, 9, 14, 19]) {
      const result = reduceTripState({ ...north(meters), previousPosition: previous, motionState: "moving",
        currentTripState: state.tripState, currentStopIndex: state.currentStopIndex, stops,
        hasDepartedOrigin: state.hasDepartedOrigin });
      state = result as typeof state;
      previous = north(meters);
    }
    expect(state).toEqual({ tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true });
    // Parked jitter across the stop is not departure evidence.
    expect(reduceTripState({ ...north(7), previousPosition: north(3), motionState: "stopped", currentTripState,
      currentStopIndex: 0, stops, hasDepartedOrigin: false })).toMatchObject({ currentStopIndex: 0, hasDepartedOrigin: false });
  },
);

describe("stops missed during a GNSS gap", () => {
  const north = (meters: number) => ({ lat: 23 + meters / 6_371_000 * 180 / Math.PI, lng: 72 });
  // origin, A, B, C, terminal: 300 m apart.
  const stops = [north(0), north(300), north(600), north(900), north(1200)];
  const fix = (meters: number, timestamp: number, extra: Partial<Parameters<typeof reduceTripState>[0]> = {}) => ({
    ...north(meters), motionState: "moving" as const, currentTripState: "in_service" as const, currentStopIndex: 1,
    stops, hasDepartedOrigin: true, timestamp, gpsHdop: 1, speed: 30, ...extra,
  });

  it("skips A and B when the bus is next observed at C after losing GNSS before A", () => {
    const result = reduceTripState(fix(900, 90_000, { previousPosition: { ...north(250), timestamp: 30_000 } }));
    expect(result).toMatchObject({ tripState: "in_service", currentStopIndex: 4, skippedStopIndices: [1, 2] });
    expect(result.gnssGapSince).toBeUndefined();
  });

  it("keeps the gap open between stops, then skips when a later stop is crossed", () => {
    const reappeared = reduceTripState(fix(850, 90_000, { previousPosition: { ...north(250), timestamp: 30_000 } }));
    expect(reappeared).toMatchObject({ currentStopIndex: 1, gnssGapSince: 30_000 });
    expect(reappeared.skippedStopIndices).toBeUndefined();
    const crossed = reduceTripState(fix(905, 91_000, { previousPosition: { ...north(850), timestamp: 90_000 },
      gnssGapSince: reappeared.gnssGapSince }));
    expect(crossed).toMatchObject({ currentStopIndex: 4, skippedStopIndices: [1, 2] });
    expect(crossed.gnssGapSince).toBeUndefined();
  });

  it.each([
    ["ten missed heartbeats", { previousPosition: { ...north(890), timestamp: 79_999 } }],
    ["an untrusted previous fix", { previousPosition: { ...north(890), timestamp: 89_000, motionState: "uncertain" as const } }],
    ["a segment too long to check", { previousPosition: { ...north(600), timestamp: 89_000 } }],
  ])("opens a gap from %s", (_name, extra) => {
    expect(reduceTripState(fix(900, 90_000, extra))).toMatchObject({ currentStopIndex: 4, skippedStopIndices: [1, 2] });
  });

  it("opens a gap on an untrusted fix without moving the ride", () => {
    expect(reduceTripState(fix(500, 90_000, { motionState: "uncertain", previousPosition: { ...north(250), timestamp: 89_000 } })))
      .toEqual({ tripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true, gnssGapSince: 89_000 });
  });

  it("never skips a stop without a GNSS gap", () => {
    const result = reduceTripState(fix(900, 90_000, { previousPosition: { ...north(890), timestamp: 89_000 } }));
    expect(result).toEqual({ tripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true });
  });

  it("closes the gap without skipping when the expected stop is observed", () => {
    const result = reduceTripState(fix(300, 90_000, { previousPosition: { ...north(290), timestamp: 89_000 }, gnssGapSince: 30_000 }));
    expect(result).toEqual({ tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true });
  });

  it("skips to the terminal but still requires a confirmed stopped arrival", () => {
    const arrived = reduceTripState(fix(1200, 90_000, { motionState: "stopped", speed: 0,
      previousPosition: { ...north(250), timestamp: 30_000 } }));
    expect(arrived).toMatchObject({ tripState: "in_service", currentStopIndex: 4, skippedStopIndices: [1, 2, 3],
      terminalArrival: { startedAt: 90_000, lastSampledAt: 90_000 } });
    const confirmed = reduceTripState(fix(1200, 92_000, { motionState: "stopped", speed: 0, currentStopIndex: 4,
      previousPosition: { ...north(1200), timestamp: 90_000 }, terminalArrival: arrived.terminalArrival }));
    expect(confirmed.tripState).toBe("completed");
  });

  it("does not let a stale replay open a gap", () => {
    const result = reduceTripState(fix(900, 90_000, { now: 200_000, previousPosition: { ...north(250), timestamp: 30_000 } }));
    expect(result).toEqual({ tripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true });
  });
});

describe("GNSS gap on routes that revisit a stop location", () => {
  const north = (meters: number, east = 0) => ({
    lat: 23 + meters / 6_371_000 * 180 / Math.PI,
    lng: 72 + east / (6_371_000 * Math.cos(23 * Math.PI / 180)) * 180 / Math.PI,
  });
  // Out-and-back route with shared physical stops: A -> B -> C -> B -> A.
  const outAndBack = [north(0), north(300), north(600), north(300), north(0)];
  const dwellAtB = { ...north(300), motionState: "stopped" as const, gpsHdop: 1, speed: 0 };
  // Outbound B (stop 1) was observed; the next expected stop is C (index 2).
  const afterB = { currentTripState: "in_service" as const, currentStopIndex: 2, hasDepartedOrigin: true, stops: outAndBack };

  it("does not credit later stops after an untrusted fix while dwelling at an already passed shared stop", () => {
    const uncertain = reduceTripState({ ...afterB, ...north(300), motionState: "uncertain", gpsHdop: 1, speed: 0,
      previousPosition: { ...dwellAtB, timestamp: 1_999_000 }, timestamp: 2_000_000, now: 2_000_000 });
    expect(uncertain).toMatchObject({ currentStopIndex: 2, gnssGapSince: 1_999_000 });
    const next = reduceTripState({ ...afterB, ...dwellAtB, gnssGapSince: uncertain.gnssGapSince,
      previousPosition: { ...north(300), motionState: "uncertain", gpsHdop: 1, timestamp: 2_000_000 },
      timestamp: 2_001_000, now: 2_001_000 });
    expect(next).toEqual({ tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true, gnssGapSince: 1_999_000 });
  });

  it("does not credit later stops when a restart seeds a gap while the bus dwells at a passed shared stop", () => {
    const next = reduceTripState({ ...afterB, ...dwellAtB, gnssGapSince: 3_000_000, timestamp: 3_000_000, now: 3_000_000 });
    expect(next).toEqual({ tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true, gnssGapSince: 3_000_000 });
  });

  it("does not credit later stops after an 11 s outage while the bus dwells at a passed shared stop", () => {
    const next = reduceTripState({ ...afterB, ...dwellAtB, previousPosition: { ...dwellAtB, timestamp: 3_989_000 },
      timestamp: 4_000_000, now: 4_000_000 });
    expect(next).toEqual({ tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true, gnssGapSince: 3_989_000 });
  });

  it("does not complete a loop route when the bus stops back at the origin after a gap", () => {
    const loop = [north(0), north(0, 300), north(300, 300), north(0)];
    const atOrigin = { ...north(0), motionState: "stopped" as const, gpsHdop: 1, speed: 0 };
    const first = reduceTripState({ currentTripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true, stops: loop,
      ...atOrigin, previousPosition: { ...north(160), motionState: "moving", gpsHdop: 1, timestamp: 4_989_000 },
      timestamp: 5_000_000, now: 5_000_000 });
    expect(first).toEqual({ tripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true, gnssGapSince: 4_989_000 });
    const second = reduceTripState({ currentTripState: first.tripState, currentStopIndex: first.currentStopIndex,
      hasDepartedOrigin: first.hasDepartedOrigin, stops: loop, ...atOrigin, terminalArrival: first.terminalArrival,
      gnssGapSince: first.gnssGapSince, previousPosition: { ...atOrigin, timestamp: 5_000_000 },
      timestamp: 5_002_000, now: 5_002_000 });
    expect(second).toMatchObject({ tripState: "in_service", currentStopIndex: 1 });
    expect(second.skippedStopIndices).toBeUndefined();
  });

  it("does not credit a later stop whose location coincides with a passed stop on a segment crossing it", () => {
    // Gap, then a reliable segment running from past B back through B: only the return copy of B matches.
    const next = reduceTripState({ ...afterB, ...north(250), motionState: "moving", gpsHdop: 1, speed: 20,
      gnssGapSince: 5_000_000, previousPosition: { ...north(350), timestamp: 5_009_000 },
      timestamp: 5_010_000, now: 5_010_000 });
    expect(next).toEqual({ tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true, gnssGapSince: 5_000_000 });
  });

  it("still credits stops skipped during a gap once the bus is observed at a unique later stop", () => {
    // GNSS lost after departure, before outbound B; the bus is next seen at C.
    const atC = reduceTripState({ ...afterB, currentStopIndex: 1, ...north(600), motionState: "moving", gpsHdop: 1,
      speed: 20, previousPosition: { ...north(100), timestamp: 6_000_000 }, timestamp: 6_060_000, now: 6_060_000 });
    expect(atC).toEqual({ tripState: "in_service", currentStopIndex: 3, hasDepartedOrigin: true, skippedStopIndices: [1] });
  });
});

describe("GNSS gap that really hid a drive round to a revisited stop location", () => {
  const at = (north: number, east = 0) => ({
    lat: 23 + north / 6_371_000 * 180 / Math.PI,
    lng: 72 + east / (6_371_000 * Math.cos(23 * Math.PI / 180)) * 180 / Math.PI,
  });
  type Ride = Pick<TripStateResult, "tripState" | "currentStopIndex" | "hasDepartedOrigin" | "terminalArrival" | "gnssGapSince"> &
    { skipped: number[] };
  type Fix = { p: { lat: number; lng: number }; t: number; motion?: "moving" | "stopped" | "uncertain"; hdop?: number; speed?: number };
  /** Feeds fixes the way the trip engine carries reducer state forward. */
  function drive(stops: { lat: number; lng: number }[], ride: Ride, previous: Fix | undefined, fixes: Fix[]) {
    for (const fix of fixes) {
      if (ride.tripState === "completed") break;
      const motion = fix.motion ?? "stopped";
      const result = reduceTripState({ ...fix.p, motionState: motion, gpsHdop: fix.hdop ?? 1,
        speed: fix.speed ?? (motion === "moving" ? 20 : 0), timestamp: fix.t, now: fix.t, stops,
        currentTripState: ride.tripState as "in_service", currentStopIndex: ride.currentStopIndex,
        hasDepartedOrigin: ride.hasDepartedOrigin, terminalArrival: ride.terminalArrival, gnssGapSince: ride.gnssGapSince,
        previousPosition: previous && { ...previous.p, motionState: previous.motion ?? "stopped",
          gpsHdop: previous.hdop ?? 1, timestamp: previous.t } });
      ride = { ...result, skipped: [...ride.skipped, ...(result.skippedStopIndices ?? [])] };
      previous = fix;
    }
    return ride;
  }
  const parked = (p: { lat: number; lng: number }, from: number, seconds: number, extra: Partial<Fix> = {}) =>
    Array.from({ length: seconds }, (_, i): Fix => ({ p, t: from + i * 1000, ...extra }));
  const inService = (currentStopIndex: number, gnssGapSince?: number): Ride =>
    ({ tripState: "in_service", currentStopIndex, hasDepartedOrigin: true, skipped: [], gnssGapSince });

  // Loop O -> S1 -> S2 -> O (about 300 m + 300 m + 424 m).
  const loop = [at(0), at(0, 300), at(300, 300), at(0)];

  it("completes a loop ride when a long gap hid the last stop and the bus then parks at the terminal", () => {
    const beforeGap: Fix = { p: at(0, 300), t: 1_000_000, motion: "moving" }; // just past S1
    const approach: Fix[] = [{ p: at(40), t: 1_090_000, motion: "moving" }, { p: at(10), t: 1_091_000, motion: "moving" }];
    const end = drive(loop, inService(2), beforeGap, [...approach, ...parked(at(0), 1_092_000, 5)]);
    expect(end).toMatchObject({ tripState: "completed", skipped: [2] });
  });

  it("completes when the bus creeps into the terminal so slowly that its last approach fixes read stopped", () => {
    const beforeGap: Fix = { p: at(0, 300), t: 1_000_000, motion: "moving" };
    const creep: Fix[] = [{ p: at(8), t: 1_090_000, motion: "stopped", speed: 1 },
      { p: at(4), t: 1_091_000, motion: "stopped", speed: 1 }];
    const end = drive(loop, inService(2), beforeGap, [...creep, ...parked(at(0), 1_092_000, 5)]);
    expect(end).toMatchObject({ tripState: "completed", skipped: [2] });
  });

  it("completes when the bus is already parked at the terminal when GNSS returns with untrusted fixes first", () => {
    const beforeGap: Fix = { p: at(0, 300), t: 1_000_000, motion: "moving" };
    const end = drive(loop, inService(2), beforeGap, [
      ...parked(at(0), 1_120_000, 3, { motion: "uncertain" }),
      ...parked(at(0), 1_123_000, 3, { hdop: 9 }),
      ...parked(at(0), 1_126_000, 5),
    ]);
    expect(end).toMatchObject({ tripState: "completed", skipped: [2] });
  });

  it("completes an out-and-back ride whose turnaround stop was hidden by a gap", () => {
    // A -> B -> C -> B -> A with B and A shared; the gap hides C.
    const route = [at(0), at(300), at(600), at(300), at(0)];
    const beforeGap: Fix = { p: at(320), t: 2_000_000, motion: "moving" }; // just past outbound B
    const back: Fix[] = [{ p: at(320), t: 2_050_000, motion: "moving" }, { p: at(300), t: 2_051_000, motion: "moving" }];
    const home = Array.from({ length: 30 }, (_, i): Fix => ({ p: at(290 - i * 10), t: 2_052_000 + i * 1000, motion: "moving" }));
    const end = drive(route, inService(2), beforeGap, [...back, ...home, ...parked(at(0), 2_082_000, 5)]);
    expect(end).toMatchObject({ tripState: "completed", skipped: [2] });
  });

  it("never ages a long dwell at a passed shared stop into a revisit, even with a few metres of GNSS jitter", () => {
    const route = [at(0), at(300), at(600), at(300), at(0)];
    const jitter = [0, 1.5, -2, 4, -4, 2.2, 0.5, -1, 3, -3];
    const dwell = Array.from({ length: 600 }, (_, i): Fix => ({ p: at(300 + jitter[i % jitter.length], jitter[(i + 3) % 10] / 2),
      t: 3_001_000 + i * 1000 }));
    const end = drive(route, inService(2, 3_000_000), { p: at(300), t: 3_000_000 }, dwell);
    expect(end).toMatchObject({ tripState: "in_service", currentStopIndex: 2, skipped: [] });
    expect(end.gnssGapSince).toBeGreaterThan(3_500_000);
  });

  it("does not credit a return to the origin faster than the loop could be driven", () => {
    const beforeGap: Fix = { p: at(150), t: 4_000_000, motion: "moving" };
    const end = drive(loop, inService(1), beforeGap, parked(at(0), 4_030_000, 120));
    expect(end).toMatchObject({ tripState: "in_service", currentStopIndex: 1, skipped: [] });
  });

  /** Moving 1 Hz fixes every 10 m from one point to another, endpoints excluded. */
  const along = (from: [number, number], to: [number, number], t0: number) => {
    const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 10);
    return Array.from({ length: steps - 1 }, (_, i): Fix => ({ t: t0 + i * 1000, motion: "moving",
      p: at(from[0] + (to[0] - from[0]) * (i + 1) / steps, from[1] + (to[1] - from[1]) * (i + 1) / steps) }));
  };

  it("does not let a straight chord across a long blackout observe a stop and close the gap", () => {
    // The bus was heading for stop 1 when GNSS went dark for 65 s; it passed
    // stops 1-3 unseen and came back. The straight 180 m line between the
    // fixes on either side passes straight through stop 1.
    const route = [at(0), at(-211, -10), at(-426, 188), at(-440, 179), at(-318, -73)];
    const beforeGap: Fix = { p: at(-160, -8), t: 1_044_000, motion: "moving" };
    const reappears: Fix = { p: at(-340, -15), t: 1_109_000, motion: "moving" };
    expect(drive(route, inService(1), beforeGap, [reappears]))
      .toMatchObject({ tripState: "in_service", currentStopIndex: 1, gnssGapSince: 1_044_000, skipped: [] });
    const end = drive(route, inService(1), beforeGap,
      [reappears, ...along([-340, -15], [-318, -73], 1_110_000), ...parked(at(-318, -73), 1_117_000, 5)]);
    expect(end).toMatchObject({ tripState: "completed", skipped: [1, 2, 3] });
  });

  // Out-and-back A, B, C, D, C', B', A' on one road; the shared copies
  // coincide. The bus was seen past B (next stop C) when GNSS went dark.
  const outAndBack = [at(0), at(200), at(400), at(600), at(400), at(200), at(0)];
  const pastB: Fix = { p: at(250), t: 5_000_000, motion: "moving" };
  const homeFrom = (north: number, t0: number) =>
    [...along([north, 0], [0, 0], t0), ...parked(at(0), t0 + north * 100, 5)];

  it("credits the return copy, not the outbound stop, when a blackout hid the turnaround", () => {
    const end = drive(outAndBack, inService(2), pastB,
      [{ p: at(450), t: 5_060_000, motion: "moving" }, ...homeFrom(450, 5_061_000)]);
    expect(end).toMatchObject({ tripState: "completed", skipped: [2, 3] });
  });

  it("waits for a direction when the bus reappears sitting on a shared stop after the turnaround", () => {
    const sitting = parked(at(400), 5_060_000, 5);
    expect(drive(outAndBack, inService(2), pastB, sitting))
      .toMatchObject({ tripState: "in_service", currentStopIndex: 2, gnssGapSince: 5_000_000, skipped: [] });
    const end = drive(outAndBack, inService(2), pastB, [...sitting, ...homeFrom(400, 5_065_000)]);
    expect(end).toMatchObject({ tripState: "completed", skipped: [2, 3] });
  });

  it("credits the outbound stop without skipping when the bus dwells there after a gap and drives on", () => {
    // Long outage, then seen dwelling at outbound C: it may not skip the turnaround.
    const sitting = parked(at(400), 5_060_000, 30);
    const onward = [...along([400, 0], [600, 0], 5_090_000), ...parked(at(600), 5_109_000, 3)];
    const atTurnaround = drive(outAndBack, inService(2), pastB, [...sitting, ...onward]);
    expect(atTurnaround).toMatchObject({ tripState: "in_service", currentStopIndex: 4, skipped: [] });
    expect(atTurnaround.gnssGapSince).toBeUndefined();
  });

  it("completes when a blackout hides the stops before a terminal that shares an earlier stop's location", () => {
    // A, B, C, D, C (terminal): the bus parks at the terminal with no fix to show its direction.
    const lollipop = [at(0), at(200), at(400), at(500, 100), at(400)];
    const end = drive(lollipop, inService(2), pastB, parked(at(400), 5_090_000, 6));
    expect(end).toMatchObject({ tripState: "completed", skipped: [2, 3] });
  });
});
