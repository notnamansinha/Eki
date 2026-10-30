import { describe, expect, it } from "vitest";
import {
  MAX_UNOBSERVED_RECOVERY_STOPS,
  ORIGIN_DEPARTURE_M,
  STOP_ARRIVAL_GEOFENCE_M,
  reduceTripState,
  visitedStopIndex,
  type TripStateResult,
} from "./tripStateReducer";

// Regressions from the 29 Oct 2026 passenger field ride on deployed main:
// A was marked only on reaching B, and B never at all, even at C. A stop
// configured a few metres off the travelled lane sat outside the 2.5 m circle,
// and only the next expected stop could ever advance the ride.
const at = (north: number, east = 0) => ({
  lat: 23 + north / 6_371_000 * 180 / Math.PI,
  lng: 72 + east / (6_371_000 * Math.cos(23 * Math.PI / 180)) * 180 / Math.PI,
});

type Ride = Pick<TripStateResult, "tripState" | "currentStopIndex" | "hasDepartedOrigin" | "terminalArrival" | "gnssGapSince">;
interface Step { north: number; east: number; t: number; ride: Ride; skipped: number[]; unobserved: number[]; visited: number | null }

/** Drives 1 Hz reliable fixes along a lane offset `east` metres from the stops, as the trip engine carries state. */
function drive(stops: { lat: number; lng: number }[], norths: number[], east: number,
  start: Ride = { tripState: "in_service", currentStopIndex: 0, hasDepartedOrigin: false }, motion: "moving" | "stopped" = "moving") {
  const steps: Step[] = [];
  let ride = start;
  let previous: { lat: number; lng: number; timestamp: number } | undefined;
  norths.forEach((north, i) => {
    const t = 1_000_000 + i * 1000;
    const position = at(north, east);
    const result = reduceTripState({ ...position, previousPosition: previous && { ...previous, motionState: motion, gpsHdop: 1 },
      motionState: motion, gpsHdop: 1, speed: motion === "moving" ? 30 : 0, timestamp: t, now: t, stops,
      currentTripState: ride.tripState as "in_service", currentStopIndex: ride.currentStopIndex,
      hasDepartedOrigin: ride.hasDepartedOrigin, terminalArrival: ride.terminalArrival, gnssGapSince: ride.gnssGapSince });
    ride = result;
    const prior = steps.at(-1);
    const unobserved = [...(prior?.unobserved ?? []), ...(result.unobservedStopIndices ?? [])];
    steps.push({ north, east, t, ride: result, skipped: [...(prior?.skipped ?? []), ...(result.skippedStopIndices ?? [])],
      unobserved, visited: visitedStopIndex({ ...position, motionState: motion, gpsHdop: 1, stops, ...result, unobservedStopIndices: unobserved }) });
    previous = { ...position, timestamp: t };
  });
  return steps;
}
const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let value = from; step > 0 ? value <= to : value >= to; value += step) out.push(value);
  return out;
};
/** North position of the first fix at which the ride's next stop moved past `index`. */
const markedAt = (steps: Step[], index: number) => steps.find(step => step.ride.currentStopIndex > index)?.north;

describe("field ride: stops are marked at the stop, not one stop later", () => {
  // A (origin), B, C, D (terminal), 300 m apart on a straight road.
  const stops = [at(0), at(300), at(600), at(900)];

  it.each([0, 3, 6, 10, 12])("marks B while the bus is abreast of it on a lane %i m from the configured point", east => {
    const steps = drive(stops, range(0, 700, 8), east);
    const b = markedAt(steps, 1)!;
    expect(Math.abs(b - 300)).toBeLessThanOrEqual(STOP_ARRIVAL_GEOFENCE_M);
    const c = markedAt(steps, 2)!;
    expect(Math.abs(c - 600)).toBeLessThanOrEqual(STOP_ARRIVAL_GEOFENCE_M);
    expect(steps.at(-1)!.unobserved).toEqual([]);
  });

  it("leaves the origin within a bounded distance instead of waiting until the next stop", () => {
    expect(ORIGIN_DEPARTURE_M).toBeLessThanOrEqual(50);
    const steps = drive(stops, range(0, 200, 8), 4);
    expect(markedAt(steps, 0)).toBeLessThanOrEqual(ORIGIN_DEPARTURE_M + 8);
  });

  it("does not mark a stop from a parallel road or the far carriageway", () => {
    const steps = drive(stops, range(0, 350, 8), 30);
    expect(steps.at(-1)!.ride.currentStopIndex).toBe(1);
  });

  it("does not let jitter at the origin depart before the bus has actually left", () => {
    const jitter = [0, 4, -3, 8, -6, 10, 2, -9].map(north => north);
    const steps = drive(stops, jitter, 3, { tripState: "pre_departure", currentStopIndex: 0, hasDepartedOrigin: false }, "stopped");
    expect(steps.at(-1)!.ride).toMatchObject({ tripState: "pre_departure", currentStopIndex: 0, hasDepartedOrigin: false });
  });
});

describe("field ride: a missed stop no longer strands the ride", () => {
  const stops = [at(0), at(300), at(600), at(900), at(1200)];
  // The road bends away from B: the bus passes 40 m east of it, then rejoins.
  const lane = (north: number) => north > 250 && north < 350 ? 40 : 3;
  function bentDrive(norths: number[]) {
    const steps: Step[] = [];
    let ride: Ride = { tripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true };
    let previous: { lat: number; lng: number; timestamp: number } | undefined;
    norths.forEach((north, i) => {
      const t = 2_000_000 + i * 1000;
      const position = at(north, lane(north));
      const result = reduceTripState({ ...position, previousPosition: previous && { ...previous, motionState: "moving", gpsHdop: 1 },
        motionState: "moving", gpsHdop: 1, speed: 30, timestamp: t, now: t, stops, currentTripState: "in_service",
        currentStopIndex: ride.currentStopIndex, hasDepartedOrigin: ride.hasDepartedOrigin });
      ride = result;
      const prior = steps.at(-1);
      steps.push({ north, east: lane(north), t, ride: result, skipped: [...(prior?.skipped ?? []), ...(result.skippedStopIndices ?? [])],
        unobserved: [...(prior?.unobserved ?? []), ...(result.unobservedStopIndices ?? [])], visited: null });
      previous = { ...position, timestamp: t };
    });
    return steps;
  }

  it("credits B as unobserved (not arrived) when the bus reaches C with continuous telemetry", () => {
    const steps = bentDrive(range(100, 700, 8));
    const atC = steps.find(step => step.ride.currentStopIndex === 3)!;
    expect(Math.abs(atC.north - 600)).toBeLessThanOrEqual(STOP_ARRIVAL_GEOFENCE_M);
    expect(atC.unobserved).toEqual([1]);
    // Unobserved is not a GNSS-gap skip and never invents a precise arrival.
    expect(atC.skipped).toEqual([]);
  });

  it("is bounded: a stop further ahead than the recovery window never advances the ride", () => {
    expect(MAX_UNOBSERVED_RECOVERY_STOPS).toBe(2);
    const far = reduceTripState({ ...at(1200, 3), previousPosition: { ...at(1190, 3), timestamp: 999, motionState: "moving", gpsHdop: 1 },
      motionState: "moving", gpsHdop: 1, speed: 30, timestamp: 1000, now: 1000, stops,
      currentTripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true });
    expect(far.currentStopIndex).toBe(1);
    expect(far.unobservedStopIndices).toBeUndefined();
  });

  it("needs direction evidence: a single fix sitting at a later stop is not enough", () => {
    const sitting = reduceTripState({ ...at(600, 3), motionState: "stopped", gpsHdop: 1, speed: 0, timestamp: 1000, now: 1000,
      stops, currentTripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true });
    expect(sitting.currentStopIndex).toBe(1);
  });

  it("never credits a later stop the bus passes travelling against the route", () => {
    const backwards = reduceTripState({ ...at(590, 3), previousPosition: { ...at(610, 3), timestamp: 999, motionState: "moving", gpsHdop: 1 },
      motionState: "moving", gpsHdop: 1, speed: 30, timestamp: 1000, now: 1000, stops,
      currentTripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true });
    expect(backwards.currentStopIndex).toBe(1);
  });

  it("does not complete the trip from a downstream jump: the terminal still needs a confirmed stopped arrival", () => {
    const stopsShort = [at(0), at(300), at(600)];
    const jumped = reduceTripState({ ...at(600, 3), previousPosition: { ...at(590, 3), timestamp: 999, motionState: "moving", gpsHdop: 1 },
      motionState: "moving", gpsHdop: 1, speed: 30, timestamp: 1000, now: 1000, stops: stopsShort,
      currentTripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true });
    expect(jumped).toMatchObject({ tripState: "in_service", currentStopIndex: 2, unobservedStopIndices: [1] });
  });

  it("never credits the terminal of a loop while leaving its shared origin", () => {
    const loop = [at(0), at(0, 300), at(300, 300), at(0, 5)];
    const leaving = reduceTripState({ ...at(0, 20), previousPosition: { ...at(0, 2), timestamp: 999, motionState: "moving", gpsHdop: 1 },
      motionState: "moving", gpsHdop: 1, speed: 20, timestamp: 1000, now: 1000, stops: loop,
      currentTripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true });
    expect(leaving).toMatchObject({ tripState: "in_service", currentStopIndex: 1 });
    expect(leaving.unobservedStopIndices).toBeUndefined();
  });

  it("never credits an out-and-back return copy across the road from a passed stop, in either direction", () => {
    // A, B, C (turnaround), B', A' with B' on the far kerb, 18 m from B; next expected is C.
    const outAndBack = [at(0), at(300), at(600), at(300, 18), at(0, 18)];
    for (const [from, to] of [[at(298, 3), at(310, 3)], [at(305, 18), at(293, 18)]]) {
      const result = reduceTripState({ ...to, previousPosition: { ...from, timestamp: 999, motionState: "moving", gpsHdop: 1 },
        motionState: "moving", gpsHdop: 1, speed: 30, timestamp: 1000, now: 1000, stops: outAndBack,
        currentTripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true });
      expect(result.currentStopIndex).toBe(2);
      expect(result.unobservedStopIndices).toBeUndefined();
    }
  });

  it("credits a missed turnaround once the bus drives through a return stop that is not shared", () => {
    const outAndBack = [at(0), at(300), at(600), at(450, 40), at(0, 40)];
    const inbound = reduceTripState({ ...at(444, 40), previousPosition: { ...at(456, 40), timestamp: 999, motionState: "moving", gpsHdop: 1 },
      motionState: "moving", gpsHdop: 1, speed: 30, timestamp: 1000, now: 1000, stops: outAndBack,
      currentTripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true });
    expect(inbound).toMatchObject({ currentStopIndex: 4, unobservedStopIndices: [2] });
  });
});

