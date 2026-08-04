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
        get: name === "routes" ? routeDocumentGet : undefined,
        set: (data: unknown, options: unknown) => documentSet(name, id, data, options),
      }),
    })),
    batch: vi.fn(() => ({
      set: batchSet,
      delete: batchDelete,
      commit: batchCommit,
    })),
    runTransaction: vi.fn(async () => undefined),
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
      update({ tripState: "completed", sessionId: "session-1" });
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
    expect(mocks.batchCommit).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();

    await stop();

    expect(transaction).toHaveBeenCalledOnce();
    expect(mocks.documentSet).toHaveBeenCalledWith(
      "bus_locations",
      "bus_1",
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
});
