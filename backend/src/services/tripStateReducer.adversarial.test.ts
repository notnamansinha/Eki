import { describe, expect, it } from "vitest";
import { reduceTripState, type TripStateResult } from "./tripStateReducer";

// Local metres -> lat/lng around (23, 72), same helper as the field-ride tests.
const at = (north: number, east = 0) => ({
  lat: 23 + north / 6_371_000 * 180 / Math.PI,
  lng: 72 + east / (6_371_000 * Math.cos(23 * Math.PI / 180)) * 180 / Math.PI,
});
type Ride = Pick<TripStateResult, "tripState" | "currentStopIndex" | "hasDepartedOrigin" | "terminalArrival" | "gnssGapSince">;

/** Carries reducer state forward like the engine does, 1 Hz reliable fixes. */
function run(stops: { lat: number; lng: number }[], fixes: { p: [number, number]; motion: "moving" | "stopped" }[],
  start: Ride, t0 = 5_000_000) {
  let ride: Ride = start;
  let prev: { lat: number; lng: number; timestamp: number; motionState: "moving" | "stopped"; gpsHdop: number } | undefined;
  const unobserved: number[] = [];
  const skipped: number[] = [];
  const trace: string[] = [];
  fixes.forEach((fix, i) => {
    const t = t0 + i * 1000;
    const position = at(...fix.p);
    const r = reduceTripState({ ...position, previousPosition: prev, motionState: fix.motion, gpsHdop: 1,
      speed: fix.motion === "moving" ? 20 : 0, timestamp: t, now: t, stops,
      currentTripState: ride.tripState as "in_service", currentStopIndex: ride.currentStopIndex,
      hasDepartedOrigin: ride.hasDepartedOrigin, terminalArrival: ride.terminalArrival, gnssGapSince: ride.gnssGapSince });
    unobserved.push(...(r.unobservedStopIndices ?? []));
    skipped.push(...(r.skippedStopIndices ?? []));
    trace.push(`${i} ${fix.p.join(",")} ${fix.motion} -> ${r.tripState}#${r.currentStopIndex}${r.unobservedStopIndices ? " unobs" + r.unobservedStopIndices : ""}`);
    ride = r;
    prev = { ...position, timestamp: t, motionState: fix.motion, gpsHdop: 1 };
  });
  return { ride, unobserved, skipped, trace };
}

describe("no-gap unobserved recovery", () => {
  it("D1 out-and-back: GPS jitter while dwelling at B (passed) must not jump to the return copy B'", () => {
    // A, B, C (turnaround), B' (same pole as B), A'. Bus reached B, next expected C.
    const stops = [at(0), at(300), at(600), at(300), at(0)];
    // Two consecutive parked fixes at B, the second 4 m south of the first (urban multipath jitter).
    const result = reduceTripState({ ...at(298, 2), previousPosition: { ...at(302, 2), timestamp: 999_000, motionState: "stopped", gpsHdop: 1 },
      motionState: "stopped", gpsHdop: 1, speed: 0, timestamp: 1_000_000, now: 1_000_000, stops,
      currentTripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true });
    expect(result.currentStopIndex).toBe(2);
    expect(result.unobservedStopIndices).toBeUndefined();
  });

  it("D1b spur: jitter at the junction stop B while dwelling credits the spur's return copy and the turnaround as passed", () => {
    // A -> B (north), spur east to C and back to B', then on north to D.
    const stops = [at(0), at(300), at(300, 250), at(300, 5), at(600)];
    const { ride, unobserved } = run(stops, [
      { p: [301, 2], motion: "stopped" },
      { p: [300, -2], motion: "stopped" }, // 4 m west jitter: matches the C->B' leg, not A->B or B->C
    ], { tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true });
    expect(unobserved).toEqual([]);
    expect(ride.currentStopIndex).toBe(2);
  });

  it("D2 small loop: bus that 'departed' while driving in to the stand completes the trip on arrival at the origin", () => {
    // Loop A -> B -> C -> A'. A' shares A's pin. The driver starts the shift in the depot 250 m north of A,
    // drives down to the stand (approaching from C's side), and parks for boarding.
    const stops = [at(0), at(0, 300), at(300, 150), at(0)];
    const fixes: { p: [number, number]; motion: "moving" | "stopped" }[] = [];
    for (let n = 250; n >= 4; n -= 8) fixes.push({ p: [n, n / 2], motion: "moving" });
    for (let i = 0; i < 6; i += 1) fixes.push({ p: [2, 1], motion: "stopped" });
    const { ride, unobserved, trace } = run(stops, fixes, { tripState: "pre_departure", currentStopIndex: 0, hasDepartedOrigin: false });
    // Nobody has been carried anywhere yet: B and C were never visited.
    expect({ state: ride.tripState, unobserved }, trace.slice(-12).join("\n")).toEqual({ state: "in_service", unobserved: [] });
  });

  it("D2b small loop: bus departs, goes round the block back past the stand, and the ride completes at the origin", () => {
    // Bus leaves eastward toward B, turns left twice round a 60 m block and comes back down to A from the north.
    const stops = [at(0), at(0, 300), at(300, 150), at(0)];
    const path: [number, number][] = [];
    for (let e = 0; e <= 60; e += 6) path.push([0, e]);       // east toward B, departs at 50 m
    for (let n = 6; n <= 60; n += 6) path.push([n, 60]);      // north
    for (let e = 54; e >= 0; e -= 6) path.push([60, e]);      // west
    for (let n = 54; n >= 2; n -= 6) path.push([n, 0]);       // south, back to the stand
    const fixes = [
      ...path.map(p => ({ p, motion: "moving" as const })),
      ...Array.from({ length: 6 }, () => ({ p: [2, 0] as [number, number], motion: "stopped" as const })),
    ];
    const { ride, unobserved, trace } = run(stops, fixes, { tripState: "pre_departure", currentStopIndex: 0, hasDepartedOrigin: false });
    expect({ state: ride.tripState, unobserved }, trace.join("\n")).toEqual({ state: "in_service", unobserved: [] });
  });
});

