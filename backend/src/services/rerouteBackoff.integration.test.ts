import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePolyline } from "../lib/polylineUtils";
import type { TelemetryPayload } from "./telemetryPayload";

const state = vi.hoisted(() => ({ values: new Map<string, Record<string, unknown>>(),
  route: {} as Record<string, unknown>, compute: vi.fn(), beforeTransaction: null as (() => void) | null }));
vi.mock("../lib/firebaseAdmin", () => ({
  db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => state.route }) }) }) },
  rtdb: { ref: (path: string) => ({
    once: async () => ({ val: () => state.values.get(path) ?? null }),
    set: async (value: Record<string, unknown>) => { state.values.set(path, value); },
    transaction: async (update: (value: unknown) => Record<string, unknown> | undefined) => {
      state.beforeTransaction?.();
      const next = update(state.values.get(path) ?? null);
      if (next !== undefined) state.values.set(path, next);
      return { committed: next !== undefined, snapshot: { val: () => state.values.get(path) ?? null } };
    },
  }) },
}));
vi.mock("../lib/googleMaps", () => ({ computeRouteGeometry: state.compute, LIVE_REROUTE_TIMEOUT_MS: 3500 }));
vi.mock("../lib/backgroundFailureTracker", () => ({ recordBackgroundFailure: vi.fn() }));

let service: typeof import("./telemetryRouteService");
let now: number;
let sequence: number;
const stops = [{ id: "A", lat: 23, lng: 72 }, { id: "B", lat: 23.1, lng: 72.1 }];
const key = (bus = "bus") => `activeBuses/${bus}_route`;
function initial(bus = "bus") {
  state.values.set(key(bus), { busId: bus, routeId: "route", sessionId: "s1", direction: "forward",
    routeDirection: "forward", routeSessionId: "s1", routeGeometryVersion: 1,
    routeVersion: 1, routeSource: "configured", status: "active", tripState: "in_service", currentStopIndex: 1 });
}
async function tick(bus = "bus", point = { lat: 24, lng: 73 }) {
  const sample: TelemetryPayload = { ...point, speed: 30, heading: 45, motionState: "moving", gpsHdop: 1,
    seq: ++sequence, timestamp: now, deviceSentAt: now };
  state.values.set(key(bus), { ...state.values.get(key(bus)), ...sample });
  service.scheduleTelemetryRouteProcessing({ busId: bus, routeId: "route" }, sample);
  await service.drainTelemetryRouteProcessing();
}
beforeEach(async () => {
  vi.resetModules(); now = 1_000_000; sequence = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Math, "random").mockReturnValue(1);
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.values.clear(); state.beforeTransaction = null; state.compute.mockReset();
  state.compute.mockRejectedValue(new Error("provider unavailable"));
  state.route = { stops, geometryVersion: 1, forwardPolyline: encodePolyline(stops), reversePolyline: encodePolyline([...stops].reverse()) };
  service = await import("./telemetryRouteService");
  initial();
});
afterEach(() => { vi.restoreAllMocks(); });

describe("reroute scheduling with persisted backoff", () => {
  it("reduces a minute of persistent failures from the legacy 12 attempts to 3", async () => {
    for (let elapsed = 0; elapsed < 60_000; elapsed += 1000) { await tick(); now += 1000; }
    expect(state.compute).toHaveBeenCalledTimes(3);
    expect(state.values.get(key())?.rerouteRetry).toMatchObject({ failures: 3, nextAttemptAt: 1_070_000 });
  });

  it("retains backoff through a process restart and resets on a new session", async () => {
    await tick(); expect(state.compute).toHaveBeenCalledTimes(1);
    vi.resetModules(); service = await import("./telemetryRouteService");
    now += 5000; await tick(); expect(state.compute).toHaveBeenCalledTimes(1);
    state.values.set(key(), { ...state.values.get(key()), sessionId: "s2" });
    now += 1000; await tick(); expect(state.compute).toHaveBeenCalledTimes(2);
    expect(state.values.get(key())?.rerouteRetry).toMatchObject({ failures: 1 });
  });

  it("clears retry state on route recovery and on relevant route edits", async () => {
    await tick(); expect(state.compute).toHaveBeenCalledTimes(1);
    now += 1000; await tick("bus", { lat: 23.05, lng: 72.05 });
    expect(state.values.get(key())?.rerouteRetry).toBeNull();
    // Existing continuity guards require two samples for this large jump.
    now += 1000; await tick();
    now += 1000; await tick(); expect(state.compute).toHaveBeenCalledTimes(2);
    state.route.geometryVersion = 2; service.invalidateTelemetryRoute("route");
    now += 1000; await tick(); expect(state.compute).toHaveBeenCalledTimes(3);
    expect(state.values.get(key())?.rerouteRetry).toMatchObject({ failures: 1 });
  });

  it("clears retry state on successful geometry publication", async () => {
    await tick();
    state.compute.mockResolvedValue({ encodedPolyline: encodePolyline(stops), distanceMeters: 1000, duration: "100s" });
    now += 10_000; await tick();
    expect(state.values.get(key())).toMatchObject({ routeState: "ON_NEW_ROUTE", rerouteRetry: null, rerouteError: null });
  });

  it("resets a ride's backoff after its travel direction changes", async () => {
    await tick();
    state.values.set(key(), { ...state.values.get(key()), direction: "reverse" });
    now += 1000; await tick();
    expect(state.compute).toHaveBeenCalledTimes(2);
    expect(state.values.get(key())?.rerouteRetry).toMatchObject({ failures: 1 });
  });

  it("limits failing fleet calls and allows one timely recovery probe", async () => {
    for (let n = 0; n < 20; n++) { initial(`b${n}`); await tick(`b${n}`); }
    expect(state.compute).toHaveBeenCalledTimes(5);
    expect(service.getRouteProcessingStatus().rerouting.provider).toMatchObject({ failures: 5, retryAfterMs: 60_000 });
    now += 60_000;
    state.compute.mockResolvedValue({ encodedPolyline: encodePolyline(stops), distanceMeters: 1000, duration: "100s" });
    await tick("b19");
    expect(state.compute).toHaveBeenCalledTimes(6);
    expect(service.getRouteProcessingStatus().rerouting.provider.failures).toBe(0);
  });

  it("does not apply an old provider failure to a replacement session", async () => {
    state.compute.mockImplementation(async () => {
      state.values.set(key(), { ...state.values.get(key()), sessionId: "replacement", routeState: "ON_ROUTE", rerouteRetry: null });
      throw new Error("late provider failure");
    });
    await tick();
    expect(state.values.get(key())).toMatchObject({ sessionId: "replacement", routeState: "ON_ROUTE", rerouteRetry: null });
  });

  it("does not publish old successful geometry onto a replacement session", async () => {
    state.compute.mockImplementation(async () => {
      state.values.set(key(), { ...state.values.get(key()), sessionId: "replacement", routeState: "ON_ROUTE", rerouteRetry: null });
      return { encodedPolyline: encodePolyline(stops), distanceMeters: 1000, duration: "100s" };
    });
    await tick();
    expect(state.values.get(key())).toMatchObject({ sessionId: "replacement", routeState: "ON_ROUTE", routeVersion: 1, rerouteRetry: null });
  });

  it("does not dispatch a queued reroute after its session changes before claim", async () => {
    let transactions = 0;
    state.beforeTransaction = () => {
      if (++transactions === 2) state.values.set(key(), { ...state.values.get(key()), sessionId: "replacement" });
    };
    await tick();
    expect(state.compute).not.toHaveBeenCalled();
  });
});
