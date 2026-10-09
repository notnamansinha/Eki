// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSettingsCache, useSettings } from "./useSettings";
const mocks = vi.hoisted(() => ({
  user: { uid: "admin", role: "admin" } as { uid: string; role: string | null } | null,
  loading: false, generation: 0, ready: vi.fn(), listen: vi.fn(), unsubscribe: vi.fn(),
  auth: { currentUser: { uid: "admin", getIdToken: async () => "test-token" } },
}));
vi.mock("./useAuth", () => ({ useAuth: () => ({ user: mocks.user, loading: mocks.loading }) }));
vi.mock("@/lib/authState", () => ({ waitForAuth: mocks.ready, getAuthVerificationGeneration: () => mocks.generation }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/firebaseFirestore", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({ doc: vi.fn(), onSnapshot: mocks.listen }));
beforeEach(() => {
  clearSettingsCache(); vi.clearAllMocks(); mocks.user = { uid: "admin", role: "admin" }; mocks.loading = false; mocks.generation = 0;
  mocks.auth.currentUser.uid = "admin"; mocks.ready.mockResolvedValue(undefined); mocks.listen.mockReturnValue(mocks.unsubscribe);
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://backend.example.test");
});
afterEach(() => { cleanup(); clearSettingsCache(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("verified settings workflow", () => {
  it("excludes stored audit metadata and defaults malformed fields", async () => {
    const hook = renderHook(() => useSettings());
    await waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
    act(() => mocks.listen.mock.calls[0][1]({ exists: () => true, data: () => ({
      serviceStartTime: "7:30 am", announcementActive: "true", updatedAt: { seconds: 123 }, updatedBy: "admin", unrelated: "metadata",
    }) }));
    expect(hook.result.current.settings).toEqual({ serviceStartTime: "7:30 am", noBusesMessage: "No buses running", noBusesSubMessage: "Service starts at {time}", announcementText: "", announcementActive: false });
  });
  it("does not read before verification and detaches on sign-out", async () => {
    mocks.loading = true; const hook = renderHook(() => useSettings()); await act(async () => {});
    expect(mocks.listen).not.toHaveBeenCalled(); mocks.loading = false; hook.rerender();
    await waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce()); mocks.user = null; hook.rerender();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
  it("reattaches only the current generation after clearing deferred readiness", async () => {
    let resolve!: () => void; mocks.ready.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    renderHook(() => useSettings()); act(() => clearSettingsCache()); await act(async () => { resolve(); });
    expect(mocks.listen).toHaveBeenCalledOnce();
  });
  it("sends authenticated JSON and requires saved:true", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"saved":true}')).mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal("fetch", fetch); const hook = renderHook(() => useSettings());
    await hook.result.current.saveSettings({ announcementText: "Test" });
    const init = fetch.mock.calls[0][1]; expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
    await expect(hook.result.current.saveSettings({ announcementText: "Test" })).rejects.toThrow("acknowledgement");
  });
  it("reports a network outage as an actionable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const hook = renderHook(() => useSettings());
    await expect(hook.result.current.saveSettings({ announcementText: "Test" })).rejects.toThrow("backend could not be reached");
  });
  it("rejects settings writes from an unverified principal", async () => {
    mocks.user!.role = null; const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useSettings());
    await expect(hook.result.current.saveSettings({ announcementText: "Test" })).rejects.toThrow("Admin authentication required");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fences a changed auth generation before React cleanup runs", async () => {
    let resolve!: () => void; mocks.ready.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    renderHook(() => useSettings()); mocks.generation++;
    await act(async () => { resolve(); }); expect(mocks.listen).not.toHaveBeenCalled();
  });
});
