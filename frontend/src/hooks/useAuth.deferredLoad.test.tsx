// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./useAuth";
import { beginAuthVerification } from "@/lib/authState";

// Public pages must hydrate without the Firebase Auth SDK (#522).
const mocks = vi.hoisted(() => ({
  pathname: "/" as string | null,
  auth: { currentUser: null as null | { uid: string }, config: { authDomain: "", apiKey: "synthetic-key" }, authStateReady: vi.fn() },
  observe: vi.fn(), popup: vi.fn(), redirect: vi.fn(), redirectResult: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: mocks.auth, googleProvider: {}, popupRedirectResolver: {} }));
vi.mock("@/lib/apiClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/firebaseCore", () => ({ firebaseApp: { options: {} } }));
vi.mock("firebase/firestore", () => ({ getFirestore: () => ({}), doc: vi.fn(), getDoc: vi.fn() }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: mocks.observe, getRedirectResult: mocks.redirectResult,
  signInWithPopup: mocks.popup, signInWithRedirect: mocks.redirect, signOut: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "synthetic-key");
  beginAuthVerification(); vi.clearAllMocks();
  mocks.pathname = "/";
  mocks.auth.currentUser = null;
  mocks.auth.config.authDomain = "accounts.example.test"; // popup platform
  mocks.auth.authStateReady.mockResolvedValue(undefined);
  mocks.observe.mockImplementation(() => () => {});
  mocks.popup.mockResolvedValue({ user: null });
  mocks.redirectResult.mockResolvedValue(null);
  localStorage.clear(); sessionStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const render = () => renderHook(() => useAuth(), { wrapper: AuthProvider });
// Let any (wrongly) started dynamic import settle before asserting it did not run.
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 20)); });

describe("deferred Firebase Auth loading", () => {
  it("does not load Firebase on /install or the 404 shell", async () => {
    for (const path of ["/install", "/does-not-exist"]) {
      mocks.pathname = path;
      const hook = render();
      await settle();
      expect(mocks.observe).not.toHaveBeenCalled();
      expect(hook.result.current.restoreSlow).toBe(false);
      hook.unmount();
    }
  });

  it("offers sign-in on the signed-out landing page but loads Firebase only on first interaction", async () => {
    const hook = render();
    await settle();
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(hook.result.current.loginReady).toBe(true);
    act(() => { window.dispatchEvent(new Event("pointermove")); });
    await waitFor(() => expect(mocks.observe).toHaveBeenCalledTimes(1));
    act(() => { window.dispatchEvent(new Event("keydown")); });
    await settle();
    expect(mocks.observe).toHaveBeenCalledTimes(1);
  });

  it("does not report slow restoration while the landing page has not loaded sign-in", async () => {
    vi.useFakeTimers();
    const hook = render();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(hook.result.current.restoreSlow).toBe(false);
    expect(hook.result.current.loginError).toBeNull();
  });

  it("loads Firebase and opens Google when the first interaction is the sign-in tap", async () => {
    const hook = render();
    await settle();
    await act(async () => { await hook.result.current.loginWithGoogle(); });
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    expect(mocks.popup).toHaveBeenCalledTimes(1);
    expect(hook.result.current.loginLoading).toBe(false);
  });

  it("uses a full-page sign-in after a deferred load on redirect platforms", async () => {
    mocks.auth.config.authDomain = window.location.host;
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14)");
    mocks.redirect.mockReturnValue(new Promise(() => {}));
    const hook = render();
    await settle();
    act(() => { void hook.result.current.loginWithGoogle(); });
    await waitFor(() => expect(mocks.redirect).toHaveBeenCalledTimes(1));
    expect(mocks.auth.authStateReady).toHaveBeenCalled();
    expect(mocks.popup).not.toHaveBeenCalled();
  });

  it.each([
    ["a stored account", () => localStorage.setItem("firebase:authUser:synthetic-key:[DEFAULT]", "{}")],
    ["a remembered workspace", () => localStorage.setItem("eki:last-workspace", "/passenger")],
    ["a Google redirect in progress", () => sessionStorage.setItem("eki:google-redirect-pending", "true")],
  ])("restores the account on the landing page right away with %s", async (_label, seed) => {
    seed();
    render();
    await waitFor(() => expect(mocks.observe).toHaveBeenCalledTimes(1));
  });

  it.each(["/passenger", "/admin", "/feedback"])("loads Firebase immediately on %s", async (path) => {
    mocks.pathname = path;
    render();
    await waitFor(() => expect(mocks.observe).toHaveBeenCalledTimes(1));
  });

  it("loads Firebase when a public page navigates into a workspace", async () => {
    mocks.pathname = "/install";
    const hook = render();
    await settle();
    expect(mocks.observe).not.toHaveBeenCalled();
    mocks.pathname = "/passenger";
    hook.rerender();
    await waitFor(() => expect(mocks.observe).toHaveBeenCalledTimes(1));
  });
});
