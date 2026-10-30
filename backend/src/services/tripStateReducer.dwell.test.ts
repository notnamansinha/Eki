import { describe, expect, it } from "vitest";
import { reduceTripState } from "./tripStateReducer";

// How often does an ordinary dwell at the last stop before an out-and-back
// turnaround trigger a false "unobserved" jump to the return copy?
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

/** Bus arrives at B (index 1) on the outbound kerb lane and dwells `dwell` seconds with AR(1) noise. */
function dwellJumps(returnCopyEast: number, sigma: number, rho: number, dwell: number, seed: number) {
  const r = rng(seed);
  const stops = [at(0, -8), at(300, -8), at(600, -8), at(300, returnCopyEast), at(0, returnCopyEast)];
  let index = 1;
  let prev: { lat: number; lng: number; timestamp: number; motionState: "moving" | "stopped"; gpsHdop: number } | undefined;
  let nx = 0, ny = 0;
  const k = Math.sqrt(1 - rho * rho) * sigma;
  const path: { n: number; motion: "moving" | "stopped"; speed: number }[] = [];
  for (let n = 220; n < 300; n += 8) path.push({ n, motion: "moving", speed: 25 });
  // Firmware hysteresis: the first ~3 dwell fixes still read "moving".
  for (let i = 0; i < dwell; i += 1) path.push({ n: 300, motion: i < 3 ? "moving" : "stopped", speed: 0 });
  for (const [i, step] of path.entries()) {
    nx = rho * nx + k * gauss(r);
    ny = rho * ny + k * gauss(r);
    const p = at(step.n + ny, -6 + nx);
    const t = 1_000_000 + i * 1000;
    const res = reduceTripState({ ...p, previousPosition: prev, motionState: step.motion, gpsHdop: 1, speed: step.speed,
      timestamp: t, now: t, stops, currentTripState: "in_service", currentStopIndex: index, hasDepartedOrigin: true });
    index = res.currentStopIndex;
    prev = { ...p, timestamp: t, motionState: step.motion, gpsHdop: 1 };
  }
  return index > 2;
}

describe("dwell jitter at an out-and-back stop", () => {
  it.each([
    { label: "shared pole, sigma 1 m smooth", east: -8, sigma: 1, rho: 0.9 },
    { label: "shared pole, sigma 2 m", east: -8, sigma: 2, rho: 0.8 },
    { label: "across a 4-lane divided road (16 m), sigma 1 m smooth", east: 8, sigma: 1, rho: 0.9 },
    { label: "across a 4-lane divided road (16 m), sigma 2 m", east: 8, sigma: 2, rho: 0.8 },
  ])("$label: 30 s dwell never jumps past the turnaround", ({ east, sigma, rho }) => {
    let jumps = 0;
    const runs = 300;
    for (let seed = 1; seed <= runs; seed += 1) if (dwellJumps(east, sigma, rho, 30, seed)) jumps += 1;
    expect(`${jumps}/${runs} dwells jumped`).toBe(`0/${runs} dwells jumped`);
  });
});
