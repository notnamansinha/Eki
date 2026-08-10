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
  const transactionGet = vi.fn(async () => ({ exists: false, data: () => undefined }));
  const reduceTripState = vi.fn();

  const busesRef = {
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
      onSnapshot: name === "routes"
        ? vi.fn((next: (snapshot: any) => void, error: (error: unknown) => void) => {
            const unsubscribe = vi.fn();
            routeListeners.push({ next, error, unsubscribe });
            return unsubscribe;
          })
        : undefined,
      doc: (id: string) => ({
        collectionName: name,
        id,
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
    routeDocumentGet,
    routeListeners,
    rtdbHandlers,
    transactionDelete,
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
}));

import { startTripStateEngine } from "./tripStateEngine";

async function flushMicrotasks(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

describe("trip-state engine lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.routeListeners.length = 0;
    mocks.rtdbHandlers.clear();
    mocks.routeDocumentGet.mockResolvedValue({ exists: false, data: () => undefined });
    mocks.transactionGet.mockResolvedValue({ exists: false, data: () => undefined });
    mocks.reduceTripState.mockReturnValue({
      tripState: "completed",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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
});
