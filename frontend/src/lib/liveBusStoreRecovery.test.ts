import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listenerState = vi.hoisted(() => ({
  success: null as null | ((snapshot: { val: () => unknown }) => void),
  failure: null as null | ((error: Error) => void),
  childChanged: null as null | ((snapshot: { key: string | null; val: () => unknown }) => void),
  unsubscribe: vi.fn(),
}));

vi.mock("firebase/database", () => ({
  ref: vi.fn(() => ({ path: "activeBuses" })),
  onValue: vi.fn((_, success, failure) => {
    listenerState.success = success;
    listenerState.failure = failure;
    return listenerState.unsubscribe;
  }),
  onChildAdded: vi.fn(() => listenerState.unsubscribe),
  onChildChanged: vi.fn((_, success) => {
    listenerState.childChanged = success;
    return listenerState.unsubscribe;
  }),
  onChildRemoved: vi.fn(() => listenerState.unsubscribe),
}));

vi.mock("./authState", () => ({ waitForAuth: vi.fn(() => Promise.resolve()) }));
vi.mock("./firebaseDatabase", () => ({ rtdb: {} }));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("live bus listener recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    listenerState.success = null;
    listenerState.failure = null;
    listenerState.childChanged = null;
    listenerState.unsubscribe.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("invalidates stale data and attaches exactly one retry", async () => {
    const { onValue } = await import("firebase/database");
    vi.mocked(onValue).mockClear();
    const { subscribeLiveBuses } = await import("./liveBusStore");
    const next = vi.fn();
    const error = vi.fn();
    const dispose = subscribeLiveBuses(next, error);
    await flushPromises();

    listenerState.failure?.(new Error("permission denied"));
    expect(listenerState.unsubscribe).toHaveBeenCalledTimes(4);
    expect(next).toHaveBeenLastCalledWith(null, "invalidation");
    expect(error).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();
    expect(onValue).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("resets backoff after an authoritative snapshot", async () => {
    const { onValue } = await import("firebase/database");
    vi.mocked(onValue).mockClear();
    const { subscribeLiveBuses } = await import("./liveBusStore");
    const dispose = subscribeLiveBuses(vi.fn());
    await flushPromises();

    listenerState.failure?.(new Error("first failure"));
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();
    listenerState.success?.({ val: () => null });
    listenerState.failure?.(new Error("second failure"));

    await vi.advanceTimersByTimeAsync(999);
    expect(onValue).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(onValue).toHaveBeenCalledTimes(3);
    dispose();
  });

  it("cancels a pending retry when the final subscriber leaves", async () => {
    const { onValue } = await import("firebase/database");
    vi.mocked(onValue).mockClear();
    const { subscribeLiveBuses } = await import("./liveBusStore");
    const dispose = subscribeLiveBuses(vi.fn());
    await flushPromises();

    listenerState.failure?.(new Error("terminal failure"));
    dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onValue).toHaveBeenCalledOnce();
  });

  it("continues recovery when one subscriber callback throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { onValue } = await import("firebase/database");
    vi.mocked(onValue).mockClear();
    const { subscribeLiveBuses } = await import("./liveBusStore");
    const firstDispose = subscribeLiveBuses(() => {
      throw new Error("subscriber failed");
    });
    const next = vi.fn();
    const secondDispose = subscribeLiveBuses(next);
    await flushPromises();

    listenerState.failure?.(new Error("terminal failure"));
    expect(next).toHaveBeenCalledWith(null, "invalidation");
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();
    expect(onValue).toHaveBeenCalledTimes(2);

    firstDispose();
    secondDispose();
    consoleError.mockRestore();
  });

  it("delivers one changed child without replacing unrelated cached buses", async () => {
    const { subscribeLiveBusChanges, subscribeLiveBusesByRoute } =
      await import("./liveBusStore");
    const changes = vi.fn();
    const routeOne = vi.fn();
    const routeTwo = vi.fn();
    const disposeChanges = subscribeLiveBusChanges(changes);
    const disposeOne = subscribeLiveBusesByRoute("route_1", routeOne);
    const disposeTwo = subscribeLiveBusesByRoute("route_2", routeTwo);
    await flushPromises();

    listenerState.success?.({ val: () => ({
      bus_1: { busId: "bus_1", routeId: "route_1", timestamp: Date.now() },
      bus_2: { busId: "bus_2", routeId: "route_2", timestamp: Date.now() },
    }) });
    changes.mockClear();
    routeOne.mockClear();
    routeTwo.mockClear();

    const updated = { busId: "bus_1", routeId: "route_1", timestamp: Date.now(), speed: 30 };
    listenerState.childChanged?.({ key: "bus_1", val: () => updated });

    expect(changes).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledWith({
      type: "upsert",
      key: "bus_1",
      value: updated,
      source: "listener",
    });
    expect(routeOne).toHaveBeenCalledOnce();
    expect(routeOne.mock.calls[0][0]).toEqual({ bus_1: updated });
    expect(routeTwo).not.toHaveBeenCalled();

    disposeChanges();
    disposeOne();
    disposeTwo();
  });
});
