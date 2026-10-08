// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
type Snapshot = { val: () => unknown };
type Listener = { receive: (snapshot: Snapshot) => void; fail: () => void };
const state = vi.hoisted(() => ({ generation: 0, user: { uid: "passenger" } as { uid: string } | null,
  listeners: new Map<string, Listener>(), detach: vi.fn() }));
vi.mock("firebase/database", () => ({ ref: (_: unknown, path: string) => path,
  onValue: (path: string, receive: Listener["receive"], fail: Listener["fail"]) => { state.listeners.set(path, { receive, fail }); return state.detach; } }));
vi.mock("@/lib/firebaseDatabase", () => ({ rtdb: {} }));
vi.mock("@/lib/authState", () => ({ waitForAuth: async () => {}, getAuthVerificationGeneration: () => state.generation }));
vi.mock("./useAuth", () => ({ useAuth: () => ({ user: state.user, loading: false, roleError: null }) }));
import { useLiveRouteCatalog } from "./useLiveRouteCatalog";
import { BUS_EXPIRY_MS } from "@/lib/liveBusFreshness";
const markerPath = "clientProjectionStatus/public", catalogPath = "liveRouteCatalog/values";
const flush = async () => { for (let step = 0; step < 4; step++) await Promise.resolve(); };
const emit = (path: string, value: unknown) => state.listeners.get(path)!.receive({ val: () => value });
const ready = () => emit(markerPath, { schemaVersion: 1, ready: true });
beforeEach(() => { vi.useFakeTimers(); state.generation = 0; state.user = { uid: "passenger" }; state.listeners.clear(); state.detach.mockClear(); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });
describe("route catalog freshness and access", () => {
  it("expires each preview at the configured deadline without another database event", async () => {
    const at = Date.now(); const { result } = renderHook(() => useLiveRouteCatalog()); await act(flush);
    act(() => { ready(); emit(catalogPath, { "route:A": { active: 1, available: 2, freshestAt: at,
      availableReceipts: [at - BUS_EXPIRY_MS + 1000, at] } }); });
    expect(result.current.catalog.A.available).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.catalog.A.available).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(BUS_EXPIRY_MS - 1000); });
    expect(result.current.catalog.A).toMatchObject({ active: 1, available: 0 });
  });
  it("uses configured expiry and rejects stale or far future preview receipts", async () => {
    const now = Date.now(); const { result } = renderHook(() => useLiveRouteCatalog()); await act(flush);
    act(() => { ready(); emit(catalogPath, { "route:A": { active: 0, available: 2, freshestAt: now,
      availableReceipts: [now - BUS_EXPIRY_MS, now + 10_001] } }); });
    expect(result.current.catalog.A.available).toBe(0);
  });
  it("hides cross-generation data immediately and reports permission denial with recovery", async () => {
    const { result, rerender } = renderHook(() => useLiveRouteCatalog()); await act(flush);
    const old = state.listeners.get(catalogPath)!.receive;
    act(() => { ready(); old({ val: () => ({ "route:A": { active: 1, available: 0, freshestAt: 0 } }) }); });
    expect(result.current.catalog.A.active).toBe(1);
    state.generation++; state.user = null; rerender();
    expect(result.current.catalog).toEqual({});
    act(() => old({ val: () => ({ "route:A": { active: 9, available: 0, freshestAt: 0 } }) }));
    expect(result.current.catalog).toEqual({});
    state.user = { uid: "next" }; rerender(); await act(flush);
    act(() => state.listeners.get(catalogPath)!.fail());
    expect(result.current.error).toBeTruthy(); expect(result.current.catalogReady).toBe(false);
    act(() => result.current.retry()); await act(flush);
    act(() => { ready(); emit(catalogPath, null); });
    expect(result.current.error).toBeNull(); expect(result.current.catalogReady).toBe(true);
  });
});
