// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRTDBResume } from "./useRTDBResume";

const sdk = vi.hoisted(() => ({
  connected: null as null | ((snapshot: { val: () => boolean }) => void),
  offline: vi.fn(), online: vi.fn(), invalidate: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock("firebase/database", () => ({
  ref: vi.fn(), goOffline: sdk.offline, goOnline: sdk.online,
  onValue: (_ref: unknown, callback: typeof sdk.connected) => { sdk.connected = callback; return sdk.unsubscribe; },
}));
vi.mock("@/lib/firebaseDatabase", () => ({ rtdb: {} }));
vi.mock("@/lib/liveBusStore", () => ({ invalidateLiveBusCache: sdk.invalidate }));
vi.mock("@/lib/telemetryTrace", () => ({ recordRealtimeConnection: vi.fn() }));
let visible = true;
let online = true;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); visible = true; online = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
function visibility(value: boolean) {
  visible = value; act(() => document.dispatchEvent(new Event("visibilitychange")));
}
function connection(value: boolean) { act(() => sdk.connected!({ val: () => value })); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function ready() {
  const hook = renderHook(() => useRTDBResume());
  connection(true); act(() => hook.result.current.markSnapshotReceived());
  return hook;
}

describe("RTDB resume gate", () => {
  it("preserves a healthy fleet and connection across a short tab switch", async () => {
    const hook = ready(); const before = hook.result.current;
    visibility(false); await advance(1_000); visibility(true); await advance(10_000);
    expect(sdk.offline).not.toHaveBeenCalled(); expect(sdk.online).not.toHaveBeenCalled();
    expect(sdk.invalidate).not.toHaveBeenCalled();
    expect(hook.result.current.resumeGeneration).toBe(before.resumeGeneration);
    expect(hook.result.current.isResuming).toBe(false);
  });
  it("ignores duplicate browser-online notifications on a healthy connection", async () => {
    ready(); act(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("online")); });
    await advance(10_000); expect(sdk.offline).not.toHaveBeenCalled(); expect(sdk.invalidate).not.toHaveBeenCalled();
  });
  it("debounces a long suspension before performing one refresh", async () => {
    const hook = ready(); visibility(false); await advance(30_000); visibility(true);
    expect(sdk.offline).not.toHaveBeenCalled(); await advance(2_000);
    expect(sdk.offline).toHaveBeenCalledOnce(); expect(sdk.online).toHaveBeenCalledOnce();
    expect(hook.result.current.isResuming).toBe(true);
  });
  it("lets natural SDK recovery cancel an unnecessary forced handshake", async () => {
    ready(); connection(false); await advance(500); connection(true); await advance(5_000);
    expect(sdk.invalidate).toHaveBeenCalledOnce(); expect(sdk.offline).not.toHaveBeenCalled();
  });
  it("debounces offline/online flaps, waits for visibility and suppresses cooldown duplicates", async () => {
    const hook = ready();
    online = false; act(() => window.dispatchEvent(new Event("offline")));
    await advance(10_000); expect(sdk.offline).not.toHaveBeenCalled();
    visibility(false); online = true; act(() => window.dispatchEvent(new Event("online")));
    await advance(2_000); expect(sdk.offline).not.toHaveBeenCalled();
    visibility(true); await advance(500);
    act(() => window.dispatchEvent(new Event("online"))); await advance(800);
    expect(sdk.offline).not.toHaveBeenCalled(); await advance(500);
    expect(sdk.offline).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(new Event("online"))); await advance(1_000);
    expect(sdk.offline).toHaveBeenCalledOnce();
    connection(true); expect(hook.result.current.isResuming).toBe(true);
    act(() => hook.result.current.markSnapshotReceived()); expect(hook.result.current.isResuming).toBe(false);
  });
  it("ignores initial disconnected metadata and cancels pending work on unmount", async () => {
    const hook = renderHook(() => useRTDBResume()); connection(false);
    act(() => window.dispatchEvent(new Event("online"))); await advance(5_000);
    expect(sdk.offline).not.toHaveBeenCalled(); expect(sdk.invalidate).not.toHaveBeenCalled();
    connection(true); connection(false); hook.unmount(); await advance(10_000);
    expect(sdk.offline).not.toHaveBeenCalled(); expect(sdk.unsubscribe).toHaveBeenCalledOnce();
    const invalidations = sdk.invalidate.mock.calls.length;
    connection(true); connection(false); expect(sdk.invalidate).toHaveBeenCalledTimes(invalidations);
  });
});
