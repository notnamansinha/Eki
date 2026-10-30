// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./useAuth";
import { beginAuthVerification, waitForAuth } from "@/lib/authState";
import { markGoogleRedirectPending, consumeGoogleRedirectPending } from "@/lib/googleSignInFlow";
type TestUser = { uid: string; getIdToken?: () => Promise<string>; getIdTokenResult: (forceRefresh?: boolean) => Promise<{ claims: { role: string; admin?: boolean } }> };
const RESOLVER = vi.hoisted(() => ({ resolver: "browserPopupRedirectResolver" }));
const mocks = vi.hoisted(() => ({
  callback: null as null | ((user: TestUser | null) => Promise<void>),
  auth: { currentUser: null as TestUser | null, config: { authDomain: "", apiKey: "synthetic-key" }, authStateReady: vi.fn() }, claims: vi.fn(), observe: vi.fn(), signOut: vi.fn(),
  popup: vi.fn(), redirect: vi.fn(), redirectResult: vi.fn(),
  profile: vi.fn(), bootstrap: vi.fn(),
  // Popup platforms install Google's popup/redirect resolver at startup; phones signing in by redirect do not.
}));
vi.mock("@/lib/firebaseAuth", () => ({
  auth: mocks.auth, googleProvider: {}, popupRedirectResolver: RESOLVER,
}));
vi.mock("@/lib/apiClient", () => ({ apiRequest: mocks.bootstrap }));
vi.mock("@/lib/firebaseCore", () => ({ firebaseApp: { options: {} } }));
vi.mock("firebase/firestore", () => ({ getFirestore: () => ({}), doc: vi.fn(), getDoc: mocks.profile }));
vi.mock("@/hooks/useCollection", () => ({ clearCollectionCache: vi.fn() }));
vi.mock("@/hooks/useSettings", () => ({ clearSettingsCache: vi.fn() }));
vi.mock("@/lib/liveBusStore", () => ({ invalidateLiveBusCache: vi.fn() }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: mocks.observe, setPersistence: async () => {}, browserLocalPersistence: {},
  getRedirectResult: mocks.redirectResult, signInWithPopup: mocks.popup, signInWithRedirect: mocks.redirect, signOut: mocks.signOut,
  // Lets the real firebaseAuth module build on these mocks (see the downloading tests below).
  initializeAuth: () => mocks.auth, indexedDBLocalPersistence: {}, browserSessionPersistence: {},
  browserPopupRedirectResolver: RESOLVER, GoogleAuthProvider: class {},
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
  mocks.auth.authStateReady.mockReset().mockResolvedValue(undefined);
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
      expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(mocks.auth, {}, RESOLVER);
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
    if (flow === "redirect") markGoogleRedirectPending();
    mocks.redirectResult.mockImplementation(async () => {
      if (flow === "popup") return null;
      await result.promise; return { user: account };
    });
    const hook = await mount();
    let signingIn: Promise<void> | undefined;
    await act(async () => {
      if (flow === "popup") {
        // Firebase sets currentUser as the popup completes; the observer is late.
        mocks.popup.mockImplementation(async () => { mocks.auth.currentUser = account; return { user: account }; });
        signingIn = hook.result.current.loginWithGoogle();
      } else { mocks.auth.currentUser = account; result.resolve(); }
    });
    if (flow === "popup") expect(mocks.popup).toHaveBeenCalledOnce();
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

  it("clears Firebase's pending flag when a full-page sign-in fails before leaving the page", async () => {
    // Firebase marks the redirect pending before it validates the origin over
    // the network; a failure there must not slow the next reopen.
    mocks.redirect.mockImplementation(async () => {
      sessionStorage.setItem("firebase:pendingRedirect:synthetic-key:[DEFAULT]", JSON.stringify("true"));
      throw { code: "auth/network-request-failed" };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = await mount();
    await act(async () => { await hook.result.current.loginWithGoogleRedirect(); });
    expect(hook.result.current.loginError).toContain("auth/network-request-failed");
    expect(sessionStorage.getItem("firebase:pendingRedirect:synthetic-key:[DEFAULT]")).toBeNull();
    expect(consumeGoogleRedirectPending()).toBe(false);
  });

  it("completes a redirect Firebase still has pending after Back from Google consumed our marker", async () => {
    sessionStorage.setItem("firebase:pendingRedirect:synthetic-key:[DEFAULT]", JSON.stringify("true"));
    const returned = deferred(); mocks.redirectResult.mockImplementation(async () => { await returned.promise; return null; });
    const hook = await mount();
    expect(hook.result.current.loginReady).toBe(false);
    expect(mocks.redirectResult).toHaveBeenCalledExactlyOnceWith(mocks.auth, RESOLVER);
    await act(async () => { returned.resolve(); });
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
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
  it("does not mark a slow auth restoration ready or report it as an access error", async () => {
    vi.useFakeTimers(); const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    const opened = vi.fn(); void waitForAuth().then(opened);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(hook.result.current.restoreSlow).toBe(true); expect(hook.result.current.roleError).toBeNull();
    expect(hook.result.current.loading).toBe(true); expect(opened).not.toHaveBeenCalled();
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

  it("waits for restoration when 'Try again' runs before Firebase has restored the session", async () => {
    // Firebase is still completing a pending redirect: neither the observer
    // nor getRedirectResult has settled.
    markGoogleRedirectPending();
    mocks.redirectResult.mockReturnValue(new Promise(() => {}));
    mocks.auth.authStateReady.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hook = await mount();
    const opened = vi.fn(); void waitForAuth().then(opened);
    await act(async () => { await vi.advanceTimersByTimeAsync(8_100); });
    expect(hook.result.current.restoreSlow).toBe(true);
    await act(async () => { void hook.result.current.refreshAccess(); });
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.roleError).toBeNull();
    // An unknown session is never published as a confirmed sign-out.
    expect(opened).not.toHaveBeenCalled();
    // Once Firebase reports the restored state, the normal path resumes.
    await act(async () => { await mocks.callback!(null); });
    expect(hook.result.current.roleError).toBeNull();
    expect(hook.result.current.restoreSlow).toBe(false);
    expect(opened).toHaveBeenCalledOnce();
  });

  it("keeps restoration guidance when sign-out is queued behind Firebase restoration", async () => {
    markGoogleRedirectPending();
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

describe("cold open on a slow or offline network", () => {
  it("enables sign-in for a signed-out visitor before Firebase reports its first state", async () => {
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    expect(mocks.callback).not.toBeNull();
    expect(hook.result.current.loading).toBe(true);
    // No redirect is pending, so nothing waits on Google's redirect machinery.
    expect(mocks.redirectResult).not.toHaveBeenCalled();
  });
  it("still completes a pending Google redirect before enabling sign-in", async () => {
    markGoogleRedirectPending();
    const returned = deferred(); mocks.redirectResult.mockImplementation(async () => { await returned.promise; return null; });
    const hook = await mount();
    expect(hook.result.current.loginReady).toBe(false);
    await act(async () => { returned.resolve(); });
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    expect(mocks.redirectResult).toHaveBeenCalledExactlyOnceWith(mocks.auth, RESOLVER);
  });
  it("passes the popup/redirect resolver to desktop popup sign-in", async () => {
    mocks.auth.config.authDomain = "auth.example.test";
    const hook = await mount();
    await act(async () => { await hook.result.current.loginWithGoogle(); });
    expect(mocks.popup).toHaveBeenCalledExactlyOnceWith(mocks.auth, {}, RESOLVER);
  });
  it("on a phone, a tap before restoration finishes verifies a restored account instead of starting Google again", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    const ready = deferred(); mocks.auth.authStateReady.mockReturnValue(ready.promise);
    const hook = await mount();
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    let tapping!: Promise<void>;
    await act(async () => { tapping = hook.result.current.loginWithGoogle(); });
    expect(hook.result.current.loginLoading).toBe(true);
    const account = { uid: "restored", getIdTokenResult: vi.fn(async () => ({ claims: { role: "passenger" } })) };
    mocks.auth.currentUser = account;
    await act(async () => { const verifying = mocks.callback!(account); ready.resolve(); await verifying; await tapping; });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(hook.result.current.user?.uid).toBe("restored");
    expect(hook.result.current.loginLoading).toBe(false);
  });
  it("on a phone, a tap before restoration finishes starts Google once a signed-out state is known", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14)");
    const ready = deferred(); mocks.auth.authStateReady.mockReturnValue(ready.promise);
    const hook = await mount();
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    await act(async () => { void hook.result.current.loginWithGoogle(); });
    expect(mocks.redirect).not.toHaveBeenCalled();
    await act(async () => { await mocks.callback!(null); ready.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(mocks.auth, {}, RESOLVER));
  });
  it.each([["a phone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"], ["desktop", undefined]])(
    "on %s, a tap while a restored account is still being verified finishes that check instead of opening Google", async (_platform, userAgent) => {
      if (userAgent) vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
      const claims = deferred();
      const account = { uid: "restored", getIdTokenResult: vi.fn(async () => { await claims.promise; return { claims: { role: "passenger" } }; }) };
      const hook = await mount();
      await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
      mocks.auth.currentUser = account;
      let verifying!: Promise<void>;
      await act(async () => { verifying = mocks.callback!(account); });
      expect(hook.result.current.user).toBeNull();
      let tapping!: Promise<void>;
      await act(async () => { tapping = hook.result.current.loginWithGoogle(); });
      expect(hook.result.current.loginLoading).toBe(true);
      await act(async () => { claims.resolve(); await verifying; });
      // A started redirect never settles in this document, so check before awaiting the tap.
      expect(mocks.redirect).not.toHaveBeenCalled(); expect(mocks.popup).not.toHaveBeenCalled();
      expect(consumeGoogleRedirectPending()).toBe(false);
      await act(async () => { await tapping; });
      expect(account.getIdTokenResult).toHaveBeenCalledOnce();
      expect(hook.result.current.user?.uid).toBe("restored");
      expect(hook.result.current.loginLoading).toBe(false);
    },
  );
  it("clears the slow-restoration flag when Firebase finally reports a signed-in account", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hook = await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_100); });
    expect(hook.result.current.restoreSlow).toBe(true);
    const account = { uid: "late", getIdTokenResult: vi.fn(async () => ({ claims: { role: "passenger" } })) };
    mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    expect(hook.result.current.restoreSlow).toBe(false);
    expect(hook.result.current.user?.uid).toBe("late");
  });
  it("keeps a transient verification failure steady while it retries automatically", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const offline = Object.assign(new Error("offline"), { code: "auth/network-request-failed" });
    const retry = deferred();
    mocks.claims.mockRejectedValueOnce(offline).mockReturnValueOnce(retry.promise);
    const hook = await mount();
    const account = user("flaky"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    expect(hook.result.current.roleError).toContain("retrying automatically");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    // The automatic retry is in flight: the screen must not flash back to loading.
    expect(mocks.claims).toHaveBeenCalledTimes(2);
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.roleError).toContain("retrying automatically");
    await act(async () => { retry.resolve(); await vi.advanceTimersByTimeAsync(10); });
    expect(hook.result.current.roleError).toBeNull();
    expect(hook.result.current.user?.uid).toBe("flaky");
  });
  it.each(["succeeds", "fails"])("shows 'Try again' in progress when it joins an automatic retry that then %s", async outcome => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const offline = Object.assign(new Error("offline"), { code: "auth/network-request-failed" });
    let settle!: (failed: boolean) => void;
    const retry = new Promise<void>((resolve, reject) => { settle = failed => failed ? reject(offline) : resolve(); });
    mocks.claims.mockRejectedValueOnce(offline).mockReturnValueOnce(retry);
    const hook = await mount();
    const account = user("flaky"); mocks.auth.currentUser = account;
    await act(async () => { await mocks.callback!(account); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(mocks.claims).toHaveBeenCalledTimes(2); expect(hook.result.current.loading).toBe(false);
    let manual!: Promise<void>;
    await act(async () => { manual = hook.result.current.refreshAccess(); });
    // The tap joins the retry in flight and shows it instead of the old error.
    expect(hook.result.current.loading).toBe(true); expect(hook.result.current.roleError).toBeNull();
    expect(mocks.claims).toHaveBeenCalledTimes(2);
    await act(async () => { settle(outcome === "fails"); await manual; });
    expect(hook.result.current.loading).toBe(false);
    if (outcome === "succeeds") {
      expect(hook.result.current.user?.uid).toBe("flaky"); expect(hook.result.current.roleError).toBeNull();
    } else {
      expect(hook.result.current.user).toBeNull(); expect(hook.result.current.roleError).toContain("retrying automatically");
    }
  });
});

describe("cold open while the sign-in code is still downloading", () => {
  // Each load of the lazily loaded sign-in code waits here until the test
  // settles it, and Firebase notifies every observer still subscribed. Vitest
  // serves an import that races a pending mock from the real firebaseAuth
  // module (built on the mocks above), so a duplicate load completes at once.
  let loads = 0;
  let initAttempts = 0;
  let pending: Array<{ resolve: (signInModule: object) => void; reject: (error: unknown) => void }> = [];
  const observers = new Set<(user: TestUser | null) => Promise<void>>();
  const signInCode = () => ({
    auth: mocks.auth, googleProvider: {}, popupRedirectResolver: RESOLVER,
  });
  // Stands in for initializeAuth throwing while the module evaluates. Bundlers
  // cache that failure, so every later import of the module throws it again.
  const brokenSignInCode = (error: Error) => ({ ...signInCode(), get auth(): never { initAttempts++; throw error; } });
  const chunkFailure = () => new TypeError("Failed to fetch dynamically imported module");
  const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });
  // Waits for every racing import, and the load that awaits it, to finish.
  const importsSettled = () => act(async () => { await vi.dynamicImportSettled(); });
  async function settleLoads(failure?: Error, signInModule: object = signInCode()) {
    await act(async () => {
      for (const load of pending.splice(0)) {
        if (failure) load.reject(failure); else load.resolve(signInModule);
      }
    });
    await importsSettled();
  }
  async function coldOpen() {
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(loads).toBe(1));
    return hook;
  }
  beforeEach(() => {
    loads = 0; initAttempts = 0; pending = []; observers.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@/lib/firebaseAuth", () => {
      loads++;
      return new Promise((resolve, reject) => { pending.push({ resolve, reject }); });
    });
    mocks.observe.mockImplementation((_auth, callback) => {
      observers.add(callback); mocks.callback = callback;
      return () => { observers.delete(callback); };
    });
  });
  afterEach(async () => {
    // A load left pending keeps Vitest serving the real module; register the
    // plain mock before the next test queues its own.
    await settleLoads();
    vi.doMock("@/lib/firebaseAuth", signInCode);
    await import("@/lib/firebaseAuth");
  });

  it("observes once when the network returns mid-download, verifies once and unsubscribes on unmount", async () => {
    const hook = await coldOpen();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await importsSettled();
    await settleLoads();
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    expect(mocks.observe).toHaveBeenCalledOnce(); expect(observers.size).toBe(1);
    // A restored account gets one forced token refresh, not one per observer.
    const account = user("restored"); mocks.auth.currentUser = account;
    await act(async () => { await Promise.all([...observers].map(observer => observer(account))); });
    expect(mocks.claims).toHaveBeenCalledOnce(); expect(hook.result.current.user?.uid).toBe("restored");
    hook.unmount();
    expect(observers.size).toBe(0);
  });
  it("does not load the sign-in code again when 'Try again' runs mid-download", async () => {
    const hook = await coldOpen();
    await act(async () => { await hook.result.current.refreshAccess(); });
    await importsSettled();
    await settleLoads();
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    expect(loads).toBe(1);
    expect(mocks.observe).toHaveBeenCalledOnce(); expect(observers.size).toBe(1);
  });
  it("still retries on the next online event after a failed download, then observes once", async () => {
    const hook = await coldOpen();
    await settleLoads(chunkFailure());
    await waitFor(() => expect(hook.result.current.loginError).toContain("could not load"));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(loads).toBe(2));
    await settleLoads();
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    expect(hook.result.current.loginError).toBeNull();
    expect(mocks.observe).toHaveBeenCalledOnce(); expect(observers.size).toBe(1);
  });
  it("starts one new download when the backoff timer and the online event both fire after a failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hook = await coldOpen();
    await settleLoads(chunkFailure());
    await waitFor(() => expect(hook.result.current.loginError).toContain("could not load"));
    // The first backoff starts a retry; the network returns while it downloads.
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await waitFor(() => expect(loads).toBe(2));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await importsSettled();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await settleLoads();
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    expect(loads).toBe(2);
    expect(mocks.observe).toHaveBeenCalledOnce(); expect(observers.size).toBe(1);
  });
  it("retries at once, not after the backoff, when the network returned during a download that then fails", async () => {
    const hook = await coldOpen();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await importsSettled();
    await settleLoads(chunkFailure());
    // The first backoff is 2 s; this waits at most 1 s.
    await waitFor(() => expect(loads).toBe(2), { timeout: 1_000 });
    await settleLoads();
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    expect(hook.result.current.loginError).toBeNull();
    expect(mocks.observe).toHaveBeenCalledOnce(); expect(observers.size).toBe(1);
  });
  it.each(["auth/invalid-api-key", "auth/already-initialized"])("stops retrying and asks for a reload when Firebase Auth cannot initialize (%s)", async code => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hook = await coldOpen();
    await settleLoads(undefined, brokenSignInCode(firebaseError(code)));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.loginError).toBe("Google sign-in could not initialize. Reload the page and try again.");
    expect(hook.result.current.loginReady).toBe(false); expect(hook.result.current.user).toBeNull();
    // No retry timer: the cached module error would fail the same way forever.
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(initAttempts).toBe(1);
    expect(hook.result.current.loading).toBe(false); expect(hook.result.current.restoreSlow).toBe(false);
  });
  it.each([
    ["an import failure", chunkFailure],
    ["a Firebase network error", () => firebaseError("auth/network-request-failed")],
  ])("keeps retrying the sign-in code after %s", async (_kind, failure) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hook = await coldOpen();
    await settleLoads(undefined, brokenSignInCode(failure()));
    await waitFor(() => expect(hook.result.current.loginError).toContain("retrying automatically"));
    expect(hook.result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await waitFor(() => expect(initAttempts).toBe(2));
  });
  it("leaves no observer behind when the app unmounts before the sign-in code arrives", async () => {
    const hook = await coldOpen();
    hook.unmount();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await settleLoads();
    expect(loads).toBe(1);
    expect(mocks.observe).not.toHaveBeenCalled(); expect(observers.size).toBe(0);
  });
  it("completes a pending Google redirect once when the network returns mid-download", async () => {
    markGoogleRedirectPending();
    const returned = deferred(); mocks.redirectResult.mockImplementation(async () => { await returned.promise; return null; });
    const hook = await coldOpen();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await importsSettled();
    await settleLoads();
    await waitFor(() => expect(mocks.redirectResult).toHaveBeenCalled());
    await act(async () => { returned.resolve(); });
    await waitFor(() => expect(hook.result.current.loginReady).toBe(true));
    expect(mocks.redirectResult).toHaveBeenCalledExactlyOnceWith(mocks.auth, RESOLVER);
    expect(mocks.observe).toHaveBeenCalledOnce(); expect(observers.size).toBe(1);
  });
});
