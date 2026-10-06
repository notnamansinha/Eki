import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rtdbHandlers = new Map<string, (snapshot: any) => void>();
  const routeListeners: Array<{
    next: (snapshot: any) => void;
    error: (error: unknown) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }> = [];
  const documentSet = vi.fn(async () => undefined);
  const routeDocumentGet = vi.fn(async () => ({ exists: false, data: () => undefined }));
  const batchSet = vi.fn();
  const batchDelete = vi.fn();
  const batchCommit = vi.fn(async () => undefined);
  const transactionDelete = vi.fn();
  const transactionSet = vi.fn();
  const transactionCreate = vi.fn();
  const transactionGet = vi.fn(async () => ({ exists: false, data: () => undefined }));
  const reduceTripState = vi.fn();
  const replayRead = vi.fn(async () => ({ forEach: vi.fn() }));
  const replayQuery: any = { once: replayRead };
  replayQuery.startAfter = vi.fn(() => replayQuery);
  replayQuery.limitToFirst = vi.fn(() => replayQuery);
  const fleetRead = vi.fn(async () => ({ docs: [], size: 0 }));
  const fleetQuery: any = { get: fleetRead };
  fleetQuery.startAfter = vi.fn(() => fleetQuery);
  fleetQuery.limit = vi.fn(() => fleetQuery);

  const busesRef = {
    orderByKey: vi.fn(() => replayQuery),
    on: vi.fn((event: string, handler: (snapshot: any) => void) => {
      rtdbHandlers.set(event, handler);
    }),
    off: vi.fn((event: string) => {
      rtdbHandlers.delete(event);
    }),
    once: vi.fn(async () => ({ forEach: vi.fn() })),
  };
  const db = {
    collection: vi.fn((name: string) => ({
      orderBy: vi.fn(() => fleetQuery),
      onSnapshot: name === "routes"
        ? vi.fn((next: (snapshot: any) => void, error: (error: unknown) => void) => {
            const unsubscribe = vi.fn();
            routeListeners.push({ next, error, unsubscribe });
            return unsubscribe;
          })
        : undefined,
      doc: (id?: string) => ({
        collectionName: name,
        id: id ?? "generated-session",
        get: name === "routes" ? routeDocumentGet : undefined,
        set: (data: unknown, options: unknown) => documentSet(name, id, data, options),
      }),
    })),
    batch: vi.fn(() => ({
      set: batchSet,
      delete: batchDelete,
      commit: batchCommit,
    })),
    runTransaction: vi.fn(async (operation: (transaction: any) => unknown) =>
      operation({
        delete: transactionDelete,
        create: transactionCreate,
        get: transactionGet,
        set: transactionSet,
      }),
    ),
  };

  return {
    batchCommit,
    batchDelete,
    batchSet,
    busesRef,
    db,
    documentSet,
    reduceTripState,
    replayRead,
    replayQuery,
    fleetRead,
    routeDocumentGet,
    routeListeners,
    rtdbHandlers,
    transactionDelete,
    transactionCreate,
    transactionGet,
    transactionSet,
  };
});

vi.mock("../lib/firebaseAdmin", () => ({
  db: mocks.db,
  rtdb: { ref: vi.fn(() => mocks.busesRef) },
}));

vi.mock("./tripStateReducer", () => ({
  reduceTripState: mocks.reduceTripState,
  STOP_GEOFENCE_M: 20,
}));
vi.mock("./durableRideRecovery", () => ({ restoreDurableRide: vi.fn(async () => false) }));

import { getTripStateQueueStatus, lifecycleDirection, startTripStateEngine } from "./tripStateEngine";
import { restoreDurableRide } from "./durableRideRecovery";
import { WorkerFence } from "../lib/workerFence";

