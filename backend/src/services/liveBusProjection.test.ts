import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerFence } from "../lib/workerFence";
const fixture = vi.hoisted(() => ({ data: {} as Record<string, any>, listeners: new Map<string, (s: any) => void>(), reads: [] as { path: string; limit?: number }[], updates: [] as { path: string; values: Record<string, any> }[], denyLeafWrites: false, fail: false, gate: null as Promise<void> | null, heldPath: "", holdTransaction: false }));
vi.mock("../lib/firebaseAdmin", () => {
  const snapshot = (value: any, key: string | null = null): any => ({ key, val: () => value,
    forEach: (fn: (s: any) => void) => Object.entries(value ?? {}).forEach(([k, v]) => fn(snapshot(v, k))) });
  const read = (path: string) => path.split("/").reduce((v, k) => v?.[k], fixture.data) ?? null;
  const write = (path: string, value: any) => {
    const parts = path.split("/"); let target = fixture.data;
    for (const part of parts.slice(0, -1)) target = target[part] ??= {};
    target[parts.at(-1)!] = structuredClone(value);
  };
  const reference = (path: string, after = "", limit?: number): any => ({
    path,
    on: (event: string, fn: (s: any) => void) => fixture.listeners.set(event, fn),
    off: (event: string) => fixture.listeners.delete(event),
    orderByKey: () => reference(path, after, limit), startAfter: (key: string) => reference(path, key, limit),
    limitToFirst: (n: number) => reference(path, after, n),
    once: async () => { fixture.reads.push({ path, limit }); if (!fixture.holdTransaction && fixture.heldPath === path) await fixture.gate; const value = read(path);
      return snapshot(limit ? Object.fromEntries(Object.entries(value ?? {}).filter(([k]) => k > after).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)) : structuredClone(value)); },
    transaction: async (update: (v: any) => any, _done: any, speculative: boolean) => {
      expect(speculative).toBe(false);
      if (fixture.holdTransaction && fixture.heldPath === path) await fixture.gate;
      if (fixture.fail) { fixture.fail = false; throw new Error("injected unavailable"); }
      const next = update(structuredClone(read(path)));
      if (next !== undefined) write(path, next);
      return { committed: next !== undefined, snapshot: snapshot(structuredClone(read(path))) };
    },
    // Stands in for the rules-bound writer: applies a multi-path update only
    // under the conditions database.rules.json evaluates for it.
    update: async (values: Record<string, any>) => {
      fixture.updates.push({ path, values: structuredClone(values) });
      const current = read(path), next = structuredClone(current ?? {}), touched = new Set<string>();
      for (const [child, value] of Object.entries(values)) {
        const parts = child.split("/"); let target = next;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        if (value === null) delete target[parts.at(-1)!]; else target[parts.at(-1)!] = structuredClone(value);
        if (parts[0] === "buses" && parts[1]) touched.add(parts[1]);
      }
      const allowed = !fixture.denyLeafWrites && typeof current?._workerGeneration === "number" &&
        next._workerGeneration === current._workerGeneration && next.revision === current.revision + 1 &&
        [...touched].every(key => !next.buses?.[key] || ("busId" in next.buses[key] && "routeId" in next.buses[key]));
      if (!allowed) throw Object.assign(new Error("PERMISSION_DENIED: Permission denied"), { code: "PERMISSION_DENIED" });
      write(path, next);
    },
  });
  return { rtdb: { ref: (path: string) => reference(path) }, liveProjectionWriterRtdb: () => ({ ref: (path: string) => reference(path) }) };
});
import { getLiveBusProjectionStatus, projectionLeafChanges, publicLiveBus, routeAvailability, startLiveBusProjection } from "./liveBusProjection";
import { lifecycleIntakeFingerprint } from "./lifecycleIntake";
let stop: (() => Promise<void>) | undefined;
const live = (sessionId = "s1") => ({ busId: "bus1", routeId: "route1", sessionId, deviceState: "online", status: "active", tripState: "in_service", timestamp: Date.now(), lat: 23, lng: 72 });
const emit = (event: string, value: any) => fixture.listeners.get(event)?.({ key: "bus1_route1", val: () => value });
async function settle() { for (let n = 0; n < 40; n++) await Promise.resolve(); }
function start(generation = 1, lifetime = 100_000) { const fence = new WorkerFence("test", generation, performance.now() + lifetime); stop = fence.run(startLiveBusProjection); return fence; }
beforeEach(() => { vi.useFakeTimers(); fixture.data = {}; fixture.listeners.clear(); fixture.reads = []; fixture.updates = []; fixture.denyLeafWrites = false; fixture.fail = false; fixture.gate = null; fixture.heldPath = ""; fixture.holdTransaction = false; });
afterEach(async () => { await stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllEnvs(); });
const node = "node:bus1_route1", routePath = "publicRouteBuses/route:route1";
const route = () => fixture.data.publicRouteBuses["route:route1"];
async function publish(value: any) { fixture.data.activeBuses = { bus1_route1: value }; emit("child_changed", value); await settle(); }
describe("public live projection", () => {
  it("removes retired assignment presence from both the public view and route catalog", async () => {
    const retired = { ...live(), status: undefined, sessionId: undefined, deviceState: "offline", retiredAssignmentRevision: 2 };
    fixture.data.activeBuses = { bus1_route1: live() }; start(); emit("child_changed", live()); await settle();
    fixture.data.activeBuses.bus1_route1 = retired;
    emit("child_changed", retired); await settle();
    expect(publicLiveBus(retired)).toBeNull();
    expect(fixture.data.publicRouteBuses["route:route1"].buses).toEqual({});
    expect(fixture.data.liveRouteCatalog.values["route:route1"]).toMatchObject({ active: 0, available: 0 });
  });
  it("whitelists nested and scalar fields without history, claims or worker state", () => {
    expect(publicLiveBus({ ...live(), _workerGeneration: 9, recentSamples: [{ secret: true }], turnaroundClaimId: "private", telemetryRouteContext: { private: true },
      rawLocation: { lat: 23, secret: "private" }, matchedLocation: { lat: 24, history: [] } })).toEqual({ ...live(), rawLocation: { lat: 23 }, matchedLocation: { lat: 24 } });
    expect(publicLiveBus({ ...live(), routeId: "bad/path" })).toBeNull();
  });
  it("publishes the visited stop and this session's unobserved stops, bounded and validated", () => {
    expect(publicLiveBus({ ...live(), atStop: { sessionId: "s1", index: 1 }, unobservedStops: { sessionId: "s1", indices: [3, 2, 2, -1, 1.5, "4", 600] } }))
      .toMatchObject({ atStopIndex: 1, unobservedStopIndices: [2, 3] });
    // A stale value from the previous ride (or a bare field) is never published.
    expect(publicLiveBus({ ...live("s2"), atStop: { sessionId: "s1", index: 1 } })).not.toHaveProperty("atStopIndex");
    expect(publicLiveBus({ ...live(), atStopIndex: 1 })).not.toHaveProperty("atStopIndex");
    expect(publicLiveBus({ ...live(), atStop: { sessionId: "s1", index: -1 } })).not.toHaveProperty("atStopIndex");
    // RTDB may return a sparse array as an object.
    expect(publicLiveBus({ ...live(), unobservedStops: { sessionId: "s1", indices: { 0: 4, 2: 5 } } }))
      .toMatchObject({ unobservedStopIndices: [4, 5] });
    // Another ride's evidence never leaks into this one.
    expect(publicLiveBus({ ...live("s2"), unobservedStops: { sessionId: "s1", indices: [2] } })).not.toHaveProperty("unobservedStopIndices");
    expect(publicLiveBus({ ...live(), unobservedStops: { sessionId: "s1", indices: [] } })).not.toHaveProperty("unobservedStopIndices");
    expect(publicLiveBus({ ...live(), unobservedStops: { sessionId: "s1", indices: [2] } })).not.toHaveProperty("unobservedStops");
  });
  it("excludes matcher metadata from intake but retains same-fix lifecycle/session changes", () => {
    const input = live(); const fingerprint = lifecycleIntakeFingerprint(input);
    expect(lifecycleIntakeFingerprint({ ...input, recentSamples: [1], mapMatchSeq: 4, _workerGeneration: 2 })).toBe(fingerprint);
    for (const change of [{ sessionId: "s2" }, { tripState: "completed" }, { deviceState: "offline" }, { turnaroundClaimId: "new" }]) {
      expect(lifecycleIntakeFingerprint({ ...input, ...change })).not.toBe(fingerprint);
    }
  });
  it("counts active rides separately from fresh sessionless previews", () => {
    expect(routeAvailability({ active: { ...live(), timestamp: 600_001 }, stale: { deviceState: "online", timestamp: 1 }, fresh: { deviceState: "online", timestamp: 600_001 }, done: { ...live(), tripState: "completed" } }, 600_001)).toEqual({ active: 1, available: 1, freshestAt: 600_000, activeReceipts: [600_000], availableReceipts: [600_000] });
  });
  it.each([
    { deviceState: "offline" }, { automaticServicePaused: true },
    { timestamp: 509_999 }, { timestamp: 610_001 }, { timestamp: NaN },
    { timestamp: 509_999, backendReceivedAt: 600_000 },
  ])("does not advertise an unavailable durable ride: %j", change => {
    expect(routeAvailability({ bus: { ...live(), timestamp: 600_000, ...change } }, 600_000).active).toBe(0);
  });
  it("keeps a fresh bus selectable when another bus on its route goes silent", () => {
    expect(routeAvailability({ stale: { ...live(), timestamp: 500_000 }, fresh: { ...live("s2"), timestamp: 600_000 } }, 600_000)).toMatchObject({ active: 1, activeReceipts: [600_000] });
  });
  it("does not rewrite catalog leases on every fix, but renews them across 30s buckets", () => {
    const availability = (at: number) => routeAvailability({ bus: { ...live(), timestamp: at } }, at);
    expect(availability(600_001)).toEqual(availability(629_999));
    expect(availability(630_000)).not.toEqual(availability(629_999));
    // Quantization never extends availability beyond the actual 90s deadline.
    expect(routeAvailability({ bus: { ...live(), timestamp: 629_999 } }, 690_001).active).toBe(0);
  });
  it("re-reads authority instead of publishing a queued stale session and suppresses internal-only events", async () => {
    const old = live(); fixture.data.activeBuses = { bus1_route1: live("s2") }; start(); emit("child_changed", old); await settle();
    expect(fixture.data.publicRouteBuses["route:route1"].buses["node:bus1_route1"].sessionId).toBe("s2");
    emit("child_changed", { ...old, telemetryRouteContext: { retry: 7 } }); await settle();
    expect(getLiveBusProjectionStatus()).toMatchObject({ events: 2, skipped: 1, sourceReads: 1, committed: 1 });
    delete fixture.data.activeBuses.bus1_route1; emit("child_removed", old); await settle();
    expect(fixture.data.publicRouteBuses["route:route1"].buses).toEqual({});
    expect(fixture.data.liveRouteCatalog.values["route:route1"].active).toBe(0);
  });
  it("periodically repairs failed publication and orphaned removals using bounded pages", async () => {
    fixture.data.activeBuses = { bus1_route1: live() }; fixture.fail = true; start(); emit("child_changed", live()); await settle();
    await vi.advanceTimersByTimeAsync(4000); await settle();
    expect(fixture.data.publicRouteBuses["route:route1"].buses["node:bus1_route1"].sessionId).toBe("s1");
    delete fixture.data.activeBuses.bus1_route1;
    await vi.advanceTimersByTimeAsync(65_000); await settle();
    expect(fixture.data.publicRouteBuses["route:route1"].buses).toEqual({});
    expect(fixture.reads.filter(r => r.limit).every(r => r.limit! <= 25)).toBe(true);
  });
  it("cannot overwrite a newer generation's public state", async () => {
    fixture.data.activeBuses = { bus1_route1: live("old") };
    fixture.data.publicRouteBuses = { "route:route1": { _workerGeneration: 10, revision: 5, buses: { "node:bus1_route1": live("new") } } };
    fixture.data.liveRouteCatalog = { _workerGeneration: 10, values: { "route:route1": { active: 1, available: 0, freshestAt: 0 } } };
    start(9); emit("child_changed", live("old")); await settle();
    expect(fixture.data.publicRouteBuses["route:route1"].buses["node:bus1_route1"].sessionId).toBe("new");
    expect(fixture.data.publicRouteBuses["route:route1"].revision).toBe(5);
  });
  it("claims unchanged route and catalog destinations on worker takeover", async () => {
    const bus = publicLiveBus(live())!; fixture.data.activeBuses = { bus1_route1: bus };
    fixture.data.publicRouteBuses = { "route:route1": { _workerGeneration: 1, revision: 5, buses: { "node:bus1_route1": bus } } };
    fixture.data.liveRouteCatalog = { _workerGeneration: 1, revisions: { "route:route1": 5 }, values: { "route:route1": routeAvailability({ bus }) } };
    start(2); emit("child_changed", bus); await settle();
    expect(fixture.data.publicRouteBuses["route:route1"]._workerGeneration).toBe(2);
    expect(fixture.data.publicRouteBuses["route:route1"].revision).toBe(5);
    expect(fixture.data.liveRouteCatalog._workerGeneration).toBe(2);
  });
  it("preserves completion proof when dispatch rereads the already activated automatic return", async () => {
    fixture.data.activeBuses = { bus1_route1: { ...live("return"), tripState: "pre_departure", automaticTurnaround: true, previousSessionId: "s1" } };
    start(); emit("child_changed", { ...live(), tripState: "completed" }); await settle();
    expect(fixture.data.publicRouteBuses["route:route1"].buses["node:bus1_route1"]).toMatchObject({ sessionId: "return", previousSessionId: "s1", automaticTurnaround: true });
  });
  it("bounds shutdown with an unsettled source read and ignores detached callbacks and late replies", async () => {
    let release!: () => void; fixture.gate = new Promise<void>(resolve => { release = resolve; });
    fixture.heldPath = "activeBuses/bus1_route1"; fixture.data.activeBuses = { bus1_route1: live() };
    start(); const callback = fixture.listeners.get("child_changed")!;
    emit("child_changed", live()); await settle();
    const stopping = stop!(); expect(stop!()).toBe(stopping);
    const reads = fixture.reads.length; callback({ key: "bus1_route1", val: () => live("late") });
    await vi.advanceTimersByTimeAsync(8000); await stopping;
    release(); await settle();
    expect(fixture.reads).toHaveLength(reads);
    expect(fixture.data.publicRouteBuses).toBeUndefined();
    expect(fixture.listeners.size).toBe(0);
  });
  it("rejects a dispatched transaction after leadership is revoked", async () => {
    let release!: () => void; fixture.gate = new Promise<void>(resolve => { release = resolve; });
    fixture.heldPath = "publicRouteBuses/route:route1"; fixture.holdTransaction = true;
    fixture.data.activeBuses = { bus1_route1: live() };
    const fence = start(); emit("child_changed", live()); await settle();
    fence.revoke(); release(); await settle();
    expect(fixture.data.publicRouteBuses).toBeUndefined();
  });
  it("reduces a change to its leaves, with null for a removed field and whole values where that is smaller", () => {
    const raw = { lat: 23, lng: 72, speed: 10, heading: 90, gpsHdop: 1.2, motionState: "moving", seq: 1, sampledAt: 1_800_000_000_000 };
    const before = { ...live(), driverId: "driver1", direction: "forward", atStopIndex: 2, rawLocation: raw, unobservedStopIndices: [1, 2] };
    const one = (change: Record<string, unknown>) => projectionLeafChanges("buses/k", before, { ...before, ...change });
    expect(one({ lat: 23.5 })).toEqual({ "buses/k/lat": 23.5 });
    expect(one({ rawLocation: { ...raw, lat: 23.5 } })).toEqual({ "buses/k/rawLocation/lat": 23.5 });
    // Most of the nested map changed: one replacement beats six full paths.
    const moved = { lat: 23.5, lng: 72.5, speed: 11, heading: 91, gpsHdop: 1.2, motionState: "moving", seq: 2, sampledAt: 1_800_000_001_000 };
    expect(one({ rawLocation: moved })).toEqual({ "buses/k/rawLocation": moved });
    expect(one({ unobservedStopIndices: [1, 2, 3] })).toEqual({ "buses/k/unobservedStopIndices": [1, 2, 3] });
    expect(one({ matchedLocation: { lat: 23.5 } })).toEqual({ "buses/k/matchedLocation": { lat: 23.5 } });
    const without = Object.fromEntries(Object.entries(before).filter(([key]) => key !== "atStopIndex" && key !== "rawLocation"));
    expect(projectionLeafChanges("buses/k", before, without)).toEqual({ "buses/k/atStopIndex": null, "buses/k/rawLocation": null });
    expect(projectionLeafChanges("buses/k", before, structuredClone(before))).toEqual({});
    expect(projectionLeafChanges("buses/k", null, before)).toEqual({ "buses/k": before });
    expect(projectionLeafChanges("buses/k", before, null)).toEqual({ "buses/k": null });
    // Nearly every field differs: the bus is replaced as one value.
    const other = { busId: "bus1", routeId: "route1", sessionId: "s9", deviceState: "offline", status: "idle", tripState: "completed", timestamp: 5, lat: 1, lng: 2 };
    expect(projectionLeafChanges("buses/k", before, other)).toEqual({ "buses/k": other });
  });
  it("publishes a position fix as only its changed leaves, stamped with its generation and the next revision", async () => {
    const raw = { lat: 23, lng: 72, speed: 10, heading: 90, gpsHdop: 1.2, motionState: "moving", seq: 1, sampledAt: 1_800_000_000_000 };
    const first = { ...live(), seq: 1, rawLocation: raw };
    start(7); await publish(first);
    expect(fixture.updates).toEqual([{ path: routePath, values: { _workerGeneration: 7, revision: 2, ["buses/" + node]: publicLiveBus(first) } }]);
    const moved = { ...first, lat: 23.001, seq: 2, rawLocation: { ...raw, lat: 23.001, seq: 2 } };
    await publish(moved);
    expect(fixture.updates.at(-1)).toEqual({ path: routePath, values: { _workerGeneration: 7, revision: 3,
      [`buses/${node}/lat`]: 23.001, [`buses/${node}/seq`]: 2, [`buses/${node}/rawLocation/lat`]: 23.001, [`buses/${node}/rawLocation/seq`]: 2 } });
    expect(route()).toEqual({ _workerGeneration: 7, revision: 3, buses: { [node]: publicLiveBus(moved) } });
    expect(getLiveBusProjectionStatus()).toMatchObject({ writeMode: "leaf", routeClaims: 1, leafWrites: 2, committed: 2, leafWriteDenials: 0 });
  });
  it("writes null for a field that left the public value and removes a bus that left the route", async () => {
    start(); await publish({ ...live(), atStop: { sessionId: "s1", index: 2 }, matchedLocation: { lat: 23, lng: 72 } });
    expect(route().buses[node]).toMatchObject({ atStopIndex: 2, matchedLocation: { lat: 23, lng: 72 } });
    await publish(live());
    expect(fixture.updates.at(-1)!.values).toEqual({ _workerGeneration: 1, revision: 3, [`buses/${node}/atStopIndex`]: null, [`buses/${node}/matchedLocation`]: null });
    expect(route().buses[node]).toEqual(publicLiveBus(live()));
    delete fixture.data.activeBuses.bus1_route1; emit("child_removed", live()); await settle();
    expect(fixture.updates.at(-1)!.values).toEqual({ _workerGeneration: 1, revision: 4, ["buses/" + node]: null });
    expect(route().buses).toEqual({});
  });
  it("has its leaf write denied once a successor claims the route, and never falls back to overwrite it", async () => {
    start(4); await publish(live("old"));
    // Generation 5 takes over the route and the catalog, then publishes its own state.
    // As claimRoute leaves it: a new generation, the revision unchanged, so only
    // the generation comparison can deny the former leader's next revision.
    Object.assign(route(), { _workerGeneration: 5, buses: { [node]: publicLiveBus(live("new")) } });
    const revision = route().revision;
    fixture.data.liveRouteCatalog._workerGeneration = 5;
    const writes = fixture.updates.length;
    await publish({ ...live("old"), lat: 99 });
    expect(fixture.updates).toHaveLength(writes + 1);
    expect(fixture.updates.at(-1)!.values).toMatchObject({ _workerGeneration: 4, revision: revision + 1, [`buses/${node}/lat`]: 99 });
    expect(route()).toEqual({ _workerGeneration: 5, revision, buses: { [node]: publicLiveBus(live("new")) } });
    expect(getLiveBusProjectionStatus()).toMatchObject({ leafWriteDenials: 1, leafWriteFallbacks: 0, writeMode: "leaf" });
  });
  it("adopts a route only from a claim that committed, never from an abort", async () => {
    start(4); await publish(live());
    const claims = getLiveBusProjectionStatus() as unknown as Record<string, number>;
    // An erased bus without a revision change forces a denial and a fresh claim.
    delete route().buses[node];
    await publish({ ...live(), lat: 24 });
    const after = getLiveBusProjectionStatus() as unknown as Record<string, number>;
    // The claim wrote the unchanged node back rather than aborting, so it was confirmed.
    expect(after.routeClaims - claims.routeClaims).toBe(1);
    expect(route()).toMatchObject({ _workerGeneration: 4, buses: { [node]: publicLiveBus({ ...live(), lat: 24 }) } });
  });
  it("claims again and repairs the destination when it changed behind the leader's copy", async () => {
    start(4); await publish(live());
    // The bus was erased without a revision change: a leaf write would leave a partial record.
    delete route().buses[node];
    await publish({ ...live(), lat: 24 });
    expect(route().buses[node]).toEqual(publicLiveBus({ ...live(), lat: 24 }));
    // The revision moved without this leader: its next write must not land on the unknown state.
    route().revision += 3; route().buses[node].tripState = "completed";
    await publish({ ...live(), lat: 25 });
    expect(route().buses[node]).toEqual(publicLiveBus({ ...live(), lat: 25 }));
    expect(getLiveBusProjectionStatus()).toMatchObject({ leafWriteDenials: 2, leafWriteFallbacks: 0, routeClaims: 3, writeMode: "leaf" });
  });
  it.each([
    ["leaf", "its public bus"], ["leaf", "the whole route"],
    ["transaction", "its public bus"], ["transaction", "the whole route"],
  ])("%s mode restores a stationary bus on the first recovery pass after %s was erased", async (mode, erased) => {
    if (mode === "transaction") vi.stubEnv("LIVE_PROJECTION_WRITE_MODE", "transaction");
    start(4); await publish(live());
    // The startup pass ends with a claim; the next fix leaves the leader a copy confirmed after it.
    await vi.advanceTimersByTimeAsync(5000); await settle();
    const latest = { ...live(), lat: 24 }; await publish(latest);
    expect(route().buses[node]).toEqual(publicLiveBus(latest));
    // Erased without a revision change, while the bus sends nothing new: only recovery can restore it.
    if (erased === "the whole route") delete fixture.data.publicRouteBuses["route:route1"]; else delete route().buses[node];
    const passes = (getLiveBusProjectionStatus() as unknown as Record<string, number>).reconstructionReads;
    // The 60 s pass starts at 60 s and needs one 1 s tick per page; the next starts at 120 s.
    await vi.advanceTimersByTimeAsync(60_000); await settle();
    expect((getLiveBusProjectionStatus() as unknown as Record<string, number>).reconstructionReads - passes).toBe(1);
    expect(route()).toMatchObject({ _workerGeneration: 4, buses: { [node]: publicLiveBus(latest) } });
    expect(fixture.data.liveRouteCatalog.values["route:route1"]).toMatchObject({ active: 1 });
  });
  it("keeps publishing through the fenced transaction where rules do not grant the leaf writer, then probes again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fixture.denyLeafWrites = true; start(4, 1_000_000); await publish(live());
    expect(route().buses[node]).toEqual(publicLiveBus(live()));
    expect(getLiveBusProjectionStatus()).toMatchObject({ writeMode: "transaction-fallback", leafWriteAttempts: 2, leafWriteDenials: 2, leafWriteFallbacks: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    await publish({ ...live(), lat: 24 });
    expect(route().buses[node].lat).toBe(24);
    expect(getLiveBusProjectionStatus()).toMatchObject({ leafWriteAttempts: 2 });
    fixture.denyLeafWrites = false; await vi.advanceTimersByTimeAsync(5 * 60_000); await settle();
    await publish({ ...live(), lat: 25 });
    expect(route().buses[node].lat).toBe(25);
    expect(getLiveBusProjectionStatus()).toMatchObject({ writeMode: "leaf", leafWriteAttempts: 3, leafWriteFallbacks: 1 });
    warn.mockRestore();
  });
  it("publishes by whole-route transaction only when LIVE_PROJECTION_WRITE_MODE=transaction", async () => {
    vi.stubEnv("LIVE_PROJECTION_WRITE_MODE", "transaction");
    start(4); await publish(live()); await publish({ ...live(), lat: 24 });
    expect(route()).toMatchObject({ _workerGeneration: 4, revision: 2, buses: { [node]: { lat: 24 } } });
    expect(fixture.updates).toHaveLength(0);
    expect(getLiveBusProjectionStatus()).toMatchObject({ writeMode: "transaction", committed: 2, leafWrites: 0 });
  });
  it("does not continue replay or admit work after a stalled page resolves during shutdown", async () => {
    let release!: () => void; fixture.gate = new Promise<void>(resolve => { release = resolve; });
    fixture.heldPath = "activeBuses"; fixture.data.activeBuses = { bus1_route1: live() };
    start(); await vi.advanceTimersByTimeAsync(1000);
    const stopping = stop!(); await vi.advanceTimersByTimeAsync(8000); await stopping;
    release(); await settle();
    expect(fixture.data.publicRouteBuses).toBeUndefined();
    expect(fixture.reads).toEqual([{ path: "activeBuses", limit: 25 }]);
  });
});
