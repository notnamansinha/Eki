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

  it("arms the opposite ride after a fresh stopped turnaround dwell", async () => {
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
      direction: "forward",
      originStopId: "origin",
      destinationStopId: "destination",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
      motionState: "stopped",
      lat: 23.1,
      lng: 72.1,
      timestamp: 199_000,
      turnaroundEligibleAt: 180_000,
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
        direction: "reverse",
        originStopId: "destination",
        destinationStopId: "origin",
        automaticTurnaround: true,
        previousSessionId: "session-1",
      }),
    );
    expect(mocks.transactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "_active_bus_locks", id: "bus_1" }),
      expect.objectContaining({ sessionId: "generated-session", direction: "reverse" }),
    );
    expect(mocks.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "active_rides", id: "bus_1_route_2" }),
      expect.objectContaining({ sessionId: "generated-session", direction: "reverse" }),
    );
    expect(store.nodeValue()).toMatchObject({
      sessionId: "generated-session",
      status: "active",
      tripState: "pre_departure",
      direction: "reverse",
      originStopId: "destination",
      destinationStopId: "origin",
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
      status: "active",
      tripState: "pre_departure",
      currentStopIndex: 0,
      lat: 23.1,
      lng: 72.1,
      timestamp: 1,
    }),
    ref: store.ref,
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
