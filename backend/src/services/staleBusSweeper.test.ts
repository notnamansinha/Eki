import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reference } from "firebase-admin/database";
import { WorkerFence } from "../lib/workerFence";
import { createStaleBusSweeper } from "./staleBusSweeper";
function fixture(values: Record<string, any>) {
  const data = structuredClone(values); const reads: any[] = [];
  const state = { beforeWrite: ((_key: string) => { void _key; }), failKey: "", cold: false, readFail: false };
  const errors = vi.fn(); let now = 100_000;
  const snapshot = (key: string, value: any): any => ({ key, val: () => structuredClone(value), exists: () => value !== null,
    ref: { transaction: async (update: (v: any) => any, _callback: any, speculative: boolean) => {
      expect(speculative).toBe(false); await Promise.resolve(); state.beforeWrite(key);
      if (state.failKey === key) { state.failKey = ""; throw Error("injected write failure"); }
      if (state.cold) expect(update(null)).toBeNull();
      const next = update(structuredClone(data[key] ?? null));
      if (next !== undefined) { if (next === null) delete data[key]; else data[key] = next; }
      return { committed: next !== undefined, snapshot: snapshot(key, data[key] ?? null) };
    } } });
  const query = (options: any = {}): any => ({
    startAt: (start: number) => query({ ...options, start }),
    startAfter: (after: number, key: string) => query({ ...options, after, key }),
    endAt: (end: number) => query({ ...options, end }),
    limitToFirst: (limit: number) => query({ ...options, limit }),
    once: async () => {
      reads.push(options); if (state.readFail) { state.readFail = false; throw Error("injected read failure"); }
      const rows = Object.entries(data).filter(([key, value]) => typeof value.timestamp === "number" && value.timestamp >= (options.start ?? 0) &&
        value.timestamp <= options.end && (options.after === undefined || value.timestamp > options.after || (value.timestamp === options.after && key > options.key)))
        .sort(([a, av], [b, bv]) => av.timestamp - bv.timestamp || a.localeCompare(b)).slice(0, options.limit);
      return { forEach: (fn: (s: any) => void) => rows.forEach(([key, value]) => fn(snapshot(key, structuredClone(value)))) };
    },
  });
  const source = { orderByChild: vi.fn((field: string) => { expect(field).toBe("timestamp"); return query(); }) } as unknown as Reference;
  const sweeper = createStaleBusSweeper(source, 1000, errors, () => now);
  return { data, reads, state, errors, sweeper, advance: (ms: number) => { now += ms; } };
}
afterEach(() => vi.restoreAllMocks());
describe("bounded indexed stale scan", () => {
  it("advances a timestamp/key cursor through deletions, excluding fresh and malformed records", async () => {
    const values: Record<string, any> = {};
    for (let i=0;i<52;i++) values[`old_${String(i).padStart(3,"0")}`] = { timestamp: 1, status: "offline" };
    for (let i=0;i<1000;i++) values[`fresh_${i}`] = { timestamp: 100_000, status: "offline" };
    values.malformed = { timestamp: "wrong", status: "offline" };
    const f = fixture(values);
    await f.sweeper.tick(); expect(f.sweeper.snapshot()).toMatchObject({ examined: 25, removed: 25, hasMore: true });
    await f.sweeper.tick(); await f.sweeper.tick();
    expect(f.sweeper.snapshot()).toMatchObject({ examined: 52, removed: 52, cycles: 1, maxPageRecords: 25, maxActiveWrites: 4 });
    expect(f.reads[1]).toMatchObject({ after: 1, key: "old_024", limit: 25, end: 99_000 });
    expect(Object.keys(f.data)).toHaveLength(1001);
    await f.sweeper.tick(); expect(f.reads).toHaveLength(3);
  });
  it("retains stale active rides, traversing unchanged timestamp ties without restarting the first page", async () => {
    const f = fixture(Object.fromEntries(Array.from({length:26}, (_,i) => [`ride_${String(i).padStart(3,"0")}`, {
      timestamp: 1, status: "active", tripState: "in_service", sessionId: `s${i}`, deviceState: "online" }] )));
    await f.sweeper.tick(); await f.sweeper.tick();
    expect(f.sweeper.snapshot()).toMatchObject({ markedOffline: 26, removed: 0, examined: 26, cycles: 1 });
    expect(Object.values(f.data).every(value => value.deviceState === "offline" && value.status === "active" && value.sessionId)).toBe(true);
  });
  it.each(["session", "completion", "fresh-fix", "same-time-seq"])("preserves concurrent authority: %s", async mode => {
    const original = { timestamp: 1, seq: 1, status: mode === "session" ? "offline" : "active", tripState: "in_service", sessionId: "old", deviceState: "online" };
    const f = fixture({ bus: original });
    f.state.beforeWrite = key => { f.data[key] = { ...original, ...(mode === "session" ? { sessionId: "new", status: "active" } :
      mode === "completion" ? { tripState: "completed" } : mode === "fresh-fix" ? { timestamp: 100_000 } : { seq: 2 }) }; };
    await f.sweeper.tick();
    expect(f.data.bus.deviceState).toBe("online"); expect(f.sweeper.snapshot()).toMatchObject({ aborted: 1, markedOffline: 0, removed: 0 });
  });
  it("fetches canonical authority on a cold transaction cache and rejects a newer worker generation", async () => {
    const f = fixture({ bus: { timestamp: 1, status: "active", tripState: "in_service", sessionId: "s", _workerGeneration: 10 } });
    f.state.cold = true;
    await new WorkerFence("old", 9, performance.now()+1000).run(() => f.sweeper.tick());
    expect(f.data.bus.deviceState).toBeUndefined(); expect(f.sweeper.snapshot().aborted).toBe(1);
  });
  it("retries a partially failed page before advancing and backs off failed reads", async () => {
    const f = fixture(Object.fromEntries(Array.from({length:26}, (_,i) => [`old_${String(i).padStart(3,"0")}`, { timestamp: 1, status: "offline" }] )));
    f.state.failKey = "old_010"; await f.sweeper.tick();
    expect(f.sweeper.snapshot()).toMatchObject({ failed: 1, cycles: 0, hasMore: true });
    await f.sweeper.tick(); expect(f.reads).toHaveLength(1);
    f.advance(1000); await f.sweeper.tick(); expect(Object.keys(f.data)).toHaveLength(0);
    expect(f.reads[1].after).toBeUndefined();
    f.advance(1000); f.state.readFail = true; await f.sweeper.tick();
    f.advance(500); await f.sweeper.tick(); expect(f.reads).toHaveLength(3);
    f.advance(500); await f.sweeper.tick(); expect(f.reads).toHaveLength(4);
  });
  it("stops new writes and pages after shutdown", async () => {
    const f = fixture({ bus: { timestamp: 1, status: "offline" } });
    const pending = f.sweeper.tick(); f.sweeper.stop(); await pending;
    expect(f.data.bus).toBeDefined(); await f.sweeper.tick(); expect(f.reads).toHaveLength(1);
  });
});
