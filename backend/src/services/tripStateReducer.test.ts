import { describe, expect, it } from "vitest";
import { ORIGIN_DEPARTURE_M, reduceTripState } from "./tripStateReducer";

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
