import { beforeEach, expect, it, vi } from "vitest";
import { encodePolyline } from "../lib/polylineUtils";
import type { TelemetryPayload } from "./telemetryPayload";

// Same in-memory Firebase harness as liveRouting.integration.test.ts.
const state = vi.hoisted(() => ({
  values: new Map<string, Record<string, unknown>>(),
  route: {} as Record<string, unknown>,
  compute: vi.fn(),
}));
vi.mock("../lib/firebaseAdmin", () => ({
  db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => state.route }) }) }) },
  rtdb: { ref: (path: string) => ({
    once: async () => ({ val: () => state.values.get(path) ?? null }),
    set: async (value: Record<string, unknown>) => { state.values.set(path, value); },
    transaction: async (update: (value: unknown) => Record<string, unknown> | undefined) => {
      const value = update(state.values.get(path) ?? null);
      if (value !== undefined) state.values.set(path, value);
      return { committed: value !== undefined, snapshot: { val: () => state.values.get(path) ?? null } };
    },
  }) },
}));
vi.mock("../lib/googleMaps", () => ({ LIVE_REROUTE_TIMEOUT_MS: 3500, computeRouteGeometry: (...args: unknown[]) => state.compute(...args) }));

import { drainTelemetryRouteProcessing, invalidateTelemetryRoute, scheduleTelemetryRouteProcessing } from "./telemetryRouteService";

const assignment = { busId: "bus", routeId: "straight" };
const key = "activeBuses/bus_straight";
// A straight eastbound road with a stop/vertex roughly every 10 m.
const stops = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, lat: 23, lng: 72 + i / 10_000 }));
const metersPerLng = 6_371_000 * Math.cos(23 * Math.PI / 180) * Math.PI / 180;

function publish(fix: TelemetryPayload) {
  state.values.set(key, { ...state.values.get(key), ...fix });
  scheduleTelemetryRouteProcessing(assignment, fix);
}

beforeEach(() => {
  state.values.clear(); state.compute.mockReset();
  state.compute.mockRejectedValue(new Error("mock provider outage"));
  state.route = { stops, forwardPolyline: encodePolyline(stops), reversePolyline: encodePolyline([...stops].reverse()), geometryVersion: 1 };
  state.values.set(key, { ...assignment, sessionId: "s1", driverId: "driver", status: "active", tripState: "in_service",
    direction: "forward", directionState: "resolved", directionFirestoreSynced: true, currentStopIndex: 50 });
  invalidateTelemetryRoute(assignment.routeId);
});

it("after a 40 s GNSS gap a decelerating bus on a straight road stays matched and is not rerouted", async () => {
  const now = Date.now();
  const base = { heading: 90, gpsHdop: 1, motionState: "moving" as const, deviceSentAt: now };
  publish({ ...base, seq: 1, timestamp: now - 40_000, lat: 23, lng: 72.01, speed: 30 });
  await drainTelemetryRouteProcessing();
  expect(state.values.get(key)?.matchedLocation).toMatchObject({ seq: 1 });
  const before = Number((state.values.get(key)!.matchedLocation as { alongRouteDistanceM: number }).alongRouteDistanceM);

  // Averaged 30 km/h through the 40 s gap (333 m), now slowing at 10 km/h, 2 m GNSS lateral offset.
  publish({ ...base, seq: 2, timestamp: now, lat: 23 + 2 / 111_195, lng: 72.01 + 333 / metersPerLng, speed: 10 });
  await drainTelemetryRouteProcessing();
  const live = state.values.get(key)!;
  expect({ routeState: live.routeState, distanceToActiveRoute: live.distanceToActiveRoute,
    along: (live.matchedLocation as { alongRouteDistanceM?: number } | null)?.alongRouteDistanceM ?? null })
    .toEqual({ routeState: "ON_ROUTE", distanceToActiveRoute: 2, along: before + 333 });
});

// The bus brakes between fixes: the previous match was fast, the current fix is stationary.
async function brakesPastUTurn(priorX: number, priorSpeed: number, elapsedMs: number, pastTip: number) {
  // Out-and-back divided road: east 200 m, 15 m across the turnaround, back west.
  const metersPerLat = 111_195;
  const at = (x: number, y: number) => ({ lat: 23 + y / metersPerLat, lng: 72 + x / metersPerLng });
  const loop = [...Array.from({ length: 21 }, (_, i) => at(i * 10, 0)), at(200, 15),
    ...Array.from({ length: 20 }, (_, i) => at(190 - i * 10, 15))].map((point, i) => ({ id: `u${i}`, ...point }));
  state.route = { stops: loop, forwardPolyline: encodePolyline(loop), reversePolyline: encodePolyline([...loop].reverse()), geometryVersion: 1 };
  invalidateTelemetryRoute(assignment.routeId);
  const now = Date.now();
  const base = { gpsHdop: 1, deviceSentAt: now };
  publish({ ...base, seq: 1, timestamp: now - elapsedMs, ...at(priorX, 0), speed: priorSpeed, heading: 90, motionState: "moving" });
  await drainTelemetryRouteProcessing();
  expect(state.values.get(key)?.matchedLocation).toMatchObject({ seq: 1, speed: priorSpeed });

  publish({ ...base, seq: 2, timestamp: now, ...at(200 - pastTip, 15), speed: 0, heading: 270, motionState: "stopped" });
  await drainTelemetryRouteProcessing();
  const live = state.values.get(key)!;
  const along = (live.matchedLocation as { alongRouteDistanceM?: number } | null)?.alongRouteDistanceM ?? NaN;
  expect(live.routeState).toBe("ON_ROUTE");
  expect(Math.abs(along - (215 + pastTip))).toBeLessThanOrEqual(2);
}

it("a bus matched at 25 km/h 40 m before a U-turn that stops 10 m past it stays on the far carriageway", () => brakesPastUTurn(160, 25, 8_000, 10));
it("a bus matched at 50 km/h 100 m before a U-turn that stops 20 m past it stays on the far carriageway", () => brakesPastUTurn(100, 50, 10_000, 20));
it("a bus matched at 60 km/h 140 m before a U-turn that stops 30 m past it stays on the far carriageway", () => brakesPastUTurn(60, 60, 10_000, 30));
it("a bus matched at 45 km/h 80 m before a U-turn that stops 5 m past it stays on the far carriageway", () => brakesPastUTurn(120, 45, 6_000, 5));
