import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerFence, workerRtdbTransaction } from "../lib/workerFence";

const fixture = vi.hoisted(() => ({
  data: {} as Record<string, any>,
  listeners: new Map<string, (snapshot: any) => void>(),
  reads: [] as Array<{ path: string; limit?: number }>,
  writes: [] as string[],
  readGates: new Map<string, Promise<void>>(),
  retryGates: new Map<string, Promise<void>>(),
  afterCommitGates: new Map<string, Promise<void>>(),
  readyRetryGate: null as Promise<void> | null,
  pendingReadyRetries: 0,
  loseAcknowledgement: new Set<string>(),
  failures: vi.fn(),
  releases: [] as Array<() => void>,
  cacheLimit: 1000,
  cacheBudgets: [] as number[],
}));
vi.mock("../lib/lruCache", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/lruCache")>();
  return { LruCache: class<K, V> extends actual.LruCache<K, V> {
    constructor(limit: number) { fixture.cacheBudgets.push(limit); super(Math.min(limit, fixture.cacheLimit)); }
  } };
});
vi.mock("../lib/backgroundFailureTracker", () => ({ recordBackgroundFailure: fixture.failures }));
vi.mock("../lib/firebaseAdmin", () => {
  const snapshot = (value: any, key: string | null = null): any => ({
    key, val: () => value,
    forEach: (next: (child: any) => void) => Object.entries(value ?? {}).forEach(([childKey, childValue]) => next(snapshot(childValue, childKey))),
  });
  const read = (path: string) => path.split("/").reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : null, fixture.data) ?? null;
  const write = (path: string, value: any) => {
    const parts = path.split("/"); let target = fixture.data;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(target, part)) Object.defineProperty(target, part, { value: {}, writable: true, enumerable: true, configurable: true });
      target = target[part];
    }
    Object.defineProperty(target, parts.at(-1)!, { value: structuredClone(value), writable: true, enumerable: true, configurable: true });
  };
  const reference = (path: string, after = "", limit?: number, field?: string, equals?: unknown): any => ({
    child: (key: string) => reference(`${path}/${key}`),
    on: (event: string, next: (snapshot: any) => void) => fixture.listeners.set(event, next),
    off: (event: string) => fixture.listeners.delete(event),
    orderByKey: () => reference(path, after, limit),
    orderByChild: (field: string) => reference(path, after, limit, field),
    equalTo: (value: unknown) => reference(path, after, limit, field, value),
    startAfter: (key: string) => reference(path, key, limit, field, equals),
    limitToFirst: (count: number) => reference(path, after, count, field, equals),
    once: async () => {
      fixture.reads.push({ path, limit });
      const value = structuredClone(read(path));
      const selected = limit !== undefined || field !== undefined
        ? Object.fromEntries(Object.entries(value ?? {}).filter(([key, value]: [string, any]) => key > after && (field === undefined || value?.[field] === equals))
          .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, limit)) : value;
      await fixture.readGates.get(path);
      return snapshot(selected);
    },
    transaction: async (update: (value: any) => any, _done: unknown, speculative: boolean) => {
      expect(speculative).toBe(false);
      let next = update(structuredClone(read(path)));
      const retry = next?.public?.ready === true && fixture.readyRetryGate ? fixture.readyRetryGate : fixture.retryGates.get(path);
      if (next?.public?.ready === true && retry) fixture.pendingReadyRetries++;
      if (retry) { await retry; next = update(structuredClone(read(path))); }
      if (next !== undefined) { write(path, next); fixture.writes.push(path); }
      const committedSnapshot = structuredClone(read(path));
      await fixture.afterCommitGates.get(path);
      if (fixture.loseAcknowledgement.delete(path)) throw Error("simulated lost acknowledgement after commit");
      return { committed: next !== undefined, snapshot: snapshot(committedSnapshot) };
    },
  });
  return { rtdb: { ref: (path: string) => reference(path) } };
});
import { rtdb } from "../lib/firebaseAdmin";
import { getLiveBusProjectionStatus, publicLiveBus, startLiveBusProjection } from "./liveBusProjection";