describe("GNSS-gap path with the 15 m corridor", () => {
  // Out-and-back on a divided road. Outbound stops on the east kerb (x=+8), return stops on the west
  // kerb (x=-8), staggered 50 m from their outbound counterparts as far-side/near-side stops usually are.
  // Outbound bus drives the inner lane at x=+4 (12 m from the far kerb).
  const stops = [at(0, 8), at(300, 8), at(600, 8), at(900, 8), at(650, -8), at(350, -8), at(50, -8)];

  it("D3 first fix after a backend restart (gap opened, no previous fix): outbound bus credits the opposite carriageway's stop", () => {
    // Engine: gnssGapSince = telemetryTimestamp when no prior fix is cached for an in-service ride.
    const t = 2_000_000;
    const result = reduceTripState({ ...at(350, 4), motionState: "moving", gpsHdop: 1, speed: 30, timestamp: t, now: t, stops,
      currentTripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true, gnssGapSince: t });
    // Truth: northbound between B and C. Nothing after B has been passed.
    expect(result.currentStopIndex).toBe(2);
    expect(result.skippedStopIndices).toBeUndefined();
  });

  it("D3b after a 12 s radio dropout the northbound bus jumps to the southbound B' and skips the turnaround", () => {
    const prev = { ...at(250, 4), timestamp: 1_988_000, motionState: "moving" as const, gpsHdop: 1 };
    const result = reduceTripState({ ...at(352, 4), previousPosition: prev, motionState: "moving", gpsHdop: 1, speed: 30,
      timestamp: 2_000_000, now: 2_000_000, stops, currentTripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true });
    expect(result.currentStopIndex).toBe(2);
  });

  it("D3c one HDOP>4 fix then a good fix on the outbound carriageway skips the turnaround", () => {
    let ride: Ride = { tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true };
    const seq = [
      { n: 330, hdop: 1 }, { n: 338, hdop: 6 }, { n: 346, hdop: 1 }, { n: 354, hdop: 1 },
    ];
    let prev: { lat: number; lng: number; timestamp: number; motionState: "moving"; gpsHdop: number } | undefined;
    seq.forEach((s, i) => {
      const t = 3_000_000 + i * 1000;
      ride = reduceTripState({ ...at(s.n, 4), previousPosition: prev, motionState: "moving", gpsHdop: s.hdop, speed: 30,
        timestamp: t, now: t, stops, currentTripState: "in_service", currentStopIndex: ride.currentStopIndex,
        hasDepartedOrigin: true, gnssGapSince: ride.gnssGapSince });
      prev = { ...at(s.n, 4), timestamp: t, motionState: "moving", gpsHdop: s.hdop };
    });
    expect(ride.currentStopIndex).toBe(2);
  });

  it("D3d one HDOP>4 fix while parked at the origin, then the trip completes at the first red light after departure", () => {
    // Out-and-back on a divided road. Origin A on the west kerb; the return terminal A' on the east kerb 120 m
    // further north (staggered terminus). Outbound lane x=-4.5 passes 13 m from A'.
    const route = [at(0, -8.5), at(400, -8.5), at(800, -8.5), at(400, 8.5), at(120, 8.5)];
    const fixes: { n: number; e: number; motion: "moving" | "stopped"; hdop: number; speed: number }[] = [];
    for (let i = 0; i < 5; i += 1) fixes.push({ n: 0, e: -6, motion: "stopped", hdop: i === 2 ? 6 : 1, speed: 0 }); // bus-stand roof
    for (let n = 10; n <= 118; n += 9) fixes.push({ n, e: -4.5, motion: "moving", hdop: 1, speed: 30 });
    for (let i = 0; i < 6; i += 1) fixes.push({ n: 120, e: -4.5, motion: "stopped", hdop: 1, speed: 0 }); // red light
    let ride: Ride = { tripState: "pre_departure", currentStopIndex: 0, hasDepartedOrigin: false };
    let prev: { lat: number; lng: number; timestamp: number; motionState: "moving" | "stopped"; gpsHdop: number } | undefined;
    const trace: string[] = [];
    fixes.forEach((f, i) => {
      const t = 4_000_000 + i * 1000;
      ride = reduceTripState({ ...at(f.n, f.e), previousPosition: prev, motionState: f.motion, gpsHdop: f.hdop, speed: f.speed,
        timestamp: t, now: t, stops: route, currentTripState: ride.tripState as "in_service", currentStopIndex: ride.currentStopIndex,
        hasDepartedOrigin: ride.hasDepartedOrigin, terminalArrival: ride.terminalArrival, gnssGapSince: ride.gnssGapSince });
      trace.push(`${f.n},${f.e} ${f.motion} hdop${f.hdop} -> ${ride.tripState}#${ride.currentStopIndex} gap=${ride.gnssGapSince ?? "-"}`);
      prev = { ...at(f.n, f.e), timestamp: t, motionState: f.motion, gpsHdop: f.hdop };
    });
    // Truth: 120 m into an 1800 m ride, before the first intermediate stop.
    expect(ride.tripState, trace.join("\n")).toBe("in_service");
    expect(ride.currentStopIndex).toBe(1);
  });
});

