// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./useAuth";
import { beginAuthVerification, waitForAuth } from "@/lib/authState";
import { markGoogleRedirectPending, consumeGoogleRedirectPending } from "@/lib/googleSignInFlow";
type TestUser = { uid: string; getIdToken?: () => Promise<string>; getIdTokenResult: (forceRefresh?: boolean) => Promise<{ claims: { role: string; admin?: boolean } }> };
const mocks = vi.hoisted(() => ({
  callback: null as null | ((user: TestUser | null) => Promise<void>),
  auth: { currentUser: null as TestUser | null, config: { authDomain: "" } }, claims: vi.fn(), observe: vi.fn(), signOut: vi.fn(),
  popup: vi.fn(), redirect: vi.fn(), redirectResult: vi.fn(),
  profile: vi.fn(), bootstrap: vi.fn(),
}));
vi.mock("@/lib/firebaseAuth", () => ({ auth: mocks.auth, googleProvider: {} }));
vi.mock("@/lib/apiClient", () => ({ apiRequest: mocks.bootstrap }));
vi.mock("@/lib/firebaseCore", () => ({ firebaseApp: {} }));
vi.mock("firebase/firestore", () => ({ getFirestore: () => ({}), doc: vi.fn(), getDoc: mocks.profile }));
vi.mock("@/hooks/useCollection", () => ({ clearCollectionCache: vi.fn() }));
vi.mock("@/hooks/useSettings", () => ({ clearSettingsCache: vi.fn() }));
vi.mock("@/lib/liveBusStore", () => ({ invalidateLiveBusCache: vi.fn() }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: mocks.observe, setPersistence: async () => {}, browserLocalPersistence: {},
  getRedirectResult: mocks.redirectResult, signInWithPopup: mocks.popup, signInWithRedirect: mocks.redirect, signOut: mocks.signOut,
}));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const user = (uid: string): TestUser => ({ uid, getIdTokenResult: async () => { await mocks.claims(); return { claims: { role: "admin", admin: true } }; } });
beforeEach(() => {
  // Profile-only scenarios must not inherit a developer/build backend URL.
  // Bootstrap scenarios opt in below and keep HTTP transport mocked.
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "");
  beginAuthVerification(); vi.clearAllMocks(); mocks.callback = null; mocks.auth.currentUser = null;
  mocks.auth.config.authDomain = window.location.host;
  mocks.popup.mockReset().mockResolvedValue(undefined);
  mocks.redirect.mockReset().mockReturnValue(new Promise(() => {}));
  mocks.redirectResult.mockReset().mockResolvedValue(null);
  mocks.signOut.mockReset().mockResolvedValue(undefined);
  mocks.claims.mockResolvedValue(undefined); mocks.observe.mockImplementation((_auth, callback) => { mocks.callback = callback; return () => {}; });
  mocks.profile.mockResolvedValue({ exists: () => false }); mocks.bootstrap.mockResolvedValue({ role: "passenger" });
  localStorage.clear(); sessionStorage.clear(); vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function mount() { const hook = renderHook(() => useAuth(), { wrapper: AuthProvider }); await waitFor(() => expect(mocks.callback).not.toBeNull()); return hook; }
describe("Google sign-in lifecycle", () => {
  it.each(["Mozilla/5.0 (Linux; Android 14)", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"])(
    "uses a full-page flow on mobile (%s) after signing out", async userAgent => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
      const hook = await mount();
      const account = user("first-login"); mocks.auth.currentUser = account;
      await act(async () => { await mocks.callback!(account); });
      mocks.signOut.mockImplementation(async () => { mocks.auth.currentUser = null; await mocks.callback!(null); });
      await act(async () => { await hook.result.current.logout(); });
      expect(hook.result.current.user).toBeNull();
      await act(async () => { void hook.result.current.loginWithGoogle(); });
      expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(mocks.auth, {});
      expect(mocks.popup).not.toHaveBeenCalled();
      expect(hook.result.current.loginLoading).toBe(true);
      expect(consumeGoogleRedirectPending()).toBe(true);
    },
  );

  it("uses redirect in an installed PWA even with a desktop user agent", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const hook = await mount();
    await act(async () => { void hook.result.current.loginWithGoogle(); });
    expect(mocks.redirect).toHaveBeenCalledOnce(); expect(mocks.popup).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("keeps desktop popup login working repeatedly for the same and another account", async () => {
    const hook = await mount();
    mocks.signOut.mockImplementation(async () => { mocks.auth.currentUser = null; await mocks.callback!(null); });
    for (const uid of ["passenger-a", "passenger-a", "passenger-b"]) {
      const account = { uid, getIdTokenResult: vi.fn(async () => ({ claims: { role: "passenger" } })) };
      mocks.popup.mockImplementation(async () => { mocks.auth.currentUser = account; await mocks.callback!(account); return { user: account }; });
      await act(async () => { await hook.result.current.loginWithGoogle(); });
      expect(hook.result.current.user?.uid).toBe(uid);
      expect(hook.result.current.loginError).toBeNull();
      expect(hook.result.current.loading).toBe(false);
      expect(account.getIdTokenResult).toHaveBeenCalledOnce();
      await act(async () => { await hook.result.current.logout(); });
      expect(hook.result.current.user).toBeNull();
    }
    expect(mocks.popup).toHaveBeenCalledTimes(3); expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["popup", "redirect"])("verifies a successful %s result even if the observer update is delayed", async flow => {
    const claims = deferred();
    const getIdTokenResult = vi.fn(async () => { await claims.promise; return { claims: { role: "passenger" } }; });
    const account = { uid: "oauth-result", getIdTokenResult };
    const result = deferred();
    mocks.redirectResult.mockImplementation(async () => {
      if (flow === "popup") return null;
      await result.promise; return { user: account };
    });
    const hook = await mount();
    mocks.auth.currentUser = account;
    let signingIn: Promise<void> | undefined;
    await act(async () => {
      if (flow === "popup") {
        mocks.popup.mockResolvedValue({ user: account });
        signingIn = hook.result.current.loginWithGoogle();
      } else result.resolve();
    });
    expect(getIdTokenResult).toHaveBeenCalledOnce();
    expect(hook.result.current.user).toBeNull();
    await act(async () => { claims.resolve(); await signingIn; });
    expect(hook.result.current.user?.uid).toBe("oauth-result");
    expect(getIdTokenResult).toHaveBeenCalledWith(true);
  });

  it.each(["admin", "passenger"])("restores a %s redirect session and keeps access closed until claims resolve", async role => {
    const restoring = deferred(), claims = deferred();
    const account = { uid: "returned", getIdTokenResult: async () => { await claims.promise; return { claims: { role, admin: role === "admin" } }; } };
    mocks.redirectResult.mockImplementation(async () => { await restoring.promise; return { user: account }; });
    markGoogleRedirectPending();
    const hook = await mount();
    expect(hook.result.current.loginReady).toBe(false);
    mocks.auth.currentUser = account;
    let verification!: Promise<void>;
    await act(async () => { verification = mocks.callback!(account); restoring.resolve(); });
    expect(hook.result.current.user).toBeNull(); expect(hook.result.current.loading).toBe(true);
    await act(async () => { claims.resolve(); await verification; });
    expect(hook.result.current.user?.role).toBe(role);
    expect(hook.result.current.loginReady).toBe(true); expect(hook.result.current.loginError).toBeNull();
    expect(consumeGoogleRedirectPending()).toBe(false);
    hook.unmount();
    // Firebase's persisted current account also restores when there is no
    // redirect result on the next page load.
    mocks.callback = null; mocks.redirectResult.mockResolvedValue(null);
    const reloaded = await mount();
    await act(async () => { await mocks.callback!(account); });
    expect(reloaded.result.current.user?.role).toBe(role);
    expect(reloaded.result.current.loginError).toBeNull();
  });

  it("reports a lost redirect session instead of silently returning to sign-in", async () => {
    markGoogleRedirectPending();
    const hook = await mount();
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    expect(hook.result.current.loginError).toContain("did not restore your session");
    expect(consumeGoogleRedirectPending()).toBe(false);
  });

  it("shows redirect errors and allows another attempt", async () => {
    markGoogleRedirectPending();
    mocks.redirectResult.mockRejectedValue({ code: "auth/network-request-failed" });
    const hook = await mount();
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    expect(hook.result.current.loginError).toContain("auth/network-request-failed");
    expect(consumeGoogleRedirectPending()).toBe(false);
    mocks.redirect.mockRejectedValue({ code: "auth/unauthorized-domain" });
    await act(async () => { await hook.result.current.loginWithGoogleRedirect(); });
    expect(hook.result.current.loginError).toContain("not authorized");
    expect(hook.result.current.loginLoading).toBe(false);
    expect(consumeGoogleRedirectPending()).toBe(false);
  });

  it("offers the full-page fallback when a desktop popup is blocked", async () => {
    mocks.popup.mockRejectedValue({ code: "auth/popup-blocked" });
    const hook = await mount();
    await act(async () => { await hook.result.current.loginWithGoogle(); });
    expect(hook.result.current.loginFallbackAvailable).toBe(true);
    expect(hook.result.current.loginError).toContain("blocked");
    expect(hook.result.current.loginLoading).toBe(false);
  });

  it("discards a late popup completion and timer while sign-out is pending", async () => {
    const hook = await mount();
    const account = user("leaving"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    const popup = deferred(), signOut = deferred();
    mocks.popup.mockImplementation(async () => { await popup.promise; return { user: account }; });
    mocks.signOut.mockReturnValue(signOut.promise);
    vi.useFakeTimers();
    let signingIn!: Promise<void>, signingOut!: Promise<void>;
    await act(async () => { signingIn = hook.result.current.loginWithGoogle(); });
    await act(async () => { signingOut = hook.result.current.logout(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); popup.resolve(); await signingIn; });
    expect(hook.result.current.user).toBeNull();
    expect(hook.result.current.loginError).toBeNull();
    expect(hook.result.current.loginFallbackAvailable).toBe(false);
    expect(mocks.claims).toHaveBeenCalledOnce();
    await act(async () => { mocks.auth.currentUser = null; await mocks.callback!(null); signOut.resolve(); await signingOut; });
  });
});
describe("verified auth publication", () => {
  it("recovers transient access with bounded backoff and current trusted claims without relogin", async () => {
    const hook = await mount(); vi.useFakeTimers();
    const account = { uid: "recovering", getIdTokenResult: vi.fn()
      .mockRejectedValueOnce({ code: "auth/network-request-failed" })
      .mockResolvedValue({ claims: { role: "passenger" } }) };
    mocks.auth.currentUser = account;
    const opened = vi.fn(); void waitForAuth().then(opened);
    await act(async () => { await mocks.callback!(account); });
    expect(hook.result.current.user).toBeNull(); expect(opened).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(account.getIdTokenResult).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(hook.result.current.user?.role).toBe("passenger");
    expect(hook.result.current.roleError).toBeNull(); expect(opened).toHaveBeenCalledOnce();
    expect(account.getIdTokenResult).toHaveBeenLastCalledWith(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); window.dispatchEvent(new Event("online")); });
    expect(account.getIdTokenResult).toHaveBeenCalledTimes(2);
  });
  it.each(["permission-denied", "auth/user-disabled", "auth/user-token-expired"])("does not automatically retry %s or reopen access", async code => {
    const hook = await mount(); vi.useFakeTimers();
    mocks.claims.mockRejectedValue({ code }); const account = user("denied"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); await vi.advanceTimersByTimeAsync(600_000);
      window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(mocks.claims).toHaveBeenCalledOnce(); expect(hook.result.current.user).toBeNull();
    expect(hook.result.current.roleError).toBeTruthy();
  });
  it("pauses a transient retry offline and coalesces online, visible and manual recovery", async () => {
    const hook = await mount(); vi.useFakeTimers();
    const connection = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mocks.claims.mockRejectedValueOnce({ code: "auth/network-request-failed" });
    const account = user("offline"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); await vi.advanceTimersByTimeAsync(600_000); });
    expect(mocks.claims).toHaveBeenCalledOnce(); expect(hook.result.current.user).toBeNull();
    const pending = deferred(); mocks.claims.mockReturnValue(pending.promise); connection.mockReturnValue(true);
    let manual!: Promise<void>;
    await act(async () => {
      window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange"));
      manual = hook.result.current.refreshAccess();
    });
    expect(mocks.claims).toHaveBeenCalledTimes(2); expect(hook.result.current.user).toBeNull();
    await act(async () => { pending.resolve(); await manual; });
    expect(hook.result.current.user?.uid).toBe("offline");
  });
  it("bounds a failed retry burst then resumes after ten minutes offline", async () => {
    const hook = await mount(); vi.useFakeTimers();
    mocks.claims.mockRejectedValue({ code: "unavailable" }); const account = user("long-outage"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); await vi.advanceTimersByTimeAsync(600_000); });
    expect(mocks.claims).toHaveBeenCalledTimes(7); expect(hook.result.current.user).toBeNull();
    mocks.claims.mockResolvedValue(undefined);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(hook.result.current.user?.uid).toBe("long-outage"); expect(mocks.claims).toHaveBeenCalledTimes(8);
  });
  it("stops automatic recovery if the next trusted request reveals revoked access", async () => {
    const hook = await mount(); vi.useFakeTimers();
    mocks.claims.mockRejectedValueOnce({ code: "auth/network-request-failed" })
      .mockRejectedValue({ code: "auth/user-token-expired" });
    const account = user("revoked-after-outage"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); await vi.advanceTimersByTimeAsync(600_000);
      window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(mocks.claims).toHaveBeenCalledTimes(2);
    expect(hook.result.current.user).toBeNull(); expect(hook.result.current.roleError).toBeTruthy();
  });
  it("pauses retries while hidden and recovers only on visible resume", async () => {
    const hook = await mount(); vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    mocks.claims.mockRejectedValueOnce({ code: "deadline-exceeded" }); const account = user("hidden"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); await vi.advanceTimersByTimeAsync(60_000); window.dispatchEvent(new Event("online")); });
    expect(mocks.claims).toHaveBeenCalledOnce();
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(hook.result.current.user?.uid).toBe("hidden");
  });
  it("discards a timed-out verification after a successful retry", async () => {
    const hook = await mount(); vi.useFakeTimers();
    let resolveOld!: (value: { claims: { role: string; admin?: boolean } }) => void;
    const account = { uid: "timeout", getIdTokenResult: vi.fn()
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValue({ claims: { role: "passenger" } }) };
    mocks.auth.currentUser = account;
    let verifying!: Promise<void>;
    await act(async () => { verifying = mocks.callback!(account); await vi.advanceTimersByTimeAsync(10_000); await verifying; });
    expect(hook.result.current.user).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(hook.result.current.user?.role).toBe("passenger");
    await act(async () => { resolveOld({ claims: { role: "admin", admin: true } }); });
    expect(hook.result.current.user?.role).toBe("passenger");
  });
  it("cancels queued automatic recovery on sign-out, account change and unmount", async () => {
    const hook = await mount(); vi.useFakeTimers();
    mocks.claims.mockRejectedValue({ code: "unavailable" });
    const first = user("first"); mocks.auth.currentUser = first;
    await act(async () => { await mocks.callback!(first); });
    mocks.auth.currentUser = null;
    await act(async () => { await mocks.callback!(null); await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.claims).toHaveBeenCalledOnce(); expect(hook.result.current.user).toBeNull();
    const second = user("second"); mocks.auth.currentUser = second;
    await act(async () => { await mocks.callback!(second); });
    mocks.claims.mockResolvedValue(undefined); const third = user("third"); mocks.auth.currentUser = third;
    await act(async () => { await mocks.callback!(third); await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.claims).toHaveBeenCalledTimes(3); expect(hook.result.current.user?.uid).toBe("third");
    mocks.claims.mockRejectedValue({ code: "unavailable" });
    await act(async () => { await hook.result.current.refreshAccess(); });
    hook.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); window.dispatchEvent(new Event("online")); });
    expect(mocks.claims).toHaveBeenCalledTimes(4);
  });
  it.each(["admin", "driver"])("never grants %s access from a Firestore profile without matching trusted claims", async role => {
    mocks.profile.mockResolvedValue({ exists: () => true, data: () => ({ role }) });
    const hook = await mount();
    const account = { uid: "legacy-profile", getIdToken: async () => "synthetic", getIdTokenResult: async () => ({ claims: { role: "" } }) };
    mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    expect(hook.result.current.user).toBeNull();
    expect(hook.result.current.roleError).toContain("trusted Auth claim synchronization");
  });
  it.each(["admin", "driver"])("never grants %s access from a bootstrap response without matching trusted claims", async role => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://auth-fixture.example.invalid");
    mocks.profile.mockResolvedValue({ exists: () => true, data: () => ({ role: "passenger" }) });
    mocks.bootstrap.mockResolvedValue({ role });
    const hook = await mount();
    const account = { uid: "bootstrap-profile", getIdToken: async () => "synthetic", getIdTokenResult: async () => ({ claims: { role: "" } }) };
    mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    expect(mocks.bootstrap).toHaveBeenCalledOnce();
    expect(hook.result.current.user).toBeNull();
    expect(hook.result.current.roleError).toContain("trusted Auth claim synchronization");
  });
  it.each(["admin", "driver"])("accepts authoritative Passenger bootstrap instead of a legacy %s profile", async role => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://auth-fixture.example.invalid");
    mocks.profile.mockResolvedValue({ exists: () => true, data: () => ({ role }) });
    const hook = await mount();
    const account = { uid: "bootstrap-passenger", getIdToken: async () => "synthetic", getIdTokenResult: async () => ({ claims: { role: "" } }) };
    mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    expect(mocks.bootstrap).toHaveBeenCalledOnce();
    expect(hook.result.current.user?.role).toBe("passenger");
    expect(hook.result.current.roleError).toBeNull();
  });
  it("observes a revoked admin role during manual access refresh", async () => {
    const hook = await mount(); const getIdTokenResult = vi.fn().mockResolvedValue({ claims: { role: "admin", admin: true } });
    const account = { uid: "downgraded", getIdTokenResult }; mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    getIdTokenResult.mockResolvedValue({ claims: { role: "passenger" } });
    await act(async () => { await hook.result.current.refreshAccess(); });
    expect(hook.result.current.user?.role).toBe("passenger");
    expect(getIdTokenResult).toHaveBeenLastCalledWith(true);
  });
  it("refreshes a persisted passenger token to the current trusted admin claims before publishing access", async () => {
    const hook = await mount();
    const getIdTokenResult = vi.fn(async (forceRefresh?: boolean) => ({ claims: forceRefresh ? { role: "admin", admin: true } : { role: "passenger" } }));
    const account = { uid: "second-admin", getIdTokenResult }; mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    expect(getIdTokenResult).toHaveBeenCalledWith(true);
    expect(hook.result.current.user?.role).toBe("admin");
  });
  it("does not publish admin access from a role string without the trusted admin bit", async () => {
    const hook = await mount(); const account = { uid: "partial-admin", getIdTokenResult: async () => ({ claims: { role: "admin" } }) }; mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    expect(hook.result.current.user).toBeNull(); expect(hook.result.current.roleError).toContain("administrator");
  });
  it("coalesces simultaneous access retries, closes the old data gate and forces new security verification", async () => {
    const hook = await mount(); const account = user("admin"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    const check = deferred(); mocks.claims.mockReturnValue(check.promise);
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = hook.result.current.refreshAccess(); second = hook.result.current.refreshAccess(); await Promise.resolve(); });
    expect(first).toBe(second); expect(hook.result.current.user).toBeNull(); expect(hook.result.current.loading).toBe(true);
    expect(mocks.claims).toHaveBeenCalledTimes(2);
    await act(async () => { check.resolve(); await first; }); expect(hook.result.current.user?.uid).toBe("admin");
  });
  it("keeps pending verification from republishing access during sign-out", async () => {
    const check = deferred(), signOut = deferred(); mocks.claims.mockReturnValue(check.promise); mocks.signOut.mockReturnValue(signOut.promise);
    const hook = await mount(); const account = user("admin"); mocks.auth.currentUser = account;
    let pending!: Promise<void>, logout!: Promise<void>;
    await act(async () => { pending = mocks.callback!(account); await Promise.resolve(); });
    await act(async () => { logout = hook.result.current.logout(); await Promise.resolve(); });
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    await act(async () => { check.resolve(); await pending; });
    expect(hook.result.current.user).toBeNull();
    await act(async () => { signOut.resolve(); mocks.auth.currentUser = null; await mocks.callback!(null); await logout; });
  });
  it("shows recovery when Firebase sign-out fails instead of leaving a silent closed gate", async () => {
    const hook = await mount(); const account = user("admin"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    mocks.signOut.mockRejectedValue(new Error("Sign-out unavailable"));
    await act(async () => { await hook.result.current.logout(); });
    expect(hook.result.current.user).toBeNull(); expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.roleError).toContain("Sign-out could not complete");
  });
  it("does not publish cached/admin identity or open readiness before trusted role verification", async () => {
    const check = deferred(); mocks.claims.mockReturnValue(check.promise); localStorage.setItem("eki:role:admin", "admin");
    const hook = await mount(); const opened = vi.fn(); void waitForAuth().then(opened);
    const account = user("admin"); mocks.auth.currentUser = account;
    let callback!: Promise<void>; await act(async () => { callback = mocks.callback!(account); await Promise.resolve(); });
    expect(hook.result.current.user).toBeNull(); expect(hook.result.current.loading).toBe(true); expect(opened).not.toHaveBeenCalled();
    await act(async () => { check.resolve(); await callback; });
    expect(hook.result.current.user?.role).toBe("admin"); expect(opened).toHaveBeenCalledOnce();
  });
  it("keeps role verification failures visible and data readiness closed", async () => {
    mocks.claims.mockRejectedValue(new Error("role verification unavailable"));
    const hook = await mount(); const opened = vi.fn(); void waitForAuth().then(opened);
    const account = user("admin"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    expect(hook.result.current.user).toBeNull(); expect(hook.result.current.roleError).toContain("We could not verify your access");
    expect(hook.result.current.loading).toBe(false); expect(opened).not.toHaveBeenCalled();
    mocks.claims.mockResolvedValue(undefined); await act(async () => { await mocks.callback!(account); });
    expect(hook.result.current.roleError).toBeNull(); expect(hook.result.current.user?.uid).toBe("admin");
  });
  it("discards a token completion after sign-out", async () => {
    const check = deferred(); mocks.claims.mockReturnValue(check.promise); const hook = await mount();
    const account = user("admin"); mocks.auth.currentUser = account;
    let pending!: Promise<void>; await act(async () => { pending = mocks.callback!(account); await Promise.resolve(); });
    mocks.auth.currentUser = null; await act(async () => { await mocks.callback!(null); check.resolve(); await pending; });
    expect(hook.result.current.user).toBeNull(); expect(hook.result.current.loading).toBe(false);
  });
  it("discards old-account completion during a switch", async () => {
    const old = deferred(); mocks.claims.mockReturnValueOnce(old.promise).mockResolvedValue(undefined); const hook = await mount();
    const first = user("first"); mocks.auth.currentUser = first;
    let pending!: Promise<void>; await act(async () => { pending = mocks.callback!(first); await Promise.resolve(); });
    const second = user("second"); mocks.auth.currentUser = second;
    await act(async () => { await mocks.callback!(second); old.resolve(); await pending; });
    expect(hook.result.current.user?.uid).toBe("second");
  });
  it("does not mark an auth restoration timeout ready", async () => {
    vi.useFakeTimers(); const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    const opened = vi.fn(); void waitForAuth().then(opened);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(hook.result.current.roleError).toContain("timed out"); expect(opened).not.toHaveBeenCalled();
  });
});
describe("hostile browser storage and legacy profiles", () => {
  it("admits a verified account when browser storage rejects writes", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    const hook = await mount(); const account = user("storage-blocked"); mocks.auth.currentUser = account;
    const opened = vi.fn(); void waitForAuth().then(opened);
    await act(async () => { await mocks.callback!(account); });
    expect(hook.result.current.roleError).toBeNull();
    expect(hook.result.current.user?.role).toBe("admin"); expect(opened).toHaveBeenCalledOnce();
  });
  it("still clears every principal cache when storage cleanup throws during sign-out", async () => {
    const { clearCollectionCache } = await import("@/hooks/useCollection");
    const { clearSettingsCache } = await import("@/hooks/useSettings");
    const { invalidateLiveBusCache } = await import("@/lib/liveBusStore");
    const hook = await mount(); const account = user("cleanup"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    mocks.signOut.mockImplementation(async () => { mocks.auth.currentUser = null; await mocks.callback!(null); });
    await act(async () => { await hook.result.current.logout(); });
    expect(clearCollectionCache).toHaveBeenCalledOnce(); expect(clearSettingsCache).toHaveBeenCalledOnce();
    expect(invalidateLiveBusCache).toHaveBeenCalledOnce();
    expect(hook.result.current.roleError).toBeNull(); expect(hook.result.current.user).toBeNull();
  });
  it.each(["student", "", 42, "Admin"])("treats an unrecognised legacy profile role %j as passenger", async role => {
    mocks.profile.mockResolvedValue({ exists: () => true, data: () => ({ role }) });
    const hook = await mount();
    const account = { uid: "legacy-role", getIdToken: async () => "synthetic", getIdTokenResult: async () => ({ claims: { role: "" } }) };
    mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    expect(hook.result.current.roleError).toBeNull();
    expect(hook.result.current.user?.role).toBe("passenger");
  });
  it("returns an account stuck on a permanent access error to a clean signed-out state", async () => {
    const hook = await mount(); const account = { uid: "unsynchronized", getIdTokenResult: async () => ({ claims: { role: "admin" } }) };
    mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    expect(hook.result.current.roleError).toContain("administrator");
    mocks.signOut.mockImplementation(async () => { mocks.auth.currentUser = null; await mocks.callback!(null); });
    await act(async () => { await hook.result.current.logout(); });
    expect(hook.result.current.roleError).toBeNull(); expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.user).toBeNull(); expect(hook.result.current.loginReady).toBe(true);
  });
});
describe("sign-in recovery dead ends", () => {
  it("clears the slow-popup message and fallback when the user closes the popup after the timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const popup = deferred();
    mocks.popup.mockImplementation(async () => { await popup.promise; throw { code: "auth/popup-closed-by-user" }; });
    const hook = await mount();
    let signingIn!: Promise<void>;
    await act(async () => { signingIn = hook.result.current.loginWithGoogle(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_500); });
    expect(hook.result.current.loginError).toContain("taking longer");
    expect(hook.result.current.loginFallbackAvailable).toBe(true);
    // A deliberate cancellation is not a failure: match the fast-cancel path.
    await act(async () => { popup.resolve(); await signingIn; });
    expect(hook.result.current.loginLoading).toBe(false);
    expect(hook.result.current.loginError).toBeNull();
    expect(hook.result.current.loginFallbackAvailable).toBe(false);
  });

  it("re-enables sign-in when a started full-page redirect is restored from the back/forward cache", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    const hook = await mount();
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    // signInWithRedirect navigates away and never settles in this document.
    await act(async () => { void hook.result.current.loginWithGoogle(); });
    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(hook.result.current.loginLoading).toBe(true);
    // A fresh (non-persisted) pageshow is a normal load and changes nothing.
    await act(async () => { window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false })); });
    expect(hook.result.current.loginLoading).toBe(true);
    // The user presses Back on Google's page and the frozen page is restored.
    await act(async () => { window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })); });
    expect(hook.result.current.loginLoading).toBe(false);
    expect(hook.result.current.loginError).toBeNull();
    expect(hook.result.current.loginFallbackAvailable).toBe(false);
    // The abandoned attempt must not surface "did not restore your session" on a later reload.
    expect(consumeGoogleRedirectPending()).toBe(false);
    await act(async () => { void hook.result.current.loginWithGoogle(); });
    expect(mocks.redirect).toHaveBeenCalledTimes(2);
  });

  it("removes the back/forward-cache listener on unmount", async () => {
    const removed = vi.spyOn(window, "removeEventListener");
    const hook = await mount();
    hook.unmount();
    expect(removed).toHaveBeenCalledWith("pageshow", expect.any(Function));
  });

  it("keeps restoration guidance when 'Try again' runs before Firebase has restored the session", async () => {
    // Firebase is still completing a pending redirect: neither the observer
    // nor getRedirectResult has settled.
    mocks.redirectResult.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hook = await mount();
    const opened = vi.fn(); void waitForAuth().then(opened);
    await act(async () => { await vi.advanceTimersByTimeAsync(8_100); });
    expect(hook.result.current.roleError).toContain("timed out");
    await act(async () => { await hook.result.current.refreshAccess(); });
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.roleError).toContain("still restoring");
    // An unknown session is never published as a confirmed sign-out.
    expect(opened).not.toHaveBeenCalled();
    // Once Firebase reports the restored state, the normal path resumes.
    await act(async () => { await mocks.callback!(null); });
    expect(hook.result.current.roleError).toBeNull();
    expect(opened).toHaveBeenCalledOnce();
  });

  it("keeps restoration guidance when sign-out is queued behind Firebase restoration", async () => {
    mocks.redirectResult.mockReturnValue(new Promise(() => {}));
    const signOut = deferred(); mocks.signOut.mockReturnValue(signOut.promise);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hook = await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_100); });
    let signingOut!: Promise<void>;
    await act(async () => { signingOut = hook.result.current.logout(); });
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.roleError).toContain("still restoring");
    await act(async () => { await mocks.callback!(null); signOut.resolve(); await signingOut; });
    expect(hook.result.current.roleError).toBeNull();
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.user).toBeNull();
  });
});