describe("terminal arrival at a realistic kerb offset", () => {
  it("completes when the bus parks 8 m from the configured terminal for the confirmation interval", () => {
    const stops = [at(0), at(300), at(600)];
    const steps = drive(stops, [...range(400, 592, 8), 592, 592, 592, 592], 6,
      { tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true });
    // The last moving fixes approach; then the bus parks. Re-run the parked tail as stopped.
    const parkedStart = steps.at(-1)!.ride;
    let ride: Ride = parkedStart;
    let previous = { ...at(592, 6), timestamp: 3_000_000 };
    for (const t of [3_001_000, 3_002_000, 3_003_000]) {
      ride = reduceTripState({ ...at(592, 6), previousPosition: { ...previous, motionState: "stopped", gpsHdop: 1 }, motionState: "stopped",
        gpsHdop: 1, speed: 0, timestamp: t, now: t, stops, currentTripState: ride.tripState as "in_service",
        currentStopIndex: ride.currentStopIndex, hasDepartedOrigin: true, terminalArrival: ride.terminalArrival });
      previous = { ...at(592, 6), timestamp: t };
    }
    expect(ride.tripState).toBe("completed");
  });
});

describe("visitedStopIndex: the stop the bus is at right now", () => {
  const stops = [at(0), at(300), at(600)];
  const base = { motionState: "stopped" as const, gpsHdop: 1, stops, tripState: "in_service" as const };

  it("reports the origin while the ride has not departed it", () => {
    expect(visitedStopIndex({ ...base, ...at(5, 3), currentStopIndex: 0, hasDepartedOrigin: false })).toBe(0);
    expect(visitedStopIndex({ ...base, ...at(5, 3), tripState: "pre_departure", currentStopIndex: 0, hasDepartedOrigin: false })).toBe(0);
  });

  it("reports B while the bus dwells there after B was reached, and clears once it leaves", () => {
    expect(visitedStopIndex({ ...base, ...at(306, 5), currentStopIndex: 2, hasDepartedOrigin: true })).toBe(1);
    expect(visitedStopIndex({ ...base, ...at(340, 5), currentStopIndex: 2, hasDepartedOrigin: true })).toBeNull();
  });

  it("reports the terminal while its arrival is still being confirmed", () => {
    expect(visitedStopIndex({ ...base, ...at(596, 4), currentStopIndex: 2, hasDepartedOrigin: true })).toBe(2);
    expect(visitedStopIndex({ ...base, ...at(560, 4), currentStopIndex: 2, hasDepartedOrigin: true })).toBeNull();
  });

  it("never reports a stop that was passed unobserved, or anything from an untrusted fix", () => {
    expect(visitedStopIndex({ ...base, ...at(300, 3), currentStopIndex: 2, hasDepartedOrigin: true, unobservedStopIndices: [1] })).toBeNull();
    expect(visitedStopIndex({ ...base, ...at(300, 3), motionState: "uncertain", currentStopIndex: 2, hasDepartedOrigin: true })).toBeNull();
    expect(visitedStopIndex({ ...base, ...at(300, 3), gpsHdop: 9, currentStopIndex: 2, hasDepartedOrigin: true })).toBeNull();
    expect(visitedStopIndex({ ...base, ...at(300, 3), tripState: "completed", currentStopIndex: 2, hasDepartedOrigin: true })).toBe(2);
  });
});