describe("ordered consumption on the wrong carriageway", () => {
  it("D4 first return stop beyond the last outbound stop is credited from the outbound carriageway before the U-turn", () => {
    // Divided road, U-turn at 750 m. Outbound west kerb (x=-8), return east kerb (x=+8).
    // C' is the first return stop, 50 m past C. Outbound bus lane x=-4.5 passes 12.5 m from it.
    const stops = [at(0, -8), at(300, -8), at(600, -8), at(650, 8), at(300, 8), at(0, 8)];
    const fixes: { p: [number, number]; motion: "moving" | "stopped" }[] = [];
    for (let n = 610; n <= 740; n += 8) fixes.push({ p: [n, -4.5], motion: "moving" });
    const { ride, trace } = run(stops, fixes, { tripState: "in_service", currentStopIndex: 3, hasDepartedOrigin: true });
    // The bus is still northbound on the outbound carriageway, 90 m before the U-turn: C' is ~190 m of driving away.
    expect(ride.currentStopIndex, trace.join("\n")).toBe(3);
  });

  it("D1c divided road, stops directly across (17 m apart): parked jitter at B credits the turnaround as passed", () => {
    // A, B, T (turnaround), B' across the road from B, A'. Bus dwells at B's kerb (x=-6), 14 m from B'.
    const stops = [at(0, -8.5), at(300, -8.5), at(600, -8.5), at(300, 8), at(0, 8)];
    const { ride, unobserved } = run(stops, [
      { p: [301, -6], motion: "stopped" },
      { p: [297, -6.5], motion: "stopped" },
    ], { tripState: "in_service", currentStopIndex: 2, hasDepartedOrigin: true });
    expect({ index: ride.currentStopIndex, unobserved }).toEqual({ index: 2, unobserved: [] });
  });
});
