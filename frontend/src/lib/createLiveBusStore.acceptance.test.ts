import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUS_EXPIRY_MS } from "./liveBusFreshness";

type Snapshot = { key: string | null; val: () => unknown };
type Listener = { path: string; next: (snapshot: Snapshot) => void; fail: (error: Error) => void; detach: ReturnType<typeof vi.fn> };
const fixture = vi.hoisted(() => ({
  generation: 1,
  ready: Promise.resolve(),
  values: [] as Listener[],
  changes: [] as Listener[],
  removed: [] as Listener[],
  disposals: [] as Array<() => void>,
  verificationListeners: new Set<() => void>(),
}));
vi.mock("./authState", () => ({
  waitForAuth: () => fixture.ready,
  getAuthVerificationGeneration: () => fixture.generation,
  onAuthVerificationStarted: (listener: () => void) => {
    fixture.verificationListeners.add(listener);
    return () => { fixture.verificationListeners.delete(listener); };
  },
}));
vi.mock("./firebaseDatabase", () => ({ rtdb: {} }));
vi.mock("./telemetryTrace", () => ({
  recordRealtimePayload: vi.fn(), recordRealtimeWatch: vi.fn(), recordTelemetryListenerDelivery: vi.fn(),
  setTelemetryServerTimeOffset: vi.fn(), telemetryTraceEnabled: () => false,
}));
vi.mock("firebase/database", () => {
  const attach = (field: "values" | "changes" | "removed") => (reference: { path: string }, next: Listener["next"], fail: Listener["fail"]) => {
    const detach = vi.fn(); fixture[field].push({ path: reference.path, next, fail, detach }); return detach;
  };
  return { ref: (_database: unknown, path: string) => ({ path }), onValue: attach("values"),
    onChildChanged: attach("changes"), onChildAdded: () => vi.fn(), onChildRemoved: attach("removed") };
});
const flush = async () => { for (let step = 0; step < 6; step++) await Promise.resolve(); };
const snapshot = (value: unknown, key: string | null = null): Snapshot => ({ key, val: () => value });

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(2_000_000);
  fixture.generation = 1; fixture.ready = Promise.resolve(); fixture.values = []; fixture.changes = []; fixture.removed = []; fixture.disposals = [];
  fixture.verificationListeners.clear();
});
afterEach(() => { fixture.disposals.forEach(dispose => dispose()); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("scoped live store acceptance", () => {
  it.each(["snapshot", "changes"] as const)("synchronously invalidates a mounted %s observer when verification starts, then detaches the auth hook when idle", async kind => {
    const { createLiveBusStore } = await import("./createLiveBusStore");
    const store = createLiveBusStore("publicRouteBuses/route:A/buses"), next = vi.fn();
    const dispose = kind === "snapshot" ? store.subscribeSnapshot(next) : store.subscribeChanges(next);
    fixture.disposals.push(dispose); await flush();
    fixture.values[0].next(snapshot({ "node:bus": { timestamp: Date.now() } }));
    expect(fixture.verificationListeners.size).toBe(1);
    fixture.generation++; fixture.ready = new Promise(() => {});
    fixture.verificationListeners.forEach(listener => listener());
    if (kind === "snapshot") expect(next).toHaveBeenLastCalledWith(null, "invalidation");
    else expect(next).toHaveBeenLastCalledWith({ type: "reset", snapshot: null, source: "invalidation" });
    expect(fixture.values[0].detach).toHaveBeenCalledOnce();
    dispose(); expect(fixture.verificationListeners.size).toBe(0);
  });

  it.each(["legacy-first", "canonical-first"] as const)("aggregates canonical fleet views once despite legacy coexistence (%s)", async order => {
    const { createLiveBusStore } = await import("./createLiveBusStore");
    const store = createLiveBusStore("publicRouteBuses", true), next = vi.fn();
    fixture.disposals.push(store.subscribeSnapshot(next)); await flush();
    const current = { "node:bus": { routeId: "A", status: "active", sessionId: "ride", tripState: "in_service", timestamp: Date.now() } };
    const legacy = ["A", { buses: { "node:legacy": { routeId: "A", timestamp: Date.now() } } }];
    const canonical = ["route:A", { buses: { ...current, bare: { routeId: "A", timestamp: Date.now() } } }];
    fixture.values[0].next(snapshot(Object.fromEntries(order === "legacy-first" ? [legacy, canonical] : [canonical, legacy])));
    expect(next).toHaveBeenLastCalledWith(current, "listener");
    fixture.changes[0].next(snapshot({ buses: { "node:legacy": { routeId: "A", timestamp: Date.now() } } }, "A"));
    expect(next).toHaveBeenLastCalledWith(current, "listener");
  });

  it.each(["empty-change", "route-remove"] as const)("clears an active fleet record after canonical %s without retaining a ghost", async event => {
    const { createLiveBusStore } = await import("./createLiveBusStore");
    const store = createLiveBusStore("publicRouteBuses", true), next = vi.fn();
    fixture.disposals.push(store.subscribeSnapshot(next)); await flush();
    const current = { "node:bus": { routeId: "A", status: "active", sessionId: "ride", tripState: "in_service", timestamp: Date.now() } };
    fixture.values[0].next(snapshot({ "route:A": { buses: current } }));
    expect(next).toHaveBeenLastCalledWith(current, "listener");
    (event === "empty-change" ? fixture.changes[0] : fixture.removed[0]).next(snapshot({ buses: {} }, "route:A"));
    expect(next).toHaveBeenLastCalledWith(null, "listener");
    await vi.advanceTimersByTimeAsync(BUS_EXPIRY_MS + 1);
    expect(next.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it.each(["snapshot", "changes"] as const)("withholds old-generation %s cache during a new account verification", async kind => {
    const { createLiveBusStore } = await import("./createLiveBusStore");
    const store = createLiveBusStore("publicRouteBuses/route:A/buses");
    const oldObserver = vi.fn(), newObserver = vi.fn();
    fixture.disposals.push(kind === "snapshot" ? store.subscribeSnapshot(oldObserver) : store.subscribeChanges(oldObserver));
    await flush();
    const oldListener = fixture.values[0];
    oldListener.next(snapshot({ "node:bus": { timestamp: Date.now() } }));
    fixture.generation++;
    let verified!: () => void;
    fixture.ready = new Promise(resolve => { verified = resolve; });
    fixture.disposals.push(kind === "snapshot" ? store.subscribeSnapshot(newObserver) : store.subscribeChanges(newObserver));
    expect(newObserver.mock.calls.some(call => kind === "snapshot" ? call[0] !== null : call[0].snapshot !== null)).toBe(false);
    oldListener.next(snapshot({ "node:oldAccount": { timestamp: Date.now() } }));
    expect(newObserver.mock.calls.some(call => kind === "snapshot" ? call[0]?.["node:oldAccount"] : call[0].snapshot?.["node:oldAccount"])).toBe(false);
    verified(); await flush();
    expect(fixture.values).toHaveLength(2);
    const fresh = { "node:newAccount": { timestamp: Date.now() } };
    fixture.values[1].next(snapshot(fresh));
    if (kind === "snapshot") expect(newObserver).toHaveBeenLastCalledWith(fresh, "listener");
    else expect(newObserver).toHaveBeenLastCalledWith({ type: "reset", snapshot: fresh, source: "listener" });
  });

  it("retains a delayed accepted preview through the paired receipt window, then expires without an event", async () => {
    const { createLiveBusStore } = await import("./createLiveBusStore");
    const store = createLiveBusStore("publicRouteBuses/route:A/buses"), next = vi.fn();
    fixture.disposals.push(store.subscribeSnapshot(next)); await flush();
    const preview = { "node:bus": { timestamp: Date.now() - 60_000, backendReceivedAt: Date.now(), deviceState: "online" } };
    fixture.values[0].next(snapshot(preview));
    await vi.advanceTimersByTimeAsync(Math.max(1, BUS_EXPIRY_MS - 60_000 + 1));
    expect(next).toHaveBeenLastCalledWith(preview, "listener");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(next).toHaveBeenLastCalledWith(null, "expiry");
  });

  it("rejects an unpaired receipt instead of extending a stale sample's preview lifetime", async () => {
    const { createLiveBusStore } = await import("./createLiveBusStore");
    const store = createLiveBusStore("publicRouteBuses/route:A/buses"), next = vi.fn();
    fixture.disposals.push(store.subscribeSnapshot(next)); await flush();
    fixture.values[0].next(snapshot({ "node:bus": { timestamp: Date.now() - BUS_EXPIRY_MS - 1, backendReceivedAt: Date.now() } }));
    await vi.advanceTimersByTimeAsync(2);
    expect(next.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("delivers an initial terminal snapshot before local expiry so joined rides can finish", async () => {
    const { createLiveBusStore } = await import("./createLiveBusStore");
    const store = createLiveBusStore("publicRouteBuses/route:A/buses"), next = vi.fn();
    fixture.disposals.push(store.subscribeChanges(next)); await flush();
    const completed = { "node:bus": { busId: "bus", routeId: "A", sessionId: "old", tripState: "completed", timestamp: Date.now() } };
    fixture.values[0].next(snapshot(completed));
    expect(next).toHaveBeenLastCalledWith({ type: "reset", snapshot: completed, source: "listener" });
    await vi.advanceTimersByTimeAsync(1);
    expect(next).toHaveBeenLastCalledWith({ type: "reset", snapshot: null, source: "expiry" });
  });

  it("fences detached callbacks and does not attach after the final subscriber cancels pending auth", async () => {
    const { createLiveBusStore } = await import("./createLiveBusStore");
    const store = createLiveBusStore("publicRouteBuses/route:A/buses"), next = vi.fn();
    const dispose = store.subscribeSnapshot(next); await flush();
    const old = fixture.values[0]; dispose(); old.next(snapshot({ "node:ghost": { timestamp: Date.now() } }));
    expect(next).not.toHaveBeenCalled();
    let verified!: () => void; fixture.ready = new Promise(resolve => { verified = resolve; });
    const cancel = store.subscribeSnapshot(next); cancel(); verified(); await flush();
    expect(fixture.values).toHaveLength(1);
  });
});
