// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUS_EXPIRY_MS } from "@/lib/liveBusFreshness";

type Listener = { path: string; next: (snapshot: { val: () => unknown }) => void; fail: (error: Error) => void; detach: ReturnType<typeof vi.fn> };
const fixture = vi.hoisted(() => ({ generation: 1, ready: Promise.resolve(), user: { uid: "passenger", role: "passenger" }, listeners: [] as Listener[] }));
vi.mock("@/lib/authState", () => ({ waitForAuth: () => fixture.ready, getAuthVerificationGeneration: () => fixture.generation }));
vi.mock("@/lib/firebaseDatabase", () => ({ rtdb: {} }));
vi.mock("./useAuth", () => ({ useAuth: () => ({ user: fixture.user, loading: false, roleError: null }) }));
vi.mock("firebase/database", () => ({
  ref: (_database: unknown, path: string) => ({ path }),
  onValue: (reference: { path: string }, next: Listener["next"], fail: Listener["fail"]) => {
    const detach = vi.fn(); fixture.listeners.push({ path: reference.path, next, fail, detach }); return detach;
  },
}));
const flush = async () => { for (let step = 0; step < 6; step++) await Promise.resolve(); };
function latest(path: string) {
  const listener = fixture.listeners.filter(entry => entry.path === path).at(-1);
  if (!listener) throw new Error(`No listener attached to ${path}`);
  return listener;
}
async function emit(path: string, value: unknown) { await act(async () => { latest(path).next({ val: () => value }); await flush(); }); }
const statusPath = "clientProjectionStatus/public";
const catalogPath = "liveRouteCatalog/values";
const compatible = { schemaVersion: 1, ready: true };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(2_000_000);
  fixture.generation = 1; fixture.ready = Promise.resolve(); fixture.listeners = [];
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("public route catalog acceptance", () => {
  it.each(["legacy-first", "canonical-first"] as const)("keeps canonical receipts and counts when legacy keys coexist (%s)", async order => {
    const { useLiveRouteCatalog } = await import("./useLiveRouteCatalog");
    const hook = renderHook(() => useLiveRouteCatalog()); await act(flush); await emit(statusPath, compatible);
    const canonical = ["route:A", { active: 1, available: 1, freshestAt: Date.now(), availableReceipts: [Date.now()] }];
    const legacy = ["A", { active: 7, available: 7, freshestAt: 0, availableReceipts: [Date.now() - BUS_EXPIRY_MS - 1] }];
    await emit(catalogPath, Object.fromEntries(order === "legacy-first" ? [legacy, canonical] : [canonical, legacy]));
    expect(Object.keys(hook.result.current.catalog)).toEqual(["A"]);
    expect(hook.result.current.catalog.A).toMatchObject({ active: 1, available: 1, availableReceipts: [Date.now()] });
  });

  it.each([null, { schemaVersion: 2, ready: true }, { schemaVersion: 1, ready: false }])("keeps unavailable or incompatible projection %j visibly closed", async marker => {
    const { useLiveRouteCatalog } = await import("./useLiveRouteCatalog");
    const hook = renderHook(() => useLiveRouteCatalog()); await act(flush);
    await emit(statusPath, marker);
    expect(hook.result.current.projectionReady).toBe(false);
    expect(hook.result.current.error).toBeTruthy();
    expect(hook.result.current.catalog).toEqual({});
  });

  it("requires the authoritative catalog after compatible readiness, and accepts an unused empty fleet", async () => {
    const { useLiveRouteCatalog } = await import("./useLiveRouteCatalog");
    const hook = renderHook(() => useLiveRouteCatalog()); await act(flush);
    await emit(statusPath, compatible);
    expect(hook.result.current.projectionReady).toBe(true);
    expect(hook.result.current.catalogReady).toBe(false);
    await emit(catalogPath, null);
    expect(hook.result.current.catalogReady).toBe(true);
    expect(hook.result.current.catalog).toEqual({});
    expect(hook.result.current.error).toBeNull();
  });

  it("decodes opaque route IDs and expires each availability receipt using the configured window", async () => {
    const { useLiveRouteCatalog } = await import("./useLiveRouteCatalog");
    const hook = renderHook(() => useLiveRouteCatalog()); await act(flush); await emit(statusPath, compatible);
    await emit(catalogPath, {
      "route:A": { active: 0, available: 2, freshestAt: Date.now(), availableReceipts: [Date.now() - BUS_EXPIRY_MS / 2, Date.now()] },
      "route:__proto__": { active: 1, available: 0, freshestAt: 0 },
    });
    expect(hook.result.current.catalog.A.available).toBe(2);
    expect(Object.hasOwn(hook.result.current.catalog, "__proto__")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(BUS_EXPIRY_MS / 2 + 2_001); });
    expect(hook.result.current.catalog.A.available).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(BUS_EXPIRY_MS / 2 + 2_001); });
    expect(hook.result.current.catalog.A.available).toBe(0);
  });

  it("reports rule denial and Retry reattaches promptly without a stale callback reopening data", async () => {
    const { useLiveRouteCatalog } = await import("./useLiveRouteCatalog");
    const hook = renderHook(() => useLiveRouteCatalog()); await act(flush); await emit(statusPath, compatible);
    const old = latest(catalogPath);
    await act(async () => { old.fail(new Error("PERMISSION_DENIED")); await flush(); });
    expect(hook.result.current.error).toBeTruthy();
    expect(hook.result.current.catalogReady).toBe(false);
    await act(async () => { hook.result.current.retry(); await flush(); });
    expect(latest(catalogPath)).not.toBe(old);
    await act(async () => { old.next({ val: () => ({ "route:old": { active: 1, available: 0, freshestAt: 0 } }) }); await flush(); });
    expect(Object.hasOwn(hook.result.current.catalog, "old")).toBe(false);
    await emit(statusPath, compatible); await emit(catalogPath, {});
    expect(hook.result.current.error).toBeNull();
  });

  it("fences a ready marker and catalog from the previous auth generation", async () => {
    const { useLiveRouteCatalog } = await import("./useLiveRouteCatalog");
    const hook = renderHook(() => useLiveRouteCatalog()); await act(flush); await emit(statusPath, compatible);
    const oldStatus = latest(statusPath), oldCatalog = latest(catalogPath);
    fixture.generation++; hook.rerender(); await act(flush);
    await act(async () => {
      oldStatus.next({ val: () => compatible });
      oldCatalog.next({ val: () => ({ "route:old": { active: 1, available: 0, freshestAt: 0 } }) });
      await flush();
    });
    expect(hook.result.current.projectionReady).toBe(false);
    expect(Object.hasOwn(hook.result.current.catalog, "old")).toBe(false);
  });

  it("requires new authoritative marker and catalog deliveries for a reconnect generation", async () => {
    const { useLiveRouteCatalog } = await import("./useLiveRouteCatalog");
    const hook = renderHook(({ recoveryKey }) => useLiveRouteCatalog(recoveryKey), { initialProps: { recoveryKey: "1:0" } });
    await act(flush); await emit(statusPath, compatible);
    await emit(catalogPath, { "route:A": { active: 1, available: 0, freshestAt: 0 } });
    const oldStatus = latest(statusPath), oldCatalog = latest(catalogPath);
    hook.rerender({ recoveryKey: "2:0" }); await act(flush);
    expect(hook.result.current.projectionReady).toBe(false);
    expect(hook.result.current.catalogReady).toBe(false);
    await act(async () => {
      oldStatus.next({ val: () => compatible });
      oldCatalog.next({ val: () => ({ "route:A": { active: 1, available: 0, freshestAt: 0 } }) });
      await flush();
    });
    expect(hook.result.current.projectionReady).toBe(false);
    await emit(statusPath, compatible);
    expect(hook.result.current.catalogReady).toBe(false);
    await emit(catalogPath, null);
    expect(hook.result.current.catalogReady).toBe(true);
  });

  it.each(["marker", "catalog"] as const)("keeps the %s failure visible when only the other channel recovers", async channel => {
    const { useLiveRouteCatalog } = await import("./useLiveRouteCatalog");
    const hook = renderHook(() => useLiveRouteCatalog()); await act(flush);
    await emit(statusPath, compatible); await emit(catalogPath, {});
    await act(async () => {
      latest(channel === "marker" ? statusPath : catalogPath).fail(new Error("PERMISSION_DENIED"));
      await vi.advanceTimersByTimeAsync(1_001); await flush();
    });
    await emit(channel === "marker" ? catalogPath : statusPath, channel === "marker" ? {} : compatible);
    expect(hook.result.current.error).toBeTruthy();
    expect(hook.result.current.catalog).toEqual({});
  });

  it.each(["marker", "catalog"] as const)("backs off persistent %s failure even when the other channel succeeds", async channel => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const { useLiveRouteCatalog } = await import("./useLiveRouteCatalog");
    renderHook(() => useLiveRouteCatalog()); await act(flush);
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      await emit(channel === "marker" ? catalogPath : statusPath, channel === "marker" ? {} : compatible);
      const attached = fixture.listeners.filter(listener => listener.path === statusPath).length;
      await act(async () => { latest(channel === "marker" ? statusPath : catalogPath).fail(new Error("PERMISSION_DENIED")); await flush(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1); });
      expect(fixture.listeners.filter(listener => listener.path === statusPath)).toHaveLength(attached);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); await flush(); });
      expect(fixture.listeners.filter(listener => listener.path === statusPath)).toHaveLength(attached + 1);
    }
  });

  it("resets partial-failure backoff only after both channels authoritatively recover", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const { useLiveRouteCatalog } = await import("./useLiveRouteCatalog");
    renderHook(() => useLiveRouteCatalog()); await act(flush);
    for (const delay of [1_000, 2_000]) {
      await emit(catalogPath, {});
      await act(async () => { latest(statusPath).fail(new Error("PERMISSION_DENIED")); await vi.advanceTimersByTimeAsync(delay); await flush(); });
    }
    await emit(statusPath, compatible); await emit(catalogPath, {});
    const attached = fixture.listeners.filter(listener => listener.path === statusPath).length;
    await act(async () => { latest(catalogPath).fail(new Error("PERMISSION_DENIED")); await vi.advanceTimersByTimeAsync(999); });
    expect(fixture.listeners.filter(listener => listener.path === statusPath)).toHaveLength(attached);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await flush(); });
    expect(fixture.listeners.filter(listener => listener.path === statusPath)).toHaveLength(attached + 1);
  });
});
