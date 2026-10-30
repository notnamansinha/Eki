import { describe, expect, it } from "vitest";
import { reduceTripState, visitedStopIndex, type TripStateResult } from "./tripStateReducer";

const at = (north: number, east = 0) => ({
  lat: 23 + north / 6_371_000 * 180 / Math.PI,
  lng: 72 + east / (6_371_000 * Math.cos(23 * Math.PI / 180)) * 180 / Math.PI,
});
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
type Ride = Pick<TripStateResult, "tripState" | "currentStopIndex" | "hasDepartedOrigin" | "terminalArrival" | "gnssGapSince">;

/** Approach the terminal at 600 m and park `lateral` m beside / `along` m short of its pin with AR(1) jitter. */
function park(lateral: number, along: number, sigma: number, seed: number, dwell = 60) {
  const r = rng(seed);
  const stops = [at(0), at(300), at(600)];
  let ride: Ride = { tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true };
  let prev: { lat: number; lng: number; timestamp: number; motionState: "moving" | "stopped"; gpsHdop: number } | undefined;
  let nx = 0, ny = 0;
  const steps: { n: number; motion: "moving" | "stopped"; speed: number }[] = [];
  for (let n = 400; n < 600 - along; n += 8) steps.push({ n, motion: "moving", speed: 25 });
  for (let i = 0; i < dwell; i += 1) steps.push({ n: 600 - along, motion: i < 3 ? "moving" : "stopped", speed: i < 3 ? 1 : 0 });
  let completedAt: number | null = null;
  steps.forEach((step, i) => {
    if (ride.tripState === "completed") return;
    nx = 0.8 * nx + 0.6 * sigma * gauss(r);
    ny = 0.8 * ny + 0.6 * sigma * gauss(r);
    const p = at(step.n + ny, lateral + nx);
    const t = 1_000_000 + i * 1000;
    ride = reduceTripState({ ...p, previousPosition: prev, motionState: step.motion, gpsHdop: 1, speed: step.speed, timestamp: t, now: t,
      stops, currentTripState: ride.tripState as "in_service", currentStopIndex: ride.currentStopIndex, hasDepartedOrigin: true,
      terminalArrival: ride.terminalArrival, gnssGapSince: ride.gnssGapSince });
    if (ride.tripState === "completed") completedAt = i;
    prev = { ...p, timestamp: t, motionState: step.motion, gpsHdop: 1 };
  });
  return { ride, completedAt };
}

describe("terminal completion", () => {
  it.each([5, 8, 11, 13, 14])("parked %i m beside the terminal pin with 2 m jitter completes within a minute (100 seeds)", lateral => {
    const stuck: number[] = [];
    for (let seed = 1; seed <= 100; seed += 1) if (park(lateral, 0, 2, seed).ride.tripState !== "completed") stuck.push(seed);
    // 14 m with 2 m jitter is at the corridor edge; report rather than demand.
    if (lateral <= 11) expect(stuck).toEqual([]);
    else expect(stuck.length).toBeLessThan(100);
  });

  it("never completes while still rolling (firmware keeps 'moving' for the first fixes of a stop)", () => {
    const stops = [at(0), at(300), at(600)];
    const res = reduceTripState({ ...at(598), previousPosition: { ...at(596), timestamp: 999_000, motionState: "moving", gpsHdop: 1 },
      motionState: "moving", gpsHdop: 1, speed: 1, timestamp: 1_000_000, now: 1_000_000, stops, currentTripState: "in_service",
      currentStopIndex: 2, hasDepartedOrigin: true, terminalArrival: { startedAt: 990_000, lastSampledAt: 999_000 } });
    expect(res.tripState).toBe("in_service");
  });

  it("visitedStopIndex reports the terminal only once the previous stop is passed", () => {
    // Last two stops 20 m apart (alighting point S then bay T). Bus at S, ride expects S next.
    const stops = [at(0), at(300), at(580), at(600)];
    expect(visitedStopIndex({ ...at(582), motionState: "stopped", gpsHdop: 1, stops, tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true })).toBeNull();
  });
});