let stop: (() => Promise<void>) | undefined;
let fence: WorkerFence;
const live = (sessionId = "current", routeId = "route1", busId = "bus1") => ({ busId, routeId, sessionId, status: "active", tripState: "in_service", direction: "forward", timestamp: Date.now(), lat: 23, lng: 72 });
const routeKey = (routeId: string) => `route:${routeId}`;
const routePath = (routeId: string) => `publicRouteBuses/${routeKey(routeId)}`;
const projection = (routeId: string) => fixture.data.publicRouteBuses?.[routeKey(routeId)];
const buses = (routeId: string): Record<string, any> => projection(routeId)?.buses ?? {};
const emit = (event: string, key: string, value: any) => fixture.listeners.get(event)?.({ key, val: () => value });
async function settle() { for (let turn = 0; turn < 60; turn++) await Promise.resolve(); }
function start(generation = 4, standalone = false) {
  fence = new WorkerFence("independent-review", generation, performance.now() + 1_000_000);
  stop = standalone ? startLiveBusProjection() : fence.run(startLiveBusProjection);
}
async function recover(milliseconds = 10_000) { await vi.advanceTimersByTimeAsync(milliseconds); await settle(); }
function gate(map: Map<string, Promise<void>>, path: string) {
  let release!: () => void;
  map.set(path, new Promise<void>(resolve => { release = resolve; })); fixture.releases.push(release); return release;
}
function containsCompletion(routeId: string, sessionId: string) {
  return Object.values(buses(routeId)).some(bus => bus.sessionId === sessionId && bus.tripState === "completed" || bus.lastCompletedSessionId === sessionId);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  fixture.data = {}; fixture.listeners.clear(); fixture.reads = []; fixture.writes = [];
  fixture.readGates.clear(); fixture.retryGates.clear(); fixture.loseAcknowledgement.clear(); fixture.failures.mockClear();
  fixture.afterCommitGates.clear(); fixture.readyRetryGate = null; fixture.pendingReadyRetries = 0;
  fixture.releases = [];
  fixture.cacheLimit = 1000; fixture.cacheBudgets = [];
});
afterEach(async () => {
  fixture.releases.forEach(release => release()); fixture.readGates.clear(); fixture.retryGates.clear();
  const stopping = stop?.();
  // A bad stop implementation must not hang the entire regression suite.
  await vi.advanceTimersByTimeAsync(9000);
  await stopping; stop = undefined; vi.clearAllTimers(); vi.useRealTimers();
});

