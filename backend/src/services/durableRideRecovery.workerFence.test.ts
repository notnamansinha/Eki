import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: queued durable restores are started from another restore's
// `.finally`, and same-node callers share one in-flight restore. Each must
// still run under its own caller's AsyncLocalStorage worker fence.
const store = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  nodes: new Map<string, Record<string, unknown>>(),
  beforeRead: undefined as (() => Promise<void>) | undefined,
  writes: [] as string[],
}));
vi.mock("../lib/firebaseAdmin", () => ({
  db: {
    collection: (collection: string) => ({ doc: (id: string) => ({ path: `${collection}/${id}` }) }),
    runTransaction: async (work: (transaction: unknown) => unknown) => work({
      get: async (ref: { path: string }) => {
        if (ref.path.startsWith("active_rides/")) await store.beforeRead?.();
        const value = store.documents.get(ref.path);
        return { exists: value !== undefined, data: () => value };
      },
    }),
  },
  rtdb: { ref: (path: string) => ({ transaction: async (update: (value: unknown) => Record<string, unknown> | undefined) => {
    const value = update(store.nodes.get(path) ?? null);
    if (value !== undefined) { store.nodes.set(path, value); store.writes.push(path); }
    return { committed: value !== undefined, snapshot: { val: () => store.nodes.get(path) ?? null } };
  } }) },
}));
import { restoreDurableRide, drainDurableRideRecovery } from "./durableRideRecovery";
import { WorkerFence, WorkerLeadershipExpired, WORKER_LEASE_ID } from "../lib/workerFence";

let sequence = 0;
function ride() {
  const assignment = { busId: `attack_bus_${++sequence}`, routeId: "route" };
  const key = `${assignment.busId}_route`;
  const sessionId = `session_${sequence}`;
  store.documents.set(`active_rides/${key}`, {
    ...assignment, sessionId, driverId: "driver", status: "active", tripState: "in_service",
    direction: "forward", currentStopIndex: 1, hasDepartedOrigin: true,
  });
  store.documents.set(`_active_bus_locks/${assignment.busId}`, { ...assignment, sessionId, driverId: "driver" });
  store.documents.set(`ride_sessions/${sessionId}`, { ...assignment, driverId: "driver", status: "active" });
  return { assignment, key };
}
function lease(ownerId: string, generation: number) {
  store.documents.set(`_worker_leases/${WORKER_LEASE_ID}`, {
    ownerId, generation, expiresAt: { toMillis: () => Date.now() + 60_000 },
  });
}

beforeEach(() => { store.documents.clear(); store.nodes.clear(); store.writes = []; store.beforeRead = undefined; });

describe("durable restore queue keeps each caller's worker fence", () => {
  it("a fenced-out worker restore queued behind HTTP restores must not write unfenced", async () => {
    lease("old-leader", 7);
    const oldFence = new WorkerFence("old-leader", 7, performance.now() + 60_000);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.beforeRead = () => gate;
    // 16 HTTP-path restores (no fence) fill every active slot.
    const http = Array.from({ length: 16 }, () => restoreDurableRide(ride().assignment));
    // The worker queues one restore under its fence.
    const fencedRide = ride();
    const fenced = oldFence.run(() => restoreDurableRide(fencedRide.assignment));
    // Leadership moves to another process before the queued work starts.
    oldFence.revoke(); lease("new-leader", 8);
    release();
    await Promise.allSettled(http);
    const outcome = await fenced.then(value => ({ value }), error => ({ error }));
    await drainDurableRideRecovery();
    // Correct: the revoked fence rejects the worker's write.
    expect(outcome).toMatchObject({ error: expect.any(WorkerLeadershipExpired) });
    expect(store.writes).not.toContain(`activeBuses/${fencedRide.key}`);
  });

  it("an HTTP restore queued behind a revoked worker's restores still succeeds", async () => {
    lease("old-leader", 7);
    const oldFence = new WorkerFence("old-leader", 7, performance.now() + 60_000);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.beforeRead = () => gate;
    const fenced = oldFence.run(() => Array.from({ length: 16 }, () => restoreDurableRide(ride().assignment)));
    const httpRide = ride();
    const http = restoreDurableRide(httpRide.assignment); // device telemetry path: no worker fence
    oldFence.revoke(); lease("new-leader", 8);
    release();
    await Promise.allSettled(fenced);
    const outcome = await http.then(value => ({ value }), error => ({ error: String(error) }));
    await drainDurableRideRecovery();
    expect(outcome).toEqual({ value: true });
    expect(store.nodes.get(`activeBuses/${httpRide.key}`)).toMatchObject({ status: "active", tripState: "in_service" });
  });

  it("an HTTP restore deduplicated onto a revoked worker's in-flight restore of the same node still succeeds", async () => {
    lease("old-leader", 7);
    const oldFence = new WorkerFence("old-leader", 7, performance.now() + 60_000);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.beforeRead = () => gate;
    const shared = ride();
    const fenced = oldFence.run(() => restoreDurableRide(shared.assignment));
    const http = restoreDurableRide(shared.assignment);
    oldFence.revoke(); lease("new-leader", 8);
    release();
    await fenced.catch(() => undefined);
    const outcome = await http.then(value => ({ value }), error => ({ error: String(error) }));
    expect(outcome).toEqual({ value: true });
  });
});
