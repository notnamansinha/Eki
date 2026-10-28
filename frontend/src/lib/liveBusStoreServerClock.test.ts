import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Snap = { key: string | null; val: () => unknown };
type L = { path: string; kind: string; next: (s: Snap) => void; detach: ReturnType<typeof vi.fn> };
const fx = vi.hoisted(() => ({ listeners: [] as L[], trace: false, traceOffset: vi.fn() }));
vi.mock("./authState", () => ({
  waitForAuth: () => Promise.resolve(),
  getAuthVerificationGeneration: () => 1,
  onAuthVerificationStarted: () => () => {},
}));
vi.mock("./firebaseDatabase", () => ({ rtdb: {} }));
vi.mock("./telemetryTrace", () => ({
  recordRealtimePayload: vi.fn(), recordRealtimeWatch: vi.fn(), recordTelemetryListenerDelivery: vi.fn(),
  setTelemetryServerTimeOffset: fx.traceOffset, telemetryTraceEnabled: () => fx.trace,
}));
vi.mock("firebase/database", () => {
  const attach = (kind: string) => (ref: { path: string }, next: L["next"]) => {
    const detach = vi.fn();
    fx.listeners.push({ path: ref.path, kind, next, detach });
    return detach;
  };
  return { ref: (_db: unknown, path: string) => ({ path }), onValue: attach("value"), onChildAdded: attach("added"),
    onChildChanged: attach("changed"), onChildRemoved: attach("removed") };
});

const NOW = 1_800_000_000_000;
const ROUTE_PATH = "publicRouteBuses/route:A/buses";
const OFFSET_PATH = ".info/serverTimeOffset";
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const listener = (path: string) => fx.listeners.filter(l => l.kind === "value" && l.path === path && l.detach.mock.calls.length === 0).at(-1)!;
const emit = (path: string, value: unknown) => listener(path).next({ key: null, val: () => value });
// A valid, server-published ride stamped on the server timeline.
const bus = { busId: "b1", routeId: "A", sessionId: "s1", status: "active", deviceState: "online",
  tripState: "in_service", direction: "forward", directionState: "resolved", lat: 23, lng: 72, heading: 10, speed: 20,
  timestamp: NOW, backendReceivedAt: NOW };

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(NOW);
  fx.listeners = []; fx.trace = false; fx.traceOffset.mockClear();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("live bus store on a skewed viewer clock", () => {
  it.each([
    ["15 s behind", -15_000],
    ["6 min ahead", 360_000],
  ])("shows a fresh server-published bus when the device clock is %s", async (_label, skew) => {
    const { subscribeLiveBusesByRoute } = await import("./liveBusStore");
    const { passengerLiveBuses } = await import("./passengerLiveBus");
    vi.setSystemTime(NOW + skew);
    const next = vi.fn();
    const dispose = subscribeLiveBusesByRoute("A", next);
    await flush();
    emit(OFFSET_PATH, -skew);
    emit(ROUTE_PATH, { "node:b1_A": bus });
    expect(passengerLiveBuses(next.mock.lastCall?.[0])).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5);
    expect(next).not.toHaveBeenLastCalledWith(null, "expiry");
    dispose();
  });

  it("keeps a future-looking bus until the offset arrives, then replays it as visible", async () => {
    const { subscribeLiveBusChangesByRoute } = await import("./liveBusStore");
    const { passengerLiveBuses } = await import("./passengerLiveBus");
    vi.setSystemTime(NOW - 15_000);
    const changes: Array<{ type: string; snapshot?: unknown; source: string }> = [];
    const dispose = subscribeLiveBusChangesByRoute("A", (change) => changes.push(change));
    await flush();
    emit(ROUTE_PATH, { "node:b1_A": bus });
    // Without an offset the bus looks 15 s in the future: hidden, not pruned.
    expect(passengerLiveBuses(changes.at(-1)?.snapshot as Record<string, unknown>)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5);
    expect(changes.some(change => change.source === "expiry")).toBe(false);
    emit(OFFSET_PATH, 15_000);
    expect(changes.at(-1)).toMatchObject({ type: "reset", source: "cache" });
    expect(passengerLiveBuses(changes.at(-1)?.snapshot as Record<string, unknown>)).toHaveLength(1);
    dispose();
    expect(listener(OFFSET_PATH)).toBeUndefined();
  });

  it("does not replay for sub-second offset refinements and forwards the offset to traces", async () => {
    const { subscribeLiveBusChangesByRoute } = await import("./liveBusStore");
    fx.trace = true;
    const next = vi.fn();
    const dispose = subscribeLiveBusChangesByRoute("A", next);
    await flush();
    emit(ROUTE_PATH, { "node:b1_A": bus });
    const deliveries = next.mock.calls.length;
    emit(OFFSET_PATH, 400);
    expect(next).toHaveBeenCalledTimes(deliveries);
    expect(fx.traceOffset).toHaveBeenLastCalledWith(400);
    dispose();
  });
  it("does not spin the expiry timer when a corrupt viewer clock makes a bus look a year in the future", async () => {
    const { subscribeLiveBusChangesByRoute } = await import("./liveBusStore");
    vi.setSystemTime(NOW - 400 * 86_400_000);
    const changes: Array<{ source: string }> = [];
    const dispose = subscribeLiveBusChangesByRoute("A", (change) => changes.push(change));
    await flush();
    emit(OFFSET_PATH, 400 * 86_400_000); // beyond the plausible range, so rejected
    emit(ROUTE_PATH, { "node:b1_A": bus });
    const timeouts = vi.spyOn(globalThis, "setTimeout");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(timeouts.mock.calls.length).toBeLessThan(3);
    expect(changes.some(change => change.source === "expiry")).toBe(false);
    dispose();
  });
});