async function flushMicrotasks(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function allowCompletion(sessionId: string): void {
  mocks.transactionGet.mockImplementation(async (ref: { collectionName?: string }) => {
    if (ref.collectionName === "_active_bus_locks") {
      return { exists: true, data: () => ({ sessionId }) };
    }
    if (ref.collectionName === "ride_sessions") {
      return { exists: true, data: () => ({ status: "active" }) };
    }
    return { exists: false, data: () => undefined };
  });
}

describe("trip-state engine lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(restoreDurableRide).mockResolvedValue(false);
    mocks.transactionSet.mockReset();
    mocks.transactionDelete.mockReset();
    mocks.routeListeners.length = 0;
    mocks.rtdbHandlers.clear();
    mocks.routeDocumentGet.mockResolvedValue({ exists: false, data: () => undefined });
    mocks.transactionGet.mockResolvedValue({ exists: false, data: () => undefined });
    mocks.reduceTripState.mockReturnValue({
      tripState: "completed",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
    });
    mocks.replayRead.mockResolvedValue({ forEach: vi.fn() });
    mocks.fleetRead.mockResolvedValue({ docs: [], size: 0 });
    mocks.busesRef.once.mockResolvedValue({ forEach: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters matcher-only changes before they occupy lifecycle queue capacity", async () => {
    let release!: (value: any) => void;
    mocks.routeDocumentGet.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const stop = startTripStateEngine();
    const before = getTripStateQueueStatus().filteredLifecycleEvents;
    const input = { busId: "r14_bus", routeId: "r14_route", status: "active", sessionId: "s1", timestamp: 1 };
    const emit = (value: unknown) => mocks.rtdbHandlers.get("child_changed")!({ key: "r14_bus_r14_route", val: () => value });
    emit(input); await flushMicrotasks();
    for (let i = 0; i < 10; i++) emit({ ...input, mapMatchSeq: i, routeMatchHistory: [i], _workerGeneration: i });
    expect(getTripStateQueueStatus().intake).toMatchObject({ active: 1, pending: 0 });
    expect(getTripStateQueueStatus().filteredLifecycleEvents - before).toBe(10);
    release({ exists: false, data: () => undefined }); await flushMicrotasks(); await stop();
  });

  it("bounds live intake during a route-read stall and recovers rejected current state from RTDB", async () => {
    let release!: (value: any) => void;
    mocks.routeDocumentGet.mockReturnValue(new Promise(done => { release = done; }));
    const sample = (i: number) => ({ key: `bounded_${i}_route`, val: () => ({
      busId: `bounded_${i}`, routeId: `route_bound_${i}`, sessionId: `session_bound_${i}`,
      driverId: "driver", direction: null, lat: 23, lng: 72, status: "active", tripState: "pre_departure",
    }) });
    mocks.transactionGet.mockImplementation(async (ref: any) => ({ exists: true, data: () => ({
      sessionId: `session_bound_${String(ref.id).replace("bounded_", "")}`,
    }) }));
    const stop = startTripStateEngine();
    const handler = mocks.rtdbHandlers.get("child_changed")!;
    for (let i = 0; i < 300; i++) handler(sample(i));
    await flushMicrotasks();
    expect(getTripStateQueueStatus().intake).toMatchObject({ active: 8, pending: 256, keys: 264 });
    expect(mocks.routeDocumentGet).toHaveBeenCalledTimes(8);
    expect(getTripStateQueueStatus().recovery.requested).toBe(true);
    release({ exists: false, data: () => undefined });
    await flushMicrotasks(600);
    expect(getTripStateQueueStatus().intake).toMatchObject({ active: 0, pending: 0 });
    mocks.replayRead.mockResolvedValue({ forEach: vi.fn(callback => callback(sample(299))) });
    await vi.advanceTimersByTimeAsync(1_000); await flushMicrotasks(60);
    expect(mocks.replayQuery.limitToFirst).toHaveBeenCalledWith(25);
    expect(mocks.transactionSet.mock.calls.some(([ref]) => ref.collectionName === "bus_locations" && ref.id === "bounded_299")).toBe(true);
    await stop();
  });

  it.each(["missing", "new-owner", "returned"])("recovers removed presence safely: %s", async mode => {
    const stop = startTripStateEngine();
    mocks.transactionGet.mockRejectedValueOnce(Error("trigger recovery"));
    mocks.rtdbHandlers.get("child_removed")!({ key: "replay_trigger_route", val: () => ({
      busId: "replay_trigger", routeId: "route", sessionId: "trigger", status: "active",
    }) });
    await flushMicrotasks();
    const data = { sessionId: "old-session", routeId: "replay_route", driverId: "old-driver", status: "active" };
    mocks.fleetRead.mockResolvedValue({ docs: [{ id: `replay_${mode}`, data: () => data }] as any, size: 1 });
    mocks.busesRef.once.mockResolvedValue({ exists: () => mode === "returned", forEach: vi.fn() } as any);
    mocks.transactionGet.mockImplementation(async (ref: any) => ({ exists: true, data: () =>
      ref.collectionName === "_active_bus_locks"
        ? { sessionId: "old-session", routeId: mode === "new-owner" ? "new-route" : "replay_route", driverId: "old-driver" }
        : data }));
    mocks.transactionSet.mockClear();
    await vi.advanceTimersByTimeAsync(2_000); await flushMicrotasks(60);
    const writes = mocks.transactionSet.mock.calls.filter(([ref]) => ref.id === `replay_${mode}`);
    if (mode === "missing") expect(writes).toHaveLength(1);
    else expect(writes).toHaveLength(0);
    if (mode === "missing") expect(writes[0][1]).toMatchObject({ status: "offline", sessionId: "old-session" });
    await stop();
  });

  it("does not admit a removed-node event through a revoked leader listener", async () => {
    const leader = new WorkerFence("leader", 1, performance.now() + 40_000);
    const stop = leader.run(() => startTripStateEngine());
    leader.revoke();
    // Deliberately emit outside the AsyncLocalStorage registration context.
    mocks.rtdbHandlers.get("child_removed")!({ key: "bus_1_route_2", val: () => ({
      busId: "bus_1", routeId: "route_2", driverId: "driver-1", sessionId: "session-1",
      direction: "forward", status: "active", tripState: "in_service",
    }) });
    await flushMicrotasks();
    expect(mocks.db.runTransaction).not.toHaveBeenCalled();
    await stop();
  });

  it("rejects queued fleet persistence after the Firestore lease generation changes", async () => {
    mocks.transactionGet.mockResolvedValue({ exists: true, data: () => ({
      ownerId: "replacement", generation: 2, expiresAt: { toMillis: () => Date.now() + 45_000 },
    }) });
    const leader = new WorkerFence("leader", 1, performance.now() + 40_000);
    const stop = leader.run(() => startTripStateEngine());
    mocks.rtdbHandlers.get("child_removed")!({ key: "bus_1_route_2", val: () => ({
      busId: "bus_1", routeId: "route_2", driverId: "driver-1", sessionId: "session-1",
      direction: "forward", status: "active", tripState: "in_service",
    }) });
    await flushMicrotasks();
    expect(mocks.db.runTransaction).toHaveBeenCalledOnce();
    expect(mocks.transactionSet).not.toHaveBeenCalled();
    await stop();
  });

  it("reattaches a terminal route listener error and cancels retries on stop", async () => {
    const stop = startTripStateEngine();
    expect(mocks.routeListeners).toHaveLength(1);

    mocks.routeListeners[0].error(new Error("terminal watch failure"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.routeListeners).toHaveLength(2);

    await stop();
    expect(mocks.routeListeners[1].unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs pending completion retirement immediately during shutdown", async () => {
    allowCompletion("session-1");
    const stop = startTripStateEngine();
    mocks.routeListeners[0].next({
      docChanges: () => [{
        type: "added",
        doc: {
          id: "route_2",
          data: () => ({
            stops: [
              { id: "origin", name: "Origin", lat: 23, lng: 72 },
              { id: "destination", name: "Destination", lat: 23.1, lng: 72.1 },
            ],
          }),
        },
      }],
    });

    const transaction = vi.fn(async (update: (value: unknown) => unknown) => {
      const value = { tripState: "completed", sessionId: "session-1" };
      const result = update(value);
      return {
        committed: result !== undefined,
        snapshot: { val: () => result ?? value },
      };
    });
    const snapshot = {
      key: "bus_1_route_2",
      val: () => ({
        busId: " bus_1 ",
        routeId: " route_2 ",
        driverId: "driver-1",
        sessionId: "session-1",
        direction: "forward",
        status: "active",
        tripState: "in_service",
        currentStopIndex: 0,
        lat: 23.1,
        lng: 72.1,
        timestamp: 1,
      }),
      ref: {
        update: vi.fn(async () => undefined),
        transaction,
      },
    };

    mocks.rtdbHandlers.get("child_changed")!(snapshot);
    await flushMicrotasks();
    expect(mocks.db.runTransaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledOnce();

    await stop();

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(mocks.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "bus_locations", id: "bus_1" }),
      expect.objectContaining({
        routeId: "route_2",
        status: "offline",
        tripState: "completed",
      }),
      { merge: true },
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overwrite a concurrent manual interruption with stale completion", async () => {
    mocks.transactionGet.mockImplementation(async (ref: { collectionName?: string }) => {
      if (ref.collectionName === "_active_bus_locks") {
        return { exists: true, data: () => ({ sessionId: "session-1" }) };
      }
      if (ref.collectionName === "ride_sessions") {
        return { exists: true, data: () => ({ status: "interrupted" }) };
      }
      return { exists: false, data: () => undefined };
    });
    const stop = startTripStateEngine();
    mocks.routeListeners[0].next({
      docChanges: () => [{
        type: "added",
        doc: {
          id: "route_2",
          data: () => ({
            stops: [
              { id: "origin", name: "Origin", lat: 23, lng: 72 },
              { id: "destination", name: "Destination", lat: 23.1, lng: 72.1 },
            ],
          }),
        },
      }],
    });
    const liveTransaction = vi.fn();

    mocks.rtdbHandlers.get("child_changed")!({
      key: "bus_1_route_2",
      val: () => ({
        busId: "bus_1",
        routeId: "route_2",
        driverId: "driver-1",
        sessionId: "session-1",
        direction: "forward",
        status: "active",
        tripState: "in_service",
        currentStopIndex: 0,
        lat: 23.1,
        lng: 72.1,
        timestamp: 1,
      }),
      ref: { update: vi.fn(), transaction: liveTransaction },
    });
    await flushMicrotasks();

    expect(liveTransaction).not.toHaveBeenCalled();
    expect(mocks.transactionSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "completed_trips" }),
      expect.anything(),
      expect.anything(),
    );
    await stop();
  });

  it("negative-caches a missing route across telemetry updates", async () => {
    mocks.reduceTripState.mockReturnValue({
      tripState: "in_service",
      currentStopIndex: 0,
      hasDepartedOrigin: true,
    });
    const stop = startTripStateEngine();
    const snapshot = {
      key: "bus_1_missing_route",
      val: () => ({
        busId: "bus_1",
        routeId: "missing_route",
        status: "active",
        tripState: "in_service",
        currentStopIndex: 0,
        hasDepartedOrigin: true,
        lat: 23,
        lng: 72,
        timestamp: 1,
      }),
      ref: {
        update: vi.fn(async () => undefined),
        transaction: vi.fn(async () => undefined),
      },
    };

    mocks.rtdbHandlers.get("child_changed")!(snapshot);
    await flushMicrotasks();
    mocks.rtdbHandlers.get("child_changed")!({
      ...snapshot,
      val: () => ({ ...snapshot.val(), timestamp: 2 }),
    });
    await flushMicrotasks();

    expect(mocks.routeDocumentGet).toHaveBeenCalledOnce();
    await stop();
  });

  it("preserves a newer durable delay when an older live projection arrives late", async () => {
    mocks.reduceTripState.mockReturnValue({
      tripState: "in_service",
      currentStopIndex: 0,
      hasDepartedOrigin: true,
    });
    mocks.transactionGet.mockImplementation(async (ref: { collectionName?: string }) => {
      if (ref.collectionName === "_active_bus_locks") {
        return { exists: true, data: () => ({ sessionId: "session-1" }) };
      }
      if (ref.collectionName === "active_rides") {
        return {
          exists: true,
          data: () => ({
            sessionId: "session-1",
            delayMinutes: 15,
            delayUpdatedAt: 200,
          }),
        };
      }
      return { exists: false, data: () => undefined };
    });
    const stop = startTripStateEngine();
    mocks.routeListeners[0].next({
      docChanges: () => [{
        type: "added",
        doc: {
          id: "route_2",
          data: () => ({
            stops: [
              { id: "origin", name: "Origin", lat: 23, lng: 72 },
              { id: "destination", name: "Destination", lat: 23.1, lng: 72.1 },
            ],
          }),
        },
      }],
    });
    mocks.rtdbHandlers.get("child_changed")!({
      key: "bus_1_route_2",
      val: () => ({
        busId: "bus_1",
        routeId: "route_2",
        driverId: "driver-1",
        sessionId: "session-1",
        direction: "forward",
        status: "active",
        tripState: "in_service",
        currentStopIndex: 0,
        hasDepartedOrigin: true,
        delayMinutes: 5,
        delayUpdatedAt: 100,
        lat: 23.05,
        lng: 72.05,
        timestamp: 1,
      }),
      ref: {
        update: vi.fn(async () => undefined),
        transaction: vi.fn(async () => undefined),
      },
    });
    await flushMicrotasks();

    expect(mocks.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "active_rides", id: "bus_1_route_2" }),
      expect.objectContaining({ delayMinutes: 15, delayUpdatedAt: 200 }),
      { merge: true },
    );
    await stop();
  });

  it("does not retire a replacement session when completion cleanup already started", async () => {
    allowCompletion("session-1");
    const stop = startTripStateEngine();
    mocks.routeListeners[0].next({
      docChanges: () => [{
        type: "added",
        doc: {
          id: "route_2",
          data: () => ({
            stops: [
              { id: "origin", name: "Origin", lat: 23, lng: 72 },
              { id: "destination", name: "Destination", lat: 23.1, lng: 72.1 },
            ],
          }),
        },
      }],
    });
    let liveValue: Record<string, unknown> = {
      tripState: "in_service",
      sessionId: "session-1",
    };
    const transaction = vi.fn(async (update: (value: unknown) => unknown) => {
      const result = update(liveValue);
      if (transaction.mock.calls.length === 1) {
        liveValue = {
          ...(result as Record<string, unknown>),
          tripState: "completed",
        };
        return { committed: true, snapshot: { val: () => liveValue } };
      }
      liveValue = {
        ...liveValue,
        tripState: "pre_departure",
        sessionId: "session-2",
      };
      const retryResult = update(liveValue);
      return {
        committed: retryResult !== undefined,
        snapshot: { val: () => liveValue },
      };
    });
    const snapshot = {
      key: "bus_1_route_2",
      val: () => ({
        busId: "bus_1",
        routeId: "route_2",
        driverId: "driver-1",
        sessionId: "session-1",
        direction: "forward",
        status: "active",
        tripState: "in_service",
        currentStopIndex: 0,
        lat: 23.1,
        lng: 72.1,
        timestamp: 1,
      }),
      ref: { update: vi.fn(async () => undefined), transaction },
    };

    mocks.rtdbHandlers.get("child_changed")!(snapshot);
    await flushMicrotasks();
    mocks.transactionSet.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    await flushMicrotasks();

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(liveValue.sessionId).toBe("session-2");
    expect(liveValue.tripState).toBe("pre_departure");
    expect(mocks.transactionSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "bus_locations" }),
      expect.objectContaining({ status: "offline" }),
      expect.anything(),
    );
    await stop();
  });

  it("keeps a completed route cleanup when another route starts", async () => {
    allowCompletion("session-old");
    const stop = startTripStateEngine();
    mocks.routeListeners[0].next({
      docChanges: () => ["route_old", "route_new"].map((id) => ({
        type: "added",
        doc: {
          id,
          data: () => ({
            stops: [
              { id: "origin", name: "Origin", lat: 23, lng: 72 },
              { id: "destination", name: "Destination", lat: 23.1, lng: 72.1 },
            ],
          }),
        },
      })),
    });
    const oldTransaction = vi.fn(async (update: (value: unknown) => unknown) => {
      const value = { tripState: "completed", sessionId: "session-old" };
      const result = update(value);
      return { committed: result !== undefined, snapshot: { val: () => result ?? value } };
    });
    const snapshot = (routeId: string, sessionId: string, transaction: unknown) => ({
      key: `bus_1_${routeId}`,
      val: () => ({
        busId: "bus_1",
        routeId,
        driverId: "driver-1",
        sessionId,
        direction: "forward",
        status: "active",
        tripState: routeId === "route_old" ? "in_service" : "pre_departure",
        currentStopIndex: 0,
        lat: 23.1,
        lng: 72.1,
        timestamp: routeId === "route_old" ? 1 : 2,
      }),
      ref: { update: vi.fn(async () => undefined), transaction },
    });

    mocks.reduceTripState.mockReturnValueOnce({
      tripState: "completed",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
    }).mockReturnValueOnce({
      tripState: "pre_departure",
      currentStopIndex: 0,
      hasDepartedOrigin: false,
    });
    mocks.rtdbHandlers.get("child_changed")!(
      snapshot("route_old", "session-old", oldTransaction),
    );
    await flushMicrotasks();
    mocks.rtdbHandlers.get("child_changed")!(
      snapshot("route_new", "session-new", vi.fn()),
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(30_000);
    await flushMicrotasks();

    expect(oldTransaction).toHaveBeenCalledTimes(2);
    await stop();
  });

  it("does not project an old removed route offline over a newer bus lock", async () => {
    const stop = startTripStateEngine();
    mocks.transactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ sessionId: "session-new" }),
    });
    mocks.rtdbHandlers.get("child_removed")!({
      key: "bus_1_route_old",
      val: () => ({
        busId: "bus_1",
        routeId: "route_old",
        driverId: "driver-old",
        sessionId: "session-old",
        status: "offline",
        tripState: "completed",
        currentStopIndex: 1,
        lat: 23.1,
        lng: 72.1,
        timestamp: 1,
      }),
    });
    await flushMicrotasks();

    expect(mocks.transactionSet).not.toHaveBeenCalled();
    await stop();
  });

  /** RTDB-boundary mock: update() merges, transaction() aborts on undefined. */
  const makeNodeRef = (initialValue: unknown) => {
    let nodeValue = initialValue;
    const refUpdate = vi.fn(async (patch: Record<string, unknown>) => {
      nodeValue =
        nodeValue && typeof nodeValue === "object"
          ? { ...(nodeValue as Record<string, unknown>), ...patch }
          : { ...patch };
    });
    const refTransaction = vi.fn(
      async (update: (current: unknown) => unknown) => {
        const result = update(nodeValue);
        if (result !== undefined) nodeValue = result;
        return {
          committed: result !== undefined,
          snapshot: { val: () => result ?? nodeValue },
        };
      },
    );
    return {
      nodeValue: () => nodeValue,
      ref: { update: refUpdate, transaction: refTransaction },
    };
  };

  const armRoute = () => {
    mocks.routeListeners[0].next({
      docChanges: () => [{
        type: "added",
        doc: {
          id: "route_2",
          data: () => ({
            stops: [
              { id: "origin", name: "Origin", lat: 23, lng: 72 },
              { id: "destination", name: "Destination", lat: 23.1, lng: 72.1 },
            ],
          }),
        },
      }],
    });
  };

  it.each(["forward", "reverse"] as const)("arms the return from %s on a fresh stopped terminal sample", async (previousDirection) => {
    const direction = previousDirection === "forward" ? "reverse" : "forward";
    const originId = previousDirection === "forward" ? "destination" : "origin";
    const destinationId = previousDirection === "forward" ? "origin" : "destination";
    vi.setSystemTime(200_000);
    mocks.transactionGet.mockImplementation(async (ref: {
      collectionName?: string;
      id?: string;
    }) => {
      if (ref.collectionName === "_active_bus_locks") {
        return { exists: false, data: () => undefined };
      }
      if (ref.collectionName === "ride_sessions" && ref.id === "session-1") {
        return {
          exists: true,
          data: () => ({
            status: "completed",
            busId: "bus_1",
            routeId: "route_2",
            driverId: "driver-1",
          }),
        };
      }
      if (ref.collectionName === "drivers" && ref.id === "driver-1") {
        return {
          exists: true,
          data: () => ({ assignedBusId: "bus_1" }),
        };
      }
      if (ref.collectionName === "buses" && ref.id === "bus_1") {
        return {
          exists: true,
          data: () => ({ assignedRoutes: ["route_2"] }),
        };
      }
      return { exists: false, data: () => undefined };
    });
    const stop = startTripStateEngine();
    armRoute();
    const store = makeNodeRef({
      busId: "bus_1",
      routeId: "route_2",
      driverId: "driver-1",
      sessionId: "session-1",
      status: "offline",
      deviceState: "online",
      tripState: "completed",
      direction: previousDirection,
      originStopId: "origin",
      destinationStopId: "destination",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
      motionState: "stopped",
      lat: previousDirection === "forward" ? 23.1 : 23,
      lng: previousDirection === "forward" ? 72.1 : 72,
      timestamp: 200_000,
      turnaroundEligibleAt: 200_000,
      activeRouteId: "route_2:reroute:3",
      activeRoutePolyline: "old-polyline",
      routeVersion: 3,
      routeSource: "dynamic-reroute",
      routeDirection: "forward",
      routeSessionId: "session-1",
      routeState: "ON_NEW_ROUTE",
      matchedLocation: { lat: 23.09, lng: 72.09 },
      rerouteRequestId: "old-request",
    });

    mocks.rtdbHandlers.get("child_changed")!({
      key: "bus_1_route_2",
      val: store.nodeValue,
      ref: store.ref,
    });
    await flushMicrotasks(40);

    expect(mocks.transactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "ride_sessions", id: "generated-session" }),
      expect.objectContaining({
        direction,
        originStopId: originId,
        destinationStopId: destinationId,
        automaticTurnaround: true,
        previousSessionId: "session-1",
      }),
    );
    expect(mocks.transactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "_active_bus_locks", id: "bus_1" }),
      expect.objectContaining({ sessionId: "generated-session", direction }),
    );
    expect(mocks.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "active_rides", id: "bus_1_route_2" }),
      expect.objectContaining({ sessionId: "generated-session", direction }),
    );
    expect(store.nodeValue()).toMatchObject({
      sessionId: "generated-session",
      status: "active",
      tripState: "pre_departure",
      direction,
      originStopId: originId,
      destinationStopId: destinationId,
      automaticTurnaround: true,
    });
    expect(store.nodeValue()).not.toHaveProperty("activeRouteId");
    expect(store.nodeValue()).not.toHaveProperty("activeRoutePolyline");
    expect(store.nodeValue()).not.toHaveProperty("routeVersion");
    expect(store.nodeValue()).not.toHaveProperty("routeSource");
    expect(store.nodeValue()).not.toHaveProperty("routeDirection");
    expect(store.nodeValue()).not.toHaveProperty("routeSessionId");
    expect(store.nodeValue()).not.toHaveProperty("routeState");
    expect(store.nodeValue()).not.toHaveProperty("matchedLocation");
    expect(store.nodeValue()).not.toHaveProperty("rerouteRequestId");
    await stop();
  });

  it("recovers an already durable return on the initial completed-node snapshot before attempting another claim", async () => {
    vi.mocked(restoreDurableRide).mockResolvedValue(true);
    const stop = startTripStateEngine();
    armRoute();
    const store = makeNodeRef({
      busId: "bus_1", routeId: "route_2", driverId: "driver-1", sessionId: "session-1",
      status: "active", tripState: "completed", direction: "forward", timestamp: 200_000,
      lat: 23.1, lng: 72.1, motionState: "stopped", turnaroundClaimId: "return-session",
    });
    mocks.rtdbHandlers.get("child_added")!({ key: "bus_1_route_2", val: store.nodeValue, ref: store.ref });
    await flushMicrotasks(40);
    expect(restoreDurableRide).toHaveBeenCalledWith({ busId: "bus_1", routeId: "route_2" }, undefined, "return-session");
    expect(mocks.transactionCreate).not.toHaveBeenCalled();
    await stop();
  });

  it("does not duplicate a turnaround already claimed by another replica", async () => {
    vi.setSystemTime(200_000);
    const stop = startTripStateEngine();
    armRoute();
    const store = makeNodeRef({
      busId: "bus_1",
      routeId: "route_2",
      driverId: "driver-1",
      sessionId: "session-1",
      status: "offline",
      tripState: "completed",
      direction: "forward",
      motionState: "stopped",
      lat: 23.1,
      lng: 72.1,
      timestamp: 199_000,
      turnaroundEligibleAt: 180_000,
      turnaroundClaimId: "another-replica-session",
      turnaroundClaimedAt: 199_500,
    });

    mocks.rtdbHandlers.get("child_changed")!({
      key: "bus_1_route_2_claimed",
      val: store.nodeValue,
      ref: store.ref,
    });
    await flushMicrotasks(40);

    expect(mocks.transactionCreate).not.toHaveBeenCalled();
    expect(store.nodeValue()).toMatchObject({
      sessionId: "session-1",
      turnaroundClaimId: "another-replica-session",
    });
    await stop();
  });

  it("clears its RTDB claim when durable turnaround creation loses the bus lock", async () => {
    vi.setSystemTime(200_000);
    mocks.transactionGet.mockImplementation(async (ref: {
      collectionName?: string;
      id?: string;
    }) => {
      if (ref.collectionName === "_active_bus_locks") {
        return {
          exists: true,
          data: () => ({ sessionId: "another-session" }),
        };
      }
      if (ref.collectionName === "ride_sessions") {
        return {
          exists: true,
          data: () => ({
            status: "completed",
            busId: "bus_1",
            routeId: "route_2",
            driverId: "driver-1",
          }),
        };
      }
      if (ref.collectionName === "drivers") {
        return { exists: true, data: () => ({ assignedBusId: "bus_1" }) };
      }
      if (ref.collectionName === "buses") {
        return { exists: true, data: () => ({ assignedRoutes: ["route_2"] }) };
      }
      return { exists: false, data: () => undefined };
    });
    const stop = startTripStateEngine();
    armRoute();
    const store = makeNodeRef({
      busId: "bus_1",
      routeId: "route_2",
      driverId: "driver-1",
      sessionId: "session-1",
      status: "offline",
      tripState: "completed",
      direction: "forward",
      motionState: "stopped",
      lat: 23.1,
      lng: 72.1,
      timestamp: 199_000,
      turnaroundEligibleAt: 180_000,
    });

    mocks.rtdbHandlers.get("child_changed")!({
      key: "bus_1_route_2_lock_conflict",
      val: store.nodeValue,
      ref: store.ref,
    });
    await flushMicrotasks(40);

    expect(mocks.transactionCreate).not.toHaveBeenCalled();
    expect(store.nodeValue()).toMatchObject({
      sessionId: "session-1",
      turnaroundClaimId: null,
      turnaroundClaimedAt: null,
    });
    await stop();
  });

  it("persists motionState so analytics can count signal loss", async () => {
    mocks.reduceTripState.mockReturnValue({
      tripState: "in_service",
      currentStopIndex: 0,
      hasDepartedOrigin: true,
    });
    mocks.transactionGet.mockImplementation(async (ref: { collectionName?: string }) => {
      if (ref.collectionName === "_active_bus_locks") {
        return { exists: true, data: () => ({ sessionId: "session-1" }) };
      }
      if (ref.collectionName === "active_rides") {
        return { exists: true, data: () => ({ sessionId: "session-1" }) };
      }
      return { exists: false, data: () => undefined };
    });
    const stop = startTripStateEngine();
    armRoute();
    const snapshot = {
      key: "bus_48d_route_2",
      val: () => ({
        busId: "bus_1", routeId: "route_2", driverId: "driver-1", sessionId: "session-1",
        status: "active", deviceState: "online", tripState: "in_service", currentStopIndex: 0,
        hasDepartedOrigin: true, motionState: "uncertain", lat: 23.1, lng: 72.1, timestamp: 1,
      }),
      ref: { update: vi.fn(async () => undefined), transaction: vi.fn(async () => undefined) },
    };
    mocks.rtdbHandlers.get("child_changed")!(snapshot);
    await flushMicrotasks();
    expect(mocks.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "bus_locations", id: "bus_1" }),
      expect.objectContaining({ motionState: "uncertain" }),
      { merge: true },
    );
    await stop();
  });

  const queuedSnapshot = (store: ReturnType<typeof makeNodeRef>, nodeKey: string) => ({
    key: nodeKey,
    val: () => ({
      busId: "bus_1",
      routeId: "route_2",
      driverId: "driver-1",
      sessionId: "session-1",
      direction: "forward",
      status: "active",
      tripState: "pre_departure",
      currentStopIndex: 0,
      lat: 23.1,
      lng: 72.1,
      timestamp: 1,
    }),
    ref: store.ref,
  });

  it("commits all crossed-stop history before publishing the advanced live index", async () => {
    allowCompletion("session-1");
    mocks.reduceTripState.mockReturnValue({ tripState: "in_service", currentStopIndex: 3, hasDepartedOrigin: true });
    const stop = startTripStateEngine();
    mocks.routeListeners[0].next({ docChanges: () => [{ type: "added", doc: {
      id: "route_2", data: () => ({ stops: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `Stop ${i}`, lat: 23 + i * 0.0005, lng: 72 })) }),
    } }] });
    const store = makeNodeRef({ sessionId: "session-1", direction: "forward", status: "active", deviceState: "online", tripState: "in_service", currentStopIndex: 1 });
    let historyCommittedBeforePublication = false;
    const beforePublish = store.ref.transaction.mockImplementation(async update => {
      historyCommittedBeforePublication = mocks.transactionSet.mock.calls.some(([ref, data]) =>
        ref.collectionName === "ride_sessions" && data.stopsReached?.[1]?.stopId === "s1" && data.stopsReached?.[2]?.stopId === "s2");
      const value = update(store.nodeValue());
      return { committed: value !== undefined, snapshot: { val: () => value } };
    });
    mocks.rtdbHandlers.get("child_changed")!({ ...queuedSnapshot(store, "bus_multi_route_2"), val: () => ({ ...queuedSnapshot(store).val(), tripState: "in_service", currentStopIndex: 1 }) });
    await flushMicrotasks(50);
    expect(beforePublish).toHaveBeenCalledOnce();
    expect(historyCommittedBeforePublication).toBe(true);
    await stop();
  });

  it("repairs an older live index from the same session's durable checkpoint", async () => {
    allowCompletion("session-1");
    const get = mocks.transactionGet.getMockImplementation()!;
    mocks.transactionGet.mockImplementation(async ref => ref.collectionName === "active_rides"
      ? { exists: true, data: () => ({ sessionId: "session-1", tripState: "in_service", currentStopIndex: 3, hasDepartedOrigin: true }) }
      : get(ref));
    mocks.reduceTripState.mockReturnValue({ tripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true });
    const stop = startTripStateEngine();
    mocks.routeListeners[0].next({ docChanges: () => [{ type: "added", doc: {
      id: "route_2", data: () => ({ stops: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `Stop ${i}`, lat: 23 + i * 0.0005, lng: 72 })) }),
    } }] });
    const store = makeNodeRef({ sessionId: "session-1", direction: "forward", status: "active", deviceState: "online", tripState: "in_service", currentStopIndex: 1 });
    mocks.rtdbHandlers.get("child_changed")!({ ...queuedSnapshot(store, "bus_checkpoint_route_2"), val: () => ({ ...queuedSnapshot(store).val(), tripState: "in_service", currentStopIndex: 1 }) });
    await flushMicrotasks(50);
    expect(store.nodeValue().currentStopIndex).toBe(3);
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ collectionName: "active_rides" }), expect.objectContaining({ currentStopIndex: 3 }), { merge: true });
    await stop();
  });

  it("retries the same telemetry sample when its durable checkpoint fails", async () => {
    allowCompletion("session-1");
    mocks.reduceTripState.mockReturnValue({ tripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true });
    const stop = startTripStateEngine();
    armRoute();
    const store = makeNodeRef({ sessionId: "session-1", direction: "forward", status: "active", deviceState: "online", tripState: "pre_departure", currentStopIndex: 0 });
    const snapshot = queuedSnapshot(store, "bus_retry_route_2");
    mocks.db.runTransaction.mockRejectedValueOnce(new Error("checkpoint unavailable"));
    mocks.rtdbHandlers.get("child_changed")!(snapshot);
    await flushMicrotasks(50);
    expect(store.nodeValue().tripState).toBe("pre_departure");
    expect(store.ref.transaction).not.toHaveBeenCalled();
    mocks.rtdbHandlers.get("child_changed")!(snapshot);
    await flushMicrotasks(50);
    expect(mocks.reduceTripState).toHaveBeenCalledTimes(2);
    expect(store.nodeValue().tripState).toBe("in_service");
    await stop();
  });

  it.each([false, true])("recovers committed completion after RTDB failure; replacement lock=%s", async replacement => {
    let session: Record<string, unknown> = { status: "active" };
    let completed: Record<string, unknown> | undefined;
    let ownsLock = true;
    mocks.transactionGet.mockImplementation(async ref => {
      if (ref.collectionName === "ride_sessions") return { exists: true, data: () => session };
      if (ref.collectionName === "completed_trips") return { exists: Boolean(completed), data: () => completed };
      if (ref.collectionName === "_active_bus_locks") return { exists: ownsLock || replacement, data: () => ({ sessionId: ownsLock ? "session-1" : "replacement" }) };
      return { exists: false, data: () => undefined };
    });
    mocks.transactionSet.mockImplementation((ref, data) => {
      if (ref.collectionName === "ride_sessions") session = { ...session, ...data };
      if (ref.collectionName === "completed_trips") completed = { ...data };
    });
    mocks.transactionDelete.mockImplementation(ref => { if (ref.collectionName === "_active_bus_locks") ownsLock = false; });
    const stop = startTripStateEngine();
    armRoute();
    const store = makeNodeRef({ sessionId: "session-1", direction: "forward", status: "active", deviceState: "online", tripState: "in_service", currentStopIndex: 1 });
    store.ref.transaction.mockRejectedValueOnce(new Error("lost RTDB commit"));
    const snapshot = { ...queuedSnapshot(store, `bus_completion_${replacement}_route_2`), val: () => ({ ...queuedSnapshot(store).val(), tripState: "in_service", currentStopIndex: 1 }) };
    mocks.rtdbHandlers.get("child_changed")!(snapshot);
    await flushMicrotasks(50);
    expect(session.status).toBe("completed");
    expect(store.nodeValue().tripState).toBe("in_service");
    const originalCompletedAt = completed!.completedAt;
    const originalEndTime = session.endTime;
    mocks.transactionSet.mockClear();
    mocks.transactionDelete.mockClear();
    await vi.advanceTimersByTimeAsync(1_000);
    mocks.rtdbHandlers.get("child_changed")!(snapshot);
    await flushMicrotasks(50);
    expect(store.nodeValue().tripState).toBe(replacement ? "in_service" : "completed");
    expect(completed!.completedAt).toBe(originalCompletedAt);
    expect(session.endTime).toBe(originalEndTime);
    if (!replacement) expect(store.nodeValue().completedAt).toBe(Date.parse(String(originalCompletedAt)));
    expect(mocks.transactionSet).not.toHaveBeenCalledWith(expect.objectContaining({ collectionName: "completed_trips" }), expect.anything(), expect.anything());
    expect(mocks.transactionDelete).not.toHaveBeenCalled();
    await stop();
  });

  it("does not resurrect a node removed by the stale sweep", async () => {
    mocks.reduceTripState.mockReturnValue({
      tripState: "in_service",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
    });
    const stop = startTripStateEngine();
    armRoute();
    // The stale sweep already removed the node before the queued snapshot ran.
    // Unique key so the module-level processedTelemetry map stays order-independent.
    const store = makeNodeRef(null);

    mocks.rtdbHandlers.get("child_changed")!(queuedSnapshot(store, "bus_66a_route_2"));
    await flushMicrotasks();

    expect(store.nodeValue()).toBeNull();
    await stop();
  });

  it("does not clobber a newer session that reused the node key", async () => {
    mocks.reduceTripState.mockReturnValue({
      tripState: "in_service",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
    });
    const stop = startTripStateEngine();
    armRoute();
    // The node now belongs to a newer session; the queued snapshot is stale.
    const store = makeNodeRef({
      busId: "bus_1",
      routeId: "route_2",
      sessionId: "session-2",
      status: "active",
      deviceState: "online",
      tripState: "pre_departure",
      currentStopIndex: 0,
      hasDepartedOrigin: false,
      timestamp: 200,
    });

    mocks.rtdbHandlers.get("child_changed")!(queuedSnapshot(store, "bus_66b_route_2"));
    await flushMicrotasks();

    expect(store.nodeValue().tripState).toBe("pre_departure");
    expect(store.nodeValue().sessionId).toBe("session-2");
    await stop();
  });

  it("still updates live state when the node exists with the same session", async () => {
    mocks.reduceTripState.mockReturnValue({
      tripState: "in_service",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
    });
    const stop = startTripStateEngine();
    armRoute();
    const store = makeNodeRef({
      busId: "bus_1",
      routeId: "route_2",
      sessionId: "session-1",
      direction: "forward",
      status: "active",
      deviceState: "online",
      tripState: "pre_departure",
      currentStopIndex: 0,
      hasDepartedOrigin: false,
      timestamp: 1,
    });

    mocks.rtdbHandlers.get("child_changed")!(queuedSnapshot(store, "bus_66c_route_2"));
    await flushMicrotasks();

    expect(store.nodeValue().tripState).toBe("in_service");
    expect(store.nodeValue().currentStopIndex).toBe(1);
    await stop();
  });
});

describe("trip-state direction boundary", () => {
  it.each([undefined, null, "", "sideways", 123])(
    "keeps unresolved direction %p pending",
    (direction) => {
      expect(lifecycleDirection({ sessionId: "legacy-session", direction }))
        .toBeNull();
    },
  );

  it("accepts only explicit travel directions", () => {
    expect(lifecycleDirection({ direction: "forward" })).toBe("forward");
    expect(lifecycleDirection({ direction: "reverse" })).toBe("reverse");
  });
});
