import { describe, expect, it } from "vitest";
import { reduceTripState, type TripStateResult, type TerminalArrivalEvidence } from "./tripStateReducer";

// ---- local planar geometry -------------------------------------------------
const R = 6_371_000;
const LAT0 = 23.0;
const LNG0 = 72.5;
const toLL = (x: number, y: number) => ({
  lat: LAT0 + (y / R) * (180 / Math.PI),
  lng: LNG0 + (x / (R * Math.cos((LAT0 * Math.PI) / 180))) * (180 / Math.PI),
});
type P = { x: number; y: number };

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

interface Fix {
  p: P;
  t: number;
  motion: "moving" | "stopped" | "uncertain";
  hdop: number | null;
  speed: number;
}

interface SimState {
  tripState: "pre_departure" | "in_service" | "completed";
  currentStopIndex: number;
  hasDepartedOrigin: boolean;
  terminalArrival: TerminalArrivalEvidence | null;
  gnssGapSince: number | null;
}

/** Mirrors tripStateEngine.processLiveSnapshot carry-forward of reducer state. */
function simulate(stops: P[], fixes: Fix[], onStep?: (before: SimState, after: TripStateResult, fix: Fix, prev?: Fix) => void) {
  const stopsLL = stops.map(s => toLL(s.x, s.y));
  let state: SimState = { tripState: "pre_departure", currentStopIndex: 0, hasDepartedOrigin: false, terminalArrival: null, gnssGapSince: null };
  let prev: Fix | undefined;
  for (const fix of fixes) {
    if (state.tripState === "completed") break;
    if (prev && !(fix.t > prev.t)) continue; // engine: isNewTelemetry
    const ll = toLL(fix.p.x, fix.p.y);
    const result = reduceTripState({
      ...ll,
      previousPosition: prev ? { ...toLL(prev.p.x, prev.p.y), motionState: prev.motion, gpsHdop: prev.hdop, timestamp: prev.t } : undefined,
      motionState: fix.motion,
      currentTripState: state.tripState,
      currentStopIndex: state.currentStopIndex,
      stops: stopsLL,
      hasDepartedOrigin: state.hasDepartedOrigin,
      terminalArrival: state.terminalArrival,
      gnssGapSince: state.gnssGapSince ?? (!prev && state.tripState === "in_service" ? fix.t : null),
      timestamp: fix.t,
      now: fix.t,
      gpsHdop: fix.hdop,
      speed: fix.speed,
    });
    onStep?.(state, result, fix, prev);
    state = {
      tripState: result.tripState as SimState["tripState"],
      currentStopIndex: result.currentStopIndex,
      hasDepartedOrigin: result.hasDepartedOrigin,
      terminalArrival: result.terminalArrival ?? null,
      gnssGapSince: result.gnssGapSince ?? null,
    };
    prev = fix;
  }
  return state;
}

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
function segDist(p: P, a: P, b: P) {
  const dx = b.x - a.x, dy = b.y - a.y; const l = dx * dx + dy * dy;
  if (l === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Ideal drive: dwell at origin, then 1 Hz fixes along the polyline with a fix exactly at each stop. */
function idealDrive(stops: P[], r: () => number, t0 = 1_000_000) {
  const fixes: Fix[] = [];
  let t = t0;
  for (let i = 0; i < 3; i += 1) fixes.push({ p: stops[0], t: (t += 1000), motion: "stopped", hdop: 1, speed: 0 });
  for (let i = 1; i < stops.length; i += 1) {
    const a = stops[i - 1], b = stops[i];
    const len = dist(a, b);
    const step = 3 + r() * 9;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k += 1) {
      const f = k / n;
      const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      fixes.push({ p, t: (t += 1000), motion: "moving", hdop: 1, speed: 20 });
    }
  }
  const last = stops.at(-1)!;
  for (let i = 0; i < 6; i += 1) fixes.push({ p: last, t: (t += 1000), motion: "stopped", hdop: 1, speed: 0 });
  return fixes;
}

function randomRoute(r: () => number): P[] {
  const kind = r();
  const n = kind < 0.15 ? 2 : 2 + Math.floor(r() * 6);
  const pts: P[] = [{ x: 0, y: 0 }];
  let heading = r() * Math.PI * 2;
  for (let i = 1; i < n; i += 1) {
    heading += (r() - 0.5) * Math.PI;
    const len = r() < 0.2 ? 15 + r() * 20 : 60 + r() * 400;
    const p = pts.at(-1)!;
    pts.push({ x: p.x + Math.cos(heading) * len, y: p.y + Math.sin(heading) * len });
  }
  if (kind > 0.8 && n >= 3) pts.push({ ...pts[0] }); // loop route: first == last stop
  return pts;
}

describe("reduceTripState invariants under seeded random fix sequences", () => {
  it("ideal drives on random routes (incl. loops, 2-stop) always complete with every stop observed in order", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 400; seed += 1) {
      const r = rng(seed);
      const stops = randomRoute(r);
      const end = simulate(stops, idealDrive(stops, r));
      if (end.tripState !== "completed") failures.push(`seed ${seed} stops=${stops.length} -> ${JSON.stringify(end)}`);
    }
    expect(failures).toEqual([]);
  });

  it("perturbed drives preserve monotonic order, gap-only skipping, and GNSS-loss neutrality", () => {
    const violations: string[] = [];
    for (let seed = 1; seed <= 400; seed += 1) {
      const r = rng(seed * 7919);
      const stops = randomRoute(r);
      const base = idealDrive(stops, r);
      const fixes: Fix[] = [];
      for (const fix of base) {
        const roll = r();
        if (roll < 0.05) fixes.push({ ...fix, motion: "uncertain" });
        else if (roll < 0.1) fixes.push({ ...fix, hdop: 9 });
        else if (roll < 0.13) { fixes.push(fix); fixes.push({ ...fix }); } // duplicate
        else if (roll < 0.16 && fixes.length) { const last = fixes.pop()!; fixes.push(fix, last); } // reorder
        else fixes.push(fix);
      }
      simulate(stops, fixes, (before, after, fix, prev) => {
        const ctx = `seed ${seed} t=${fix.t} ${JSON.stringify(before)} -> ${JSON.stringify(after)}`;
        if (after.currentStopIndex < before.currentStopIndex) violations.push(`index regressed ${ctx}`);
        if (after.currentStopIndex > stops.length - 1) violations.push(`index beyond last ${ctx}`);
        const unreliable = fix.motion === "uncertain" || (fix.hdop !== null && fix.hdop > 4);
        if (unreliable && (after.tripState !== before.tripState || after.currentStopIndex !== before.currentStopIndex ||
          after.hasDepartedOrigin !== before.hasDepartedOrigin)) violations.push(`GNSS loss changed ride truth ${ctx}`);
        if (before.tripState === "pre_departure" && after.tripState === "completed") violations.push(`pre_departure->completed ${ctx}`);
        if (before.tripState === "pre_departure" && after.tripState === "in_service" && fix.motion !== "moving") violations.push(`activation without movement ${ctx}`);
        if (after.tripState === "completed" && dist(fix.p, stops.at(-1)!) > 2.6) violations.push(`completed away from terminal ${ctx}`);
        if (after.skippedStopIndices && before.gnssGapSince === null && prev) violations.push(`skip without gap ${ctx}`);
        if (!after.skippedStopIndices && after.currentStopIndex > before.currentStopIndex && before.tripState === "in_service") {
          for (let i = Math.max(1, before.currentStopIndex); i < after.currentStopIndex; i += 1) {
            const reached = dist(fix.p, stops[i]) <= 2.6 || (prev ? segDist(stops[i], prev.p, fix.p) <= 2.6 : false);
            if (!reached) violations.push(`stop ${i} consumed without observation ${ctx}`);
          }
        }
      });
    }
    expect(violations.slice(0, 10)).toEqual([]);
  });
  it("drives whose GNSS blacks out over random stretches of loop and out-and-back routes still complete", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 400; seed += 1) {
      const r = rng(seed * 104_729);
      let stops = randomRoute(r);
      const outAndBack = r() < 0.4 && stops.length >= 3 && dist(stops[0], stops.at(-1)!) > 0;
      if (outAndBack) stops = [...stops, ...stops.slice(0, -1).reverse()]; // shared stops on the way back
      const fixes = idealDrive(stops, r);
      // Drop a contiguous run of moving fixes (at least 11 s, so a real gap opens) once the bus has
      // been seen clear of the origin, ending while it is still seen driving into the terminal.
      const departed = fixes.findIndex(fix => dist(fix.p, stops[0]) > 160);
      const lastMoving = fixes.length - 7 - 5;
      if (departed < 0) continue;
      const span = Math.min(lastMoving - departed - 1, 11 + Math.floor(r() * 120));
      if (span < 11) continue;
      const start = departed + 1 + Math.floor(r() * (lastMoving - departed - span));
      const kept = [...fixes.slice(0, start), ...fixes.slice(start + span)];
      const end = simulate(stops, kept);
      if (end.tripState !== "completed") failures.push(`seed ${seed} stops=${stops.length} hidden=${start}+${span} -> ${JSON.stringify(end)}`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("a bus dwelling at a passed stop that the route revisits never advances, whatever the gap and jitter", () => {
    const violations: string[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const r = rng(seed * 15_485_863);
      const out = randomRoute(r).filter((_, i, all) => i === 0 || all[i].x !== all[0].x || all[i].y !== all[0].y);
      if (out.length < 3) continue;
      const stops = [...out, ...out.slice(0, -1).reverse()];
      const passed = 1 + Math.floor(r() * (out.length - 2)); // dwelling at stops[passed], next expected passed + 1
      const at = stops[passed];
      let state: SimState = { tripState: "in_service", currentStopIndex: passed + 1, hasDepartedOrigin: true,
        terminalArrival: null, gnssGapSince: 1_000_000 };
      let prev: Fix | undefined = r() < 0.5 ? undefined : { p: at, t: 1_000_000, motion: "stopped", hdop: 1, speed: 0 };
      const amplitude = r() * 6;
      for (let i = 1; i <= 900; i += 1) {
        const roll = r();
        const fix: Fix = { p: { x: at.x + (r() - 0.5) * 2 * amplitude, y: at.y + (r() - 0.5) * 2 * amplitude },
          t: 1_000_000 + i * 1000, motion: roll < 0.05 ? "uncertain" : "stopped", hdop: roll > 0.97 ? 9 : 1, speed: 0 };
        const stopsLL = stops.map(s => toLL(s.x, s.y));
        const result = reduceTripState({ ...toLL(fix.p.x, fix.p.y), motionState: fix.motion, gpsHdop: fix.hdop, speed: 0,
          previousPosition: prev && { ...toLL(prev.p.x, prev.p.y), motionState: prev.motion, gpsHdop: prev.hdop, timestamp: prev.t },
          currentTripState: state.tripState, currentStopIndex: state.currentStopIndex, stops: stopsLL,
          hasDepartedOrigin: true, terminalArrival: state.terminalArrival, gnssGapSince: state.gnssGapSince, timestamp: fix.t, now: fix.t });
        if (result.currentStopIndex !== passed + 1 || result.tripState !== "in_service") {
          violations.push(`seed ${seed} passed=${passed} t=${fix.t} -> ${JSON.stringify(result)}`);
          break;
        }
        state = { ...state, terminalArrival: result.terminalArrival ?? null, gnssGapSince: result.gnssGapSince ?? null };
        prev = fix;
      }
    }
    expect(violations.slice(0, 10)).toEqual([]);
  });
});
