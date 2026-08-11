import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listenerState = vi.hoisted(() => ({
  success: null as null | ((snapshot: { val: () => unknown }) => void),
  failure: null as null | ((error: Error) => void),
  unsubscribe: vi.fn(),
}));

vi.mock("firebase/database", () => ({
  ref: vi.fn(() => ({ path: "activeBuses" })),
  onValue: vi.fn((_, success, failure) => {
    listenerState.success = success;
    listenerState.failure = failure;
    return listenerState.unsubscribe;
  }),
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
    listenerState.unsubscribe.mockReset();
  });

  afterEach(() => {
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
    expect(listenerState.unsubscribe).toHaveBeenCalledOnce();
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
});
