// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ generation: 0, user: { uid: "passenger" } as { uid: string } | null,
  receive: null as ((s: { val: () => unknown }) => void) | null, fail: null as (() => void) | null, detach: vi.fn() }));
vi.mock("firebase/database", () => ({ ref: (_: unknown, path: string) => path,
  onValue: (_: unknown, receive: typeof state.receive, fail: typeof state.fail) => { state.receive = receive; state.fail = fail; return state.detach; } }));
vi.mock("@/lib/firebaseDatabase", () => ({ rtdb: {} }));
vi.mock("@/lib/authState", () => ({ waitForAuth: async () => {}, getAuthVerificationGeneration: () => state.generation }));
vi.mock("./useAuth", () => ({ useAuth: () => ({ user: state.user, loading: false, roleError: null }) }));
import { availablePreviewCount, useLiveRouteCatalog } from "./useLiveRouteCatalog";
import { BUS_EXPIRY_MS } from "@/lib/liveBusFreshness";
beforeEach(() => { vi.useFakeTimers(); state.generation = 0; state.user = { uid: "passenger" }; state.detach.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("route catalog freshness and access", () => {
  it("expires each preview at the configured deadline without another database event", async () => {
    const at = Date.now(); const { result } = renderHook(useLiveRouteCatalog);
    await act(async () => { await Promise.resolve(); });
    act(() => state.receive!({ val: () => ({ A: { active: 1, available: 2, freshestAt: at,
      previewFreshness: { [at - BUS_EXPIRY_MS + 1000]: 1, [at]: 1 } } }) }));
    expect(result.current.catalog.A.available).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.catalog.A.available).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(BUS_EXPIRY_MS - 1000); });
    expect(result.current.catalog.A).toMatchObject({ active: 1, available: 0 });
  });
  it("uses configured expiry for older catalog versions and rejects far future previews", () => {
    const now = Date.now();
    expect(availablePreviewCount({ active: 0, available: 1, freshestAt: now - BUS_EXPIRY_MS }, now)).toBe(0);
    expect(availablePreviewCount({ active: 0, available: 1, freshestAt: now + 10_001 }, now)).toBe(0);
  });
  it("hides cross-generation data immediately and reports permission denial with recovery", async () => {
    const { result, rerender } = renderHook(useLiveRouteCatalog);
    await act(async () => { await Promise.resolve(); });
    const old = state.receive!;
    act(() => old({ val: () => ({ A: { active: 1, available: 0, freshestAt: 0 } }) }));
    expect(result.current.catalog.A.active).toBe(1);
    state.generation++; state.user = null; rerender();
    expect(result.current.catalog).toEqual({});
    act(() => old({ val: () => ({ A: { active: 9, available: 0, freshestAt: 0 } }) }));
    expect(result.current.catalog).toEqual({});
    state.user = { uid: "next" }; rerender(); await act(async () => { await Promise.resolve(); });
    act(() => state.fail!());
    expect(result.current.error).toContain("unavailable");
    act(() => result.current.retry()); await act(async () => { await Promise.resolve(); });
    act(() => state.receive!({ val: () => null }));
    expect(result.current.error).toBeNull();
  });
});
