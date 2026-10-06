import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerFence } from "../lib/workerFence";
const fixture = vi.hoisted(() => ({ data: {} as Record<string, any>, listeners: new Map<string, (s: any) => void>(), reads: [] as { path: string; limit?: number }[], fail: false }));
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
    once: async () => { fixture.reads.push({ path, limit }); const value = read(path);
      return snapshot(limit ? Object.fromEntries(Object.entries(value ?? {}).filter(([k]) => k > after).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)) : structuredClone(value)); },
    transaction: async (update: (v: any) => any, _done: any, speculative: boolean) => {
      expect(speculative).toBe(false);
      if (fixture.fail) { fixture.fail = false; throw new Error("injected unavailable"); }
      const next = update(structuredClone(read(path)));
      if (next !== undefined) write(path, next);
      return { committed: next !== undefined, snapshot: snapshot(structuredClone(read(path))) };
    },
  });
  return { rtdb: { ref: (path: string) => reference(path) } };
});
import { getLiveBusProjectionStatus, publicLiveBus, routeAvailability, startLiveBusProjection } from "./liveBusProjection";
import { lifecycleIntakeFingerprint } from "./lifecycleIntake";
let stop: (() => Promise<void>) | undefined;
const live = (sessionId = "s1") => ({ busId: "bus1", routeId: "route1", sessionId, status: "active", tripState: "in_service", timestamp: Date.now(), lat: 23, lng: 72 });
const emit = (event: string, value: any) => fixture.listeners.get(event)?.({ key: "bus1_route1", val: () => value });
async function settle() { for (let n = 0; n < 40; n++) await Promise.resolve(); }
function start(generation = 1) { stop = new WorkerFence("test", generation, performance.now() + 100_000).run(startLiveBusProjection); }
beforeEach(() => { vi.useFakeTimers(); fixture.data = {}; fixture.listeners.clear(); fixture.reads = []; fixture.fail = false; });
afterEach(async () => { await stop?.(); stop = undefined; vi.useRealTimers(); });
describe("public live projection", () => {
  it("whitelists nested and scalar fields without history, claims or worker state", () => {
    expect(publicLiveBus({ ...live(), _workerGeneration: 9, recentSamples: [{ secret: true }], turnaroundClaimId: "private", telemetryRouteContext: { private: true },
      rawLocation: { lat: 23, secret: "private" }, matchedLocation: { lat: 24, history: [] } })).toEqual({ ...live(), rawLocation: { lat: 23 }, matchedLocation: { lat: 24 } });
    expect(publicLiveBus({ ...live(), routeId: "bad/path" })).toBeNull();
  });
  it("excludes matcher metadata from intake but retains same-fix lifecycle/session changes", () => {
    const input = live(); const fingerprint = lifecycleIntakeFingerprint(input);
    expect(lifecycleIntakeFingerprint({ ...input, recentSamples: [1], mapMatchSeq: 4, _workerGeneration: 2 })).toBe(fingerprint);
    for (const change of [{ sessionId: "s2" }, { tripState: "completed" }, { deviceState: "offline" }, { turnaroundClaimId: "new" }]) {
      expect(lifecycleIntakeFingerprint({ ...input, ...change })).not.toBe(fingerprint);
    }
  });
  it("counts active rides separately from fresh sessionless previews", () => {
    expect(routeAvailability({ active: live(), stale: { deviceState: "online", timestamp: 1 }, fresh: { deviceState: "online", timestamp: 600_001 }, done: { ...live(), tripState: "completed" } }, 600_001)).toEqual({ active: 1, available: 1, freshestAt: 600_000 });
  });
  it("re-reads authority instead of publishing a queued stale session and suppresses internal-only events", async () => {
    const old = live(); fixture.data.activeBuses = { bus1_route1: live("s2") }; start(); emit("child_changed", old); await settle();
    expect(fixture.data.publicRouteBuses.route1.buses.bus1_route1.sessionId).toBe("s2");
    emit("child_changed", { ...old, telemetryRouteContext: { retry: 7 } }); await settle();
    expect(getLiveBusProjectionStatus()).toMatchObject({ events: 2, skipped: 1, sourceReads: 1, committed: 1 });
    delete fixture.data.activeBuses.bus1_route1; emit("child_removed", old); await settle();
    expect(fixture.data.publicRouteBuses.route1.buses).toEqual({});
    expect(fixture.data.liveRouteCatalog.values.route1.active).toBe(0);
  });
  it("periodically repairs failed publication and orphaned removals using bounded pages", async () => {
    fixture.data.activeBuses = { bus1_route1: live() }; fixture.fail = true; start(); emit("child_changed", live()); await settle();
    await vi.advanceTimersByTimeAsync(4000); await settle();
    expect(fixture.data.publicRouteBuses.route1.buses.bus1_route1.sessionId).toBe("s1");
    delete fixture.data.activeBuses.bus1_route1;
    await vi.advanceTimersByTimeAsync(65_000); await settle();
    expect(fixture.data.publicRouteBuses.route1.buses).toEqual({});
    expect(fixture.reads.filter(r => r.limit).every(r => r.limit! <= 25)).toBe(true);
  });
  it("cannot overwrite a newer generation's public state", async () => {
    fixture.data.activeBuses = { bus1_route1: live("old") };
    fixture.data.publicRouteBuses = { route1: { _workerGeneration: 10, revision: 5, buses: { bus1_route1: live("new") } } };
    fixture.data.liveRouteCatalog = { _workerGeneration: 10, values: { route1: { active: 1, available: 0, freshestAt: 0 } } };
    start(9); emit("child_changed", live("old")); await settle();
    expect(fixture.data.publicRouteBuses.route1.buses.bus1_route1.sessionId).toBe("new");
    expect(fixture.data.publicRouteBuses.route1.revision).toBe(5);
  });
});
