import { endpointSnapshotVersion } from "../lib/endpointSnapshotVersion";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodePolyline } from "../lib/polylineUtils";
import type { TelemetryPayload } from "./telemetryPayload";

const state = vi.hoisted(() => ({
  values: new Map<string, Record<string, unknown>>(),
  route: {} as Record<string, unknown>,
  compute: vi.fn(),
  writes: [] as string[],
  onGeometryWrite: null as (() => void) | null,
}));
vi.mock("../lib/firebaseAdmin", () => ({
  db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => state.route }) }) }) },
  rtdb: { ref: (path: string) => ({
    once: async () => ({ val: () => state.values.get(path) ?? null }),
    set: async (value: Record<string, unknown>) => {
      state.values.set(path, value); state.writes.push(path);
      if (path.startsWith("activeRouteGeometry/")) state.onGeometryWrite?.();
    },
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
  state.onGeometryWrite = null;
  state.route = { stops, forwardPolyline: encodePolyline(stops), reversePolyline: encodePolyline([...stops].reverse()), geometryVersion: 1 };
  state.values.set(key, { ...assignment, sessionId: "outbound", driverId: "driver", status: "active", tripState: "in_service", direction: "forward", directionState: "resolved", directionFirestoreSynced: true, currentStopIndex: 4 });
  invalidateTelemetryRoute(assignment.routeId);
});

describe("live routing publication", () => {
  it("labels missing dynamic geometry as a new configured fallback revision", async () => {
    state.values.set(key, { ...state.values.get(key), routeSource: "dynamic-reroute", routeVersion: 7,
      routeDirection: "forward", routeSessionId: "outbound", routeGeometryVersion: 1,
      routeComputedAt: Date.now(), routeTrafficState: "current" });
    state.compute.mockRejectedValue(new Error("mock offline"));
    publish({ ...sample(1), lat: 23, lng: 72.003 }); await drainTelemetryRouteProcessing();
    expect(state.values.get(key)).toMatchObject({ routeSource: "configured", routeTrafficState: "fallback", routeComputedAt: null });
    expect(Number(state.values.get(key)?.routeVersion)).toBeGreaterThan(7);
  });
  it.each(["forward", "reverse"] as const)("refreshes a ready %s itinerary with its directional ordered stops", async direction => {
    const ordered = direction === "forward" ? stops : [...stops].reverse();
    state.values.set(key, { ...state.values.get(key), direction, tripState: "pre_departure", currentStopIndex: 0 });
    state.compute.mockImplementation(async (origin, destination, intermediates) => ({
      encodedPolyline: encodePolyline([origin, ...intermediates, destination]), distanceMeters: 10000, duration: "1000s",
    }));
    publish({ ...sample(1), ...ordered[0], speed: 0, motionState: "stopped" });
    await drainTelemetryRouteProcessing();
    expect(state.compute).toHaveBeenCalledTimes(1);
    expect(state.compute).toHaveBeenCalledWith(ordered[0], ordered[99], ordered.slice(1, -1),
      { routingPreference: "TRAFFIC_AWARE_OPTIMAL", timeoutMs: 3500 });
    const live = state.values.get(key)!;
    expect(live).toMatchObject({ direction, routeDirection: direction, routeSource: "dynamic-reroute", routeTrafficState: "current", tripState: "pre_departure" });
    expect(live.routeComputedAt).toEqual(expect.any(Number));
    expect(state.values.get(`activeRouteGeometry/${key.slice("activeBuses/".length)}/${live.routeVersion}`)).toMatchObject({ firstStopIndex: 1 });
    publish({ ...sample(2), ...ordered[0], speed: 0, motionState: "stopped" }); await drainTelemetryRouteProcessing();
    expect(state.compute).toHaveBeenCalledTimes(1);
  });
  it("refreshes an old parked preview only when departure is observed", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      state.values.set(key, { ...state.values.get(key), tripState: "pre_departure", currentStopIndex: 0 });
      state.compute.mockImplementation(async (origin, destination, intermediates) => ({
        encodedPolyline: encodePolyline([origin, ...intermediates, destination]), distanceMeters: 10000, duration: "1000s",
      }));
      publish({ ...sample(1), ...stops[0], speed: 0, motionState: "stopped" }); await drainTelemetryRouteProcessing();
      now += 45 * 60_000;
      publish({ ...sample(2), ...stops[0], speed: 0, motionState: "stopped" }); await drainTelemetryRouteProcessing();
      expect(state.compute).toHaveBeenCalledTimes(1);
      state.values.set(key, { ...state.values.get(key), tripState: "in_service", currentStopIndex: 1 });
      publish({ ...sample(3), lat: 23, lng: 72.0003 }); await drainTelemetryRouteProcessing();
      expect(state.compute).toHaveBeenCalledTimes(2);
      expect(state.compute.mock.calls[1][2]).toEqual(stops.slice(1, -1));
    } finally { vi.restoreAllMocks(); }
  });
  it("discards a delayed departure response after a session/direction change", async () => {
    let resolve!: (value: unknown) => void;
    state.compute.mockImplementation(() => new Promise(done => { resolve = done; }));
    publish({ ...sample(1), lat: 23, lng: 72.003 });
    await vi.waitFor(() => expect(state.compute).toHaveBeenCalledTimes(1));
    state.values.set(key, { ...state.values.get(key), sessionId: "return", direction: "reverse", routeDirection: "reverse", routeSource: "configured" });
    resolve({ encodedPolyline: encodePolyline(stops), distanceMeters: 10000, duration: "1000s" });
    await drainTelemetryRouteProcessing();
    expect(state.values.get(key)).toMatchObject({ sessionId: "return", direction: "reverse", routeSource: "configured" });
  });
  it("rejects geometry that would send a bus back to a stop passed while computing", async () => {
    let resolve!: (value: unknown) => void;
    state.compute.mockImplementation(() => new Promise(done => { resolve = done; }));
    publish({ ...sample(1), lat: 23, lng: 72.003 });
    await vi.waitFor(() => expect(state.compute).toHaveBeenCalledTimes(1));
    state.values.set(key, { ...state.values.get(key), currentStopIndex: 5 });
    resolve({ encodedPolyline: encodePolyline(stops), distanceMeters: 10000, duration: "1000s" });
    await drainTelemetryRouteProcessing();
    expect(state.values.get(key)).toMatchObject({ currentStopIndex: 5, routeSource: "configured", routeTrafficState: "fallback" });
  });
  it("caps departure failures across repeated ticks, preserving the same directional fallback", async () => {
    let now = 2_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    state.compute.mockRejectedValue(new Error("mock provider outage"));
    try {
      for (let i = 0; i < 100; i++) {
        publish({ ...sample(i + 1), lat: 23, lng: 72.003 });
        await drainTelemetryRouteProcessing(); now += 1_000;
      }
      expect(state.compute).toHaveBeenCalledTimes(3);
      expect(state.values.get(key)).toMatchObject({ direction: "forward", routeSource: "configured", routeTrafficState: "fallback" });
    } finally { vi.restoreAllMocks(); }
  });
  it("retains a continuity anchor through one low-quality match without reusing it as a current display fix", async () => {
    state.compute.mockImplementation(async (origin, destination, intermediates) => ({
      encodedPolyline: encodePolyline([origin, ...intermediates, destination]), distanceMeters: 10000, duration: "1000s",
    }));
    const now = Date.now();
    publish({ ...sample(1), timestamp: now, lat: 23, lng: 72.003 }); await drainTelemetryRouteProcessing();
    publish({ ...sample(2), timestamp: now + 1_000, lat: 23.0008, lng: 72.0031, gpsHdop: 8 }); await drainTelemetryRouteProcessing();
    expect(state.values.get(key)?.matchedLocation).toBeNull();
    expect(state.values.get(key)?.routeMatchAnchor).toMatchObject({ seq: 1 });
    publish({ ...sample(3), timestamp: now + 2_000, lat: 23, lng: 72.0032 }); await drainTelemetryRouteProcessing();
    expect(state.values.get(key)?.matchedLocation).toMatchObject({ seq: 3 });
  });
  it("does not publish an aged geometry pointer after a stall between storing geometry and the pointer transaction", async () => {
    const started = Date.now();
    state.compute.mockResolvedValue({ encodedPolyline: encodePolyline(stops), distanceMeters: 10000, duration: "1000s", polylineQuality: "HIGH_QUALITY" });
    state.onGeometryWrite = () => { vi.spyOn(Date, "now").mockReturnValue(started + 181 * 24 * 60 * 60 * 1000); };
    try {
      publish(sample(1));
      await drainTelemetryRouteProcessing();
      expect(state.writes.some(path => path.startsWith("activeRouteGeometry/"))).toBe(true);
      expect(state.values.get(key)?.routeSource).not.toBe("dynamic-reroute");
    } finally { vi.restoreAllMocks(); }
  });
  it("discards a reroute pointer if route editing occurs during sibling publication", async () => {
    state.compute.mockResolvedValue({ encodedPolyline: encodePolyline(stops), distanceMeters: 10000, duration: "1000s", polylineQuality: "HIGH_QUALITY" });
    state.onGeometryWrite = () => invalidateTelemetryRoute(assignment.routeId);
    publish(sample(1)); await drainTelemetryRouteProcessing();
    expect(state.writes.some(path => path.startsWith("activeRouteGeometry/"))).toBe(true);
    expect(state.values.get(key)?.routeSource).not.toBe("dynamic-reroute");
  });
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
