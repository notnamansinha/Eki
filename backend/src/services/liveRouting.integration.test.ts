import { endpointSnapshotVersion } from "../lib/endpointSnapshotVersion";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodePolyline } from "../lib/polylineUtils";
import type { TelemetryPayload } from "./telemetryPayload";

const state = vi.hoisted(() => ({
  values: new Map<string, Record<string, unknown>>(),
  route: {} as Record<string, unknown>,
  compute: vi.fn(),
  writes: [] as string[],
}));
vi.mock("../lib/firebaseAdmin", () => ({
  db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => state.route }) }) }) },
  rtdb: { ref: (path: string) => ({
    once: async () => ({ val: () => state.values.get(path) ?? null }),
    set: async (value: Record<string, unknown>) => { state.values.set(path, value); state.writes.push(path); },
    transaction: async (update: (value: unknown) => Record<string, unknown> | undefined) => {
      const value = update(state.values.get(path) ?? null);
      if (value !== undefined) { state.values.set(path, value); state.writes.push(path); }
      return { committed: value !== undefined, snapshot: { val: () => state.values.get(path) ?? null } };
    },
  }) },
}));
vi.mock("../lib/googleMaps", () => ({ LIVE_REROUTE_TIMEOUT_MS: 3500, computeRouteGeometry: (...args: unknown[]) => state.compute(...args) }));

import { drainTelemetryRouteProcessing, getRouteProcessingStatus, invalidateTelemetryRoute, scheduleTelemetryRouteProcessing } from "./telemetryRouteService";
const assignment = { busId: "bus", routeId: "long-route" };
const key = "activeBuses/bus_long-route";
const stops = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, lat: 23, lng: 72 + i / 1000 }));

function sample(seq: number): TelemetryPayload {
  return { lat: 23.002, lng: 72.003, speed: 20, heading: 90, gpsHdop: 2, motionState: "moving", seq, timestamp: Date.now(), deviceSentAt: Date.now() };
}
function publish(fix: TelemetryPayload) {
  state.values.set(key, { ...state.values.get(key), ...fix });
  scheduleTelemetryRouteProcessing(assignment, fix);
}

beforeEach(() => {
  state.values.clear(); state.writes = []; state.compute.mockReset();
  state.route = { stops, forwardPolyline: encodePolyline(stops), reversePolyline: encodePolyline([...stops].reverse()), geometryVersion: 1 };
  state.values.set(key, { ...assignment, sessionId: "outbound", driverId: "driver", status: "active", tripState: "in_service", direction: "forward", directionState: "resolved", directionFirestoreSynced: true, currentStopIndex: 4 });
  invalidateTelemetryRoute(assignment.routeId);
});

describe("live routing publication", () => {
  it("matches new fixes while Google is pending, then publishes one shared version through all remaining stops", async () => {
    let resolve!: (value: unknown) => void;
    state.compute.mockImplementation(() => new Promise(done => { resolve = done; }));
    publish(sample(1));
    await vi.waitFor(() => expect(state.compute).toHaveBeenCalledTimes(1));
    expect(state.compute.mock.calls[0][1]).toEqual(stops[99]);
    expect(state.compute.mock.calls[0][2]).toEqual(stops.slice(4, 99));
    publish(sample(2));
    await vi.waitFor(() => expect(state.values.get(key)?.mapMatchSeq).toBe(2));
    expect(getRouteProcessingStatus().activeWorkers).toBe(0);
    const polyline = encodePolyline([{ lat: 23.002, lng: 72.003 }, ...stops.slice(4)]);
    resolve({ encodedPolyline: polyline, distanceMeters: 10000, duration: "1000s", polylineQuality: "HIGH_QUALITY" });
    await drainTelemetryRouteProcessing();
    const live = state.values.get(key)!;
    expect(live.routeSource).toBe("dynamic-reroute");
    expect(live.seq).toBe(2); // Older Google request must not restore its old GPS fix.
    expect(live.currentStopIndex).toBe(4);
    expect(live.routeVersion).toBeGreaterThan(1);
    const geometryPath = `activeRouteGeometry/bus_long-route/${live.routeVersion}`;
    expect(state.values.get(geometryPath)?.polyline).toBe(polyline);
    expect(state.writes.indexOf(geometryPath)).toBeLessThan(state.writes.lastIndexOf(key));
  });

  it("discards an old outbound reroute when the return session starts", async () => {
    let resolve!: (value: unknown) => void;
    state.compute.mockImplementation(() => new Promise(done => { resolve = done; }));
    publish(sample(1));
    await vi.waitFor(() => expect(state.compute).toHaveBeenCalledTimes(1));
    state.values.set(key, { ...state.values.get(key), sessionId: "return", direction: "reverse", routeSource: "configured", routeState: "ON_ROUTE" });
    resolve({ encodedPolyline: encodePolyline(stops), distanceMeters: 10000, duration: "1000s", polylineQuality: "HIGH_QUALITY" });
    await drainTelemetryRouteProcessing();
    expect(state.values.get(key)).toMatchObject({ sessionId: "return", direction: "reverse", routeSource: "configured" });
  });
});

it("reinfers provisional direction at the opposite endpoint using the shared version contract", async () => {
  state.values.set(key, { ...assignment, direction: null, directionState: "pending" });
  publish({ ...sample(1), ...stops[0], speed: 0, motionState: "stopped" });
  await drainTelemetryRouteProcessing();
  expect(state.values.get(key)).toMatchObject({ direction: "forward", directionEndpointVersion: endpointSnapshotVersion(stops) });
  publish({ ...sample(2), ...stops[99], speed: 0, motionState: "stopped" });
  await drainTelemetryRouteProcessing();
  expect(state.values.get(key)).toMatchObject({ direction: "reverse", originStopId: "s99", destinationStopId: "s0", directionEndpointVersion: endpointSnapshotVersion(stops) });
});
