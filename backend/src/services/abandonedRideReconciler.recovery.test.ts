import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/firebaseAdmin", () => ({ db: {}, rtdb: {} }));
import { runAbandonedRideReconciliation } from "./abandonedRideReconciler";

const now = 1_800_000_000_000;
const old = now - 13 * 60 * 60 * 1000;
const SAFE_DOC = (id: string) => { if (!id || id.includes("/")) throw new Error(`invalid doc path ${id}`); };
const SAFE_RTDB = (path: string) => { if (/[.#$[\]]/.test(path)) throw new Error(`Invalid RTDB path ${path}`); };

function store(docs: Record<string, Record<string, any>>, live: Record<string, any>, opts: { failTx?: number } = {}) {
  let failTx = opts.failTx ?? 0;
  const ref = (collection: string, id: string) => {
    SAFE_DOC(id);
    return { collection, id, get: async () => snap(collection, id) };
  };
  const snap = (collection: string, id: string) => {
    const value = docs[collection]?.[id];
    return { id, exists: value !== undefined, data: () => (value === undefined ? undefined : structuredClone(value)) };
  };
  const sessionQuery: any = {
    where: () => sessionQuery, orderBy: () => sessionQuery, limit: () => sessionQuery, startAfter: () => sessionQuery,
    get: async () => {
      const list = Object.entries(docs.ride_sessions ?? {}).filter(([, v]) => ["pending", "armed", "active"].includes(v.status))
        .sort(([a], [b]) => a.localeCompare(b)).map(([id]) => snap("ride_sessions", id));
      return { docs: list, size: list.length };
    },
  };
  const firestore: any = {
    collection: (name: string) => ({
      ...sessionQuery,
      doc: (id: string) => ref(name, id),
    }),
    runTransaction: async (callback: any) => {
      if (failTx-- > 0) throw new Error("transient firestore");
      const writes: Array<() => void> = [];
      const result = await callback({
        get: async (r: any) => snap(r.collection, r.id),
        set: (r: any, data: any) => writes.push(() => { docs[r.collection] ??= {}; docs[r.collection][r.id] = { ...(docs[r.collection][r.id] ?? {}), ...data }; }),
        delete: (r: any) => writes.push(() => { delete docs[r.collection]?.[r.id]; }),
      });
      writes.forEach(write => write());
      return result;
    },
  };
  const realtimeDatabase: any = {
    ref: (path: string) => {
      SAFE_RTDB(path);
      const key = path.replace("activeBuses/", "");
      return {
        once: async () => ({ val: () => structuredClone(live[key] ?? null) }),
        transaction: async (update: any) => {
          const next = update(structuredClone(live[key] ?? null));
          if (next === undefined) return { committed: false, snapshot: { val: () => live[key] ?? null } };
          if (next === null) delete live[key]; else live[key] = next;
          return { committed: true, snapshot: { val: () => live[key] ?? null } };
        },
      };
    },
  };
  return { firestore, realtimeDatabase };
}

const session = (busId: string, extra: Record<string, any> = {}) => ({ status: "active", busId, routeId: "r1", driverId: "d1", updatedAt: old, ...extra });

describe("abandoned reconciler recovery", () => {
  it.each(["bus.1", "a/b", ""])("one malformed session busId %j does not poison the page", async badBus => {
    const docs: any = { ride_sessions: { s0: session(badBus), s1: session("bus1") }, _active_bus_locks: { bus1: { sessionId: "s1" } } };
    const s = store(docs, {});
    const summary = await runAbandonedRideReconciliation({ ...s, now });
    expect(summary.interruptedIds).toEqual(["s1"]);
    expect(summary.skippedIds).toEqual(["s0"]);
    expect(docs._active_bus_locks.bus1).toBeUndefined();
  });

  it("keeps a newer session's lock and live node", async () => {
    const docs: any = { ride_sessions: { s1: session("bus1") }, _active_bus_locks: { bus1: { sessionId: "s2" } } };
    const live = { bus1_r1: { sessionId: "s2", timestamp: now } };
    const s = store(docs, live);
    const summary = await runAbandonedRideReconciliation({ ...s, now });
    expect(summary.interruptedIds).toEqual(["s1"]);
    expect(docs._active_bus_locks.bus1).toEqual({ sessionId: "s2" });
    expect(live.bus1_r1).toBeDefined();
  });

  it("recovers on the next run after a transient Firestore failure post RTDB retirement", async () => {
    const docs: any = { ride_sessions: { s1: session("bus1") }, _active_bus_locks: { bus1: { sessionId: "s1" } },
      active_rides: { bus1_r1: { sessionId: "s1", updatedAt: old } } };
    const live: any = { bus1_r1: { sessionId: "s1", timestamp: old } };
    const s = store(docs, live, { failTx: 1 });
    await expect(runAbandonedRideReconciliation({ ...s, now })).rejects.toThrow("transient");
    const summary = await runAbandonedRideReconciliation({ ...s, now });
    expect(summary.interruptedIds).toEqual(["s1"]);
    expect(docs._active_bus_locks.bus1).toBeUndefined();
    expect(docs.active_rides.bus1_r1).toBeUndefined();
    expect(docs.ride_sessions.s1.status).toBe("interrupted");
  });

  it("protects a session with recent live activity", async () => {
    const docs: any = { ride_sessions: { s1: session("bus1") }, _active_bus_locks: { bus1: { sessionId: "s1" } } };
    const live: any = { bus1_r1: { sessionId: "s1", timestamp: now - 1000 } };
    const s = store(docs, live);
    const summary = await runAbandonedRideReconciliation({ ...s, now });
    expect(summary.protectedIds).toEqual(["s1"]);
    expect(docs.ride_sessions.s1.status).toBe("active");
  });
});
