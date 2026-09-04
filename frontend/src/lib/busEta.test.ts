import { describe, expect, it } from "vitest";
import { busStopArrivalTimestamps } from "./busEta";

const A = { id: "a", lat: 23, lng: 72 };
const B = { id: "b", lat: 23.01, lng: 72 };
const Z = { id: "z", lat: 23.02, lng: 72 };
// A longer detour adds real path distance so a rerouted bus must yield a later
// ETA than a bus on the direct shared geometry.
const directPath = [A, B, Z];
const detourPath = [
  A,
  { lat: 23.005, lng: 72.015 },
  B,
  { lat: 23.015, lng: 72.015 },
  Z,
];

describe("busStopArrivalTimestamps", () => {
  const base = {
    busPoint: { lat: 23, lng: 72 },
    heading: 90,
    speedKmh: 30,
    delayMinutes: 0,
    now: 0,
  };

  it("orders stops along the bus's own path (earlier stop arrives first)", () => {
    const arrivals = busStopArrivalTimestamps({
      ...base,
      path: directPath,
      remainingStops: [B, Z],
    });
    expect(arrivals.b).toBeLessThan(arrivals.z);
  });

  it("honors each bus's own geometry so a rerouted bus does not reuse another bus's ETA", () => {
    const onDirect = busStopArrivalTimestamps({
      ...base,
      path: directPath,
      remainingStops: [Z],
    });
    const onDetour = busStopArrivalTimestamps({
      ...base,
      path: detourPath,
      remainingStops: [Z],
    });
    // Same origin, speed, and destination stop, but the detour path is longer:
    // the rerouted bus must have a later arrival than the bus on the straight
    // path. This proves the ETA is keyed to the bus that owns the geometry.
    expect(onDetour.z).toBeGreaterThan(onDirect.z);
  });

  it("shifts every matching arrival by exactly the configured delay", () => {
    const delayed = busStopArrivalTimestamps({
      ...base,
      delayMinutes: 2,
      path: directPath,
      remainingStops: [B, Z],
    });
    const undelayed = busStopArrivalTimestamps({
      ...base,
      delayMinutes: 0,
      path: directPath,
      remainingStops: [B, Z],
    });
    // Identical stops and path: delayMinutes must shift each matching stop by
    // exactly 120_000 ms, independent of distance or intermediate dwell time.
    expect(delayed.b).toBe(undelayed.b + 120_000);
    expect(delayed.z).toBe(undelayed.z + 120_000);
  });
});