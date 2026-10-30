import { describe, expect, it } from "vitest";
import { reduceTripState, visitedStopIndex } from "./tripStateReducer";

const at = (north: number, east = 0) => ({
  lat: 23 + north / 6_371_000 * 180 / Math.PI,
  lng: 72 + east / (6_371_000 * Math.cos(23 * Math.PI / 180)) * 180 / Math.PI,
});

function timeIt(fn: () => void, runs: number) {
  for (let i = 0; i < 20; i += 1) fn();
  const start = performance.now();
  for (let i = 0; i < runs; i += 1) fn();
  return (performance.now() - start) / runs;
}

describe("reducer cost on long routes", () => {
  it.each([100, 200, 400])("out-and-back with %i stops (all return copies shared), open GNSS gap, bus dwelling at the turnaround", n => {
    const half = n / 2;
    const out = Array.from({ length: half }, (_, i) => at(i * 200));
    const stops = [...out, ...out.slice(0, -1).reverse()];
    // Ride is near the end of the outbound leg, gap open long enough that every revisit check runs.
    const cases = [
      // gap path, bus at a passed stop (re-anchor + revisit loops over every later stop)
      () => reduceTripState({ ...at((half - 3) * 200, 2), motionState: "stopped", gpsHdop: 1, speed: 0, timestamp: 2_000_000, now: 2_000_000,
        stops, currentTripState: "in_service", currentStopIndex: half - 2, hasDepartedOrigin: true, gnssGapSince: 1_990_000 }),
      // no-gap path with previous fix
      () => reduceTripState({ ...at((half - 3) * 200 - 4, 2), previousPosition: { ...at((half - 3) * 200 + 4, 2), timestamp: 1_999_000, motionState: "moving", gpsHdop: 1 },
        motionState: "moving", gpsHdop: 1, speed: 10, timestamp: 2_000_000, now: 2_000_000,
        stops, currentTripState: "in_service", currentStopIndex: half - 2, hasDepartedOrigin: true }),
      // gap path from very early in the route, far from everything
      () => reduceTripState({ ...at(50, 300), motionState: "moving", gpsHdop: 1, speed: 10, timestamp: 2_000_000, now: 2_000_000,
        stops, currentTripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true, gnssGapSince: 1_000_000 }),
      () => visitedStopIndex({ ...at(100, 2), motionState: "stopped", gpsHdop: 1, stops, tripState: "in_service", currentStopIndex: n - 2,
        hasDepartedOrigin: true, unobservedStopIndices: Array.from({ length: n - 3 }, (_, i) => i) }),
    ];
    const ms = cases.map(fn => timeIt(fn, 200));
    // Worst case: every stop co-located (a depot shuttle that circles one block with many duplicated pins).
    const piled = Array.from({ length: n }, (_, i) => at((i % 3) * 5, 0));
    const pileMs = timeIt(() => reduceTripState({ ...at(0, 40), motionState: "moving", gpsHdop: 1, speed: 10, timestamp: 2_000_000, now: 2_000_000,
      stops: piled, currentTripState: "in_service", currentStopIndex: Math.floor(n / 2), hasDepartedOrigin: true, gnssGapSince: 1_999_990 }), 20);
    const pileStillMs = timeIt(() => reduceTripState({ ...at(0, 1), motionState: "stopped", gpsHdop: 1, speed: 0, timestamp: 2_000_000, now: 2_000_000,
      stops: piled, currentTripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true, gnssGapSince: 1_999_000 }), 20);
    expect({ n, ms: ms.map(v => +v.toFixed(3)), pileMs: +pileMs.toFixed(3), pileStillMs: +pileStillMs.toFixed(3) })
      .toEqual({ n, ms: ms.map(v => +v.toFixed(3)), pileMs: +pileMs.toFixed(3), pileStillMs: +pileStillMs.toFixed(3) });
    for (const v of [...ms, pileMs, pileStillMs]) expect(v, `n=${n} ms=${ms} pile=${pileMs} pileStill=${pileStillMs}`).toBeLessThan(10);
  });
});