describe("independent public projection fencing and lifecycle regressions", () => {
  it("becomes ready after startup coverage while an already published bus keeps updating", async () => {
    fixture.data.activeBuses = { bus1_route1: live() };
    start(); emit("child_added", "bus1_route1", fixture.data.activeBuses.bus1_route1); await settle();
    expect(Object.keys(buses("route1"))).toHaveLength(1);
    const release = gate(fixture.readGates, "activeBuses/bus1_route1");
    fixture.data.activeBuses.bus1_route1 = { ...live(), timestamp: Date.now() + 1 };
    emit("child_changed", "bus1_route1", fixture.data.activeBuses.bus1_route1); await settle();
    await recover();
    expect(getLiveBusProjectionStatus()).toMatchObject({ activeWorkers: 1 });
    expect(fixture.data.clientProjectionStatus.public).toEqual({ schemaVersion: 1, ready: true });
    release(); await settle();
  });

  it("still waits for the first publication of a newly observed bus during startup", async () => {
    fixture.data.activeBuses = { bus1_route1: live() };
    start(); emit("child_added", "bus1_route1", fixture.data.activeBuses.bus1_route1); await settle();
    const release = gate(fixture.readGates, "activeBuses/bus2_route1");
    fixture.data.activeBuses.bus2_route1 = live("new", "route1", "bus2");
    emit("child_added", "bus2_route1", fixture.data.activeBuses.bus2_route1); await settle();
    await recover();
    expect(fixture.data.clientProjectionStatus.public.ready).toBe(false);
    release(); await recover();
    expect(fixture.data.clientProjectionStatus.public.ready).toBe(true);
    expect(Object.keys(buses("route1"))).toHaveLength(2);
  });

  it("stamps a successor generation even when its public value is identical", async () => {
    const current = publicLiveBus(live());
    fixture.data.activeBuses = { bus1_route1: current };
    fixture.data.publicRouteBuses = { [routeKey("route1")]: { _workerGeneration: 3, revision: 5, buses: { "node:bus1_route1": current } } };
    fixture.data.liveRouteCatalog = { _workerGeneration: 3, values: { [routeKey("route1")]: { active: 1, available: 0, freshestAt: 0 } }, revisions: { [routeKey("route1")]: 5 } };
    start(); emit("child_changed", "bus1_route1", current); await settle();
    expect(projection("route1")._workerGeneration).toBe(4);
    expect(fixture.data.liveRouteCatalog._workerGeneration).toBe(4);
    const older = new WorkerFence("older", 3, performance.now() + 1_000_000);
    const stale = await older.run(() => workerRtdbTransaction(rtdb.ref(routePath("route1")), current => ({ ...current, buses: { bus1_route1: live("stale") } })));
    expect(stale.committed).toBe(false);
    expect(Object.values(buses("route1")).some(bus => bus.sessionId === "current")).toBe(true);
    const staleCatalog = await older.run(() => workerRtdbTransaction(rtdb.ref("liveRouteCatalog"), current => ({ ...current, values: {} })));
    expect(staleCatalog.committed).toBe(false);
  });

  it("retains terminal evidence when a newer session coalesces before publication", async () => {
    const old = { ...live("old"), tripState: "completed" };
    fixture.data.activeBuses = { bus1_route1: { ...live("fresh"), lastCompletedRouteId: "route1", lastCompletedSessionId: "old", lastCompletedAt: Date.now() } };
    start(); emit("child_changed", "bus1_route1", old); await settle();
    expect(Object.values(buses("route1")).some(bus => bus.sessionId === "fresh")).toBe(true);
    expect(containsCompletion("route1", "old")).toBe(true);
  });

  it("replays a new route's bounded prior completion without receiving child-added", async () => {
    fixture.data.activeBuses = { bus1_route2: { ...live("fresh", "route2"), lastCompletedRouteId: "route1", lastCompletedSessionId: "old", lastCompletedAt: Date.now() } };
    start(); await recover();
    // An older joined route recovers its terminal status through the member-only
    // durable status endpoint; projections do not duplicate terminal history.
    expect(containsCompletion("route2", "old")).toBe(true);
    expect(Object.values(buses("route2")).some(bus => bus.lastCompletedRouteId === "route1")).toBe(true);
    expect(Object.values(buses("route2")).some(bus => bus.sessionId === "fresh")).toBe(true);
  });

  it("does not dispatch a public write after a stalled source read is stopped", async () => {
    const release = gate(fixture.readGates, "activeBuses/bus1_route1");
    fixture.data.activeBuses = { bus1_route1: live() };
    start(4, true); emit("child_added", "bus1_route1", live()); await settle();
    expect(fixture.reads.some(read => read.path === "activeBuses/bus1_route1")).toBe(true);
    const stopping = stop!(); release(); await settle(); await stopping;
    expect(Object.keys(buses("route1"))).toHaveLength(0);
  });

  it("does not register or read a queued route when stop happens before dispatch", async () => {
    fixture.data.activeBuses = { bus1_route1: live() };
    start(4, true); emit("child_added", "bus1_route1", live());
    await stop!();
    expect(fixture.reads).toHaveLength(0);
    expect(fixture.writes.filter(path => path === "liveRouteCatalog" || path.startsWith("publicRouteBuses/"))).toHaveLength(0);
  });

  it("does not update the catalog when a dispatched route acknowledgement arrives after stop", async () => {
    const release = gate(fixture.afterCommitGates, routePath("route1"));
    fixture.data.activeBuses = { bus1_route1: live() };
    start(4, true); emit("child_added", "bus1_route1", live()); await settle();
    expect(fixture.writes).toContain(routePath("route1"));
    const catalogWrites = fixture.writes.filter(path => path === "liveRouteCatalog").length;
    const stopping = stop!(); release(); await settle(); await stopping;
    expect(fixture.writes.filter(path => path === "liveRouteCatalog")).toHaveLength(catalogWrites);
  });

  it("denies transaction retries after leadership revocation", async () => {
    const release = gate(fixture.retryGates, routePath("route1"));
    fixture.data.activeBuses = { bus1_route1: live() };
    start(); emit("child_added", "bus1_route1", live()); await settle();
    fence.revoke(); const stopping = stop!(); release(); await settle(); await stopping;
    expect(Object.keys(buses("route1"))).toHaveLength(0);
  });

  it("bounds stop when a dispatched source read never settles without freeing its permit early", async () => {
    const release = gate(fixture.readGates, "activeBuses/bus1_route1");
    fixture.data.activeBuses = { bus1_route1: live() };
    start(); emit("child_added", "bus1_route1", live()); await settle();
    expect(getLiveBusProjectionStatus()).toMatchObject({ activeWorkers: 1 });
    let settled = false; const stopping = stop!().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(9000); await settle();
    expect(settled).toBe(true);
    expect(getLiveBusProjectionStatus()).toMatchObject({ activeWorkers: 1 });
    release(); await settle(); await stopping;
    expect(getLiveBusProjectionStatus()).toMatchObject({ activeWorkers: 0 });
    expect(Object.keys(buses("route1"))).toHaveLength(0);
  });

  it("reports schema readiness only after initial backfill publications actually settle", async () => {
    const release = gate(fixture.readGates, "activeBuses/bus1_route1");
    fixture.data.activeBuses = { bus1_route1: live() };
    start(); await recover(5000);
    expect(fixture.data.clientProjectionStatus.public).toEqual({ schemaVersion: 1, ready: false });
    expect(getLiveBusProjectionStatus()).toMatchObject({ activeWorkers: 1 });
    release(); await recover();
    expect(fixture.data.clientProjectionStatus.public).toEqual({ schemaVersion: 1, ready: true });
    expect(Object.values(buses("route1")).some(bus => bus.sessionId === "current")).toBe(true);
  });

  it("rechecks readiness on retry when new source work arrived after the ready write began", async () => {
    let releaseReady!: () => void;
    fixture.readyRetryGate = new Promise<void>(resolve => { releaseReady = resolve; }); fixture.releases.push(releaseReady);
    start(); await recover(); expect(fixture.pendingReadyRetries).toBe(1);
    const releaseRead = gate(fixture.readGates, "activeBuses/bus1_route1");
    fixture.data.activeBuses = { bus1_route1: live() }; emit("child_added", "bus1_route1", live()); await settle();
    releaseReady(); fixture.readyRetryGate = null; await settle();
    expect(fixture.data.clientProjectionStatus.public.ready).toBe(false);
    releaseRead(); await recover();
    expect(fixture.data.clientProjectionStatus.public.ready).toBe(true);
  });

  it("does not confuse legal prototype-like route IDs with inherited fields", async () => {
    fixture.data.activeBuses = Object.fromEntries(["__proto__", "constructor", "hasOwnProperty"].map(routeId => [`bus_${routeId}`, live("current", routeId, "bus")]));
    start();
    for (const [key, value] of Object.entries(fixture.data.activeBuses)) emit("child_added", key, value);
    await settle();
    for (const routeId of ["__proto__", "constructor", "hasOwnProperty"]) {
      expect(Object.hasOwn(fixture.data.publicRouteBuses ?? {}, routeKey(routeId))).toBe(true);
      expect(Object.values(buses(routeId)).some(bus => bus.routeId === routeId)).toBe(true);
    }
  });

  it("recovers a lost publication acknowledgement from current source without a new child event", async () => {
    fixture.data.activeBuses = { bus1_route1: live() }; fixture.loseAcknowledgement.add(routePath("route1"));
    start(); emit("child_added", "bus1_route1", live()); await settle();
    expect(fixture.failures).toHaveBeenCalled(); await recover();
    expect(Object.values(buses("route1")).some(bus => bus.sessionId === "current")).toBe(true);
    expect(fixture.data.liveRouteCatalog.values[routeKey("route1")].active).toBe(1);
    expect(fixture.data.clientProjectionStatus.public.ready).toBe(true);
  });

  it.each([true, false])("repairs a stale catalog count before readiness when the empty destination exists=%j", async exists => {
    fixture.data.publicRouteBuses = exists ? { [routeKey("route1")]: { _workerGeneration: 3, revision: 5 } } : {};
    fixture.data.liveRouteCatalog = { _workerGeneration: 3, values: { [routeKey("route1")]: { active: 1, available: 2, freshestAt: 1, availableReceipts: [1] } }, revisions: { [routeKey("route1")]: 5 } };
    start(4); await recover();
    expect(fixture.data.liveRouteCatalog.values[routeKey("route1")]).toEqual({ active: 0, available: 0, freshestAt: 0, availableReceipts: [] });
    expect(fixture.data.liveRouteCatalog._workerGeneration).toBe(4);
    expect(projection("route1")._workerGeneration).toBe(4);
    expect(fixture.data.clientProjectionStatus.public.ready).toBe(true);
  });

  it("reconstructs missing destination availability from a live source despite an older catalog revision", async () => {
    fixture.data.activeBuses = { bus1_route1: live() };
    fixture.data.liveRouteCatalog = { _workerGeneration: 3, values: { [routeKey("route1")]: { active: 0, available: 2, freshestAt: 1, availableReceipts: [1] } }, revisions: { [routeKey("route1")]: 5 } };
    start(4); await recover();
    expect(fixture.data.liveRouteCatalog.values[routeKey("route1")]).toEqual({ active: 1, available: 0, freshestAt: 0, availableReceipts: [] });
    expect(projection("route1")._workerGeneration).toBe(4);
    expect(fixture.data.clientProjectionStatus.public.ready).toBe(true);
  });

  it.each([false, true])("reconstructs an erased same-generation destination with live source=%j", async sourceExists => {
    fixture.data.activeBuses = sourceExists ? { bus1_route1: live() } : {};
    fixture.data.liveRouteCatalog = { _workerGeneration: 4, generations: { [routeKey("route1")]: 4 }, values: { [routeKey("route1")]: { active: 8, available: 2, freshestAt: 1, availableReceipts: [1] } }, revisions: { [routeKey("route1")]: 5 } };
    start(4); await recover();
    expect(fixture.data.clientProjectionStatus.public.ready).toBe(true);
    expect(fixture.data.liveRouteCatalog.values[routeKey("route1")]).toEqual({ active: sourceExists ? 1 : 0, available: 0, freshestAt: 0, availableReceipts: [] });
    expect(projection("route1")._workerGeneration).toBe(4);
    expect(fixture.data.clientProjectionStatus.public.ready).toBe(true);
  });

  it("rejects a delayed lower catalog revision within the same generation", async () => {
    const previous = live("previous"), completed = { ...live("previous"), tripState: "completed", status: "completed" };
    fixture.data.activeBuses = { bus1_route1: completed };
    fixture.data.publicRouteBuses = { [routeKey("route1")]: { _workerGeneration: 4, revision: 4, buses: { "node:bus1_route1": publicLiveBus(previous) } } };
    fixture.data.liveRouteCatalog = { _workerGeneration: 4, generations: { [routeKey("route1")]: 4 }, revisions: { [routeKey("route1")]: 4 }, values: { [routeKey("route1")]: { active: 1, available: 0, freshestAt: 0, availableReceipts: [] } } };
    const release = gate(fixture.afterCommitGates, routePath("route1"));
    start(); emit("child_added", "bus1_route1", completed); await settle();
    expect(projection("route1").revision).toBe(5);
    // The SDK acknowledgement retains revision5's committed snapshot while a
    // newer publication has already made route+catalog revision6 authoritative.
    fixture.data.publicRouteBuses[routeKey("route1")] = { _workerGeneration: 4, revision: 6, buses: { "node:bus1_route1": publicLiveBus(live("replacement")) } };
    fixture.data.liveRouteCatalog.revisions[routeKey("route1")] = 6;
    release(); await settle();
    expect(fixture.data.liveRouteCatalog.revisions[routeKey("route1")]).toBe(6);
    expect(fixture.data.liveRouteCatalog.values[routeKey("route1")].active).toBe(1);
  });

  it("does not dispatch another replay read after stop during a reconstruction acknowledgement", async () => {
    fixture.data.liveRouteCatalog = { _workerGeneration: 4, generations: { [routeKey("route1")]: 4 }, revisions: { [routeKey("route1")]: 5 }, values: { [routeKey("route1")]: { active: 1, available: 0, freshestAt: 0 } } };
    const release = gate(fixture.afterCommitGates, routePath("route1"));
    start(); await recover(2000);
    expect(fixture.writes).toContain(routePath("route1"));
    const routePageReads = () => fixture.reads.filter(read => read.path === `${routePath("route1")}/buses`).length;
    const beforeStop = routePageReads(); const stopping = stop!();
    release(); await settle(); await stopping;
    expect(routePageReads()).toBe(beforeStop);
  });

  it("keeps a smaller-clock replacement after a delayed removed notification", async () => {
    const old = live("old"); fixture.data.activeBuses = { bus1_route1: old };
    start(); emit("child_added", "bus1_route1", old); await settle();
    const fresh = { ...live("fresh"), timestamp: 1 }; fixture.data.activeBuses.bus1_route1 = fresh;
    emit("child_changed", "bus1_route1", fresh); emit("child_removed", "bus1_route1", old); await settle();
    expect(Object.values(buses("route1")).some(bus => bus.sessionId === "fresh")).toBe(true);
    expect(Object.values(buses("route1")).some(bus => bus.sessionId === "old")).toBe(false);
  });

  it("repairs missing-history route reassignment and an unobserved removal after deterministic LRU eviction", async () => {
    // Exercise the real LRU implementation with a two-entry bound, rather than
    // filling a thousand large route transactions just to reach the same state.
    fixture.cacheLimit = 2;
    fixture.data.activeBuses = { bus1_route1: live("old") };
    start(); emit("child_added", "bus1_route1", live("old")); await settle();
    for (const busId of ["other1", "other2"]) {
      const key = `${busId}_route3`, value = live("other", "route3", busId);
      fixture.data.activeBuses[key] = value; emit("child_added", key, value); await settle();
    }
    expect(fixture.cacheBudgets.every(limit => limit === 1000)).toBe(true);
    // Route identity changed without a usable old child-removed delivery.
    delete fixture.data.activeBuses.bus1_route1;
    fixture.data.activeBuses.bus1_route2 = live("fresh", "route2");
    emit("child_added", "bus1_route2", fixture.data.activeBuses.bus1_route2);
    await recover(75_000);
    expect(Object.keys(buses("route1"))).toHaveLength(0);
    expect(Object.values(buses("route2")).some(bus => bus.sessionId === "fresh")).toBe(true);
    delete fixture.data.activeBuses.bus1_route2; await recover(75_000);
    expect(Object.keys(buses("route2"))).toHaveLength(0);
    expect(fixture.reads.filter(read => read.limit !== undefined).every(read => read.limit! <= 25)).toBe(true);
  });
});
