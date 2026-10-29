// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { abandonGoogleRedirect, consumeGoogleRedirectPending, isGoogleRedirectPending, markGoogleRedirectPending, prefersGoogleRedirect } from "./googleSignInFlow";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe("Google OAuth flow selection", () => {
  it("keeps desktop browsers on the popup flow", () => {
    expect(prefersGoogleRedirect(window.location.host)).toBe(false);
  });
  it("recognizes iPad desktop mode and iOS installed mode", () => {
    vi.stubGlobal("navigator", { userAgent: "Desktop", platform: "MacIntel", maxTouchPoints: 5 });
    expect(prefersGoogleRedirect(window.location.host)).toBe(true);
    vi.stubGlobal("navigator", { userAgent: "Desktop", standalone: true });
    expect(prefersGoogleRedirect(window.location.host)).toBe(true);
  });
  it("does not force cross-origin redirects where storage partitioning would lose the session", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Android");
    expect(prefersGoogleRedirect("another-project.firebaseapp.com")).toBe(false);
    expect(prefersGoogleRedirect(undefined)).toBe(false);
  });
  it("treats the redirect marker as single-use and tolerates blocked storage", () => {
    markGoogleRedirectPending();
    expect(consumeGoogleRedirectPending()).toBe(true);
    expect(consumeGoogleRedirectPending()).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => markGoogleRedirectPending()).not.toThrow();
    expect(consumeGoogleRedirectPending()).toBe(false);
  });
  it("still sees a Google redirect Firebase has pending after Back from Google consumed our marker", () => {
    markGoogleRedirectPending();
    sessionStorage.setItem("firebase:pendingRedirect:synthetic-key:[DEFAULT]", JSON.stringify("true"));
    expect(consumeGoogleRedirectPending()).toBe(true);
    expect(isGoogleRedirectPending("synthetic-key")).toBe(true);
    // Reading the redirect result clears Firebase's flag.
    sessionStorage.removeItem("firebase:pendingRedirect:synthetic-key:[DEFAULT]");
    expect(isGoogleRedirectPending("synthetic-key")).toBe(false);
  });
  it("ignores a pending flag Firebase left for another API key, which it would never clear", () => {
    sessionStorage.setItem("firebase:pendingRedirect:rotated-key:[DEFAULT]", JSON.stringify("true"));
    expect(isGoogleRedirectPending("synthetic-key")).toBe(false);
    expect(isGoogleRedirectPending(undefined)).toBe(false);
  });
  it("abandons a redirect that never left the page: our marker and Firebase's flag both clear", () => {
    markGoogleRedirectPending();
    sessionStorage.setItem("firebase:pendingRedirect:synthetic-key:[DEFAULT]", JSON.stringify("true"));
    abandonGoogleRedirect("synthetic-key");
    expect(isGoogleRedirectPending("synthetic-key")).toBe(false);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => abandonGoogleRedirect("synthetic-key")).not.toThrow();
  });
  it("peeks at the redirect marker without consuming it and ignores unrelated session keys", () => {
    sessionStorage.setItem("firebase:authUser:synthetic-key:[DEFAULT]", JSON.stringify("true"));
    sessionStorage.setItem("firebase:pendingRedirect:synthetic-key:[DEFAULT]", JSON.stringify("false"));
    expect(isGoogleRedirectPending("synthetic-key")).toBe(false);
    markGoogleRedirectPending();
    expect(isGoogleRedirectPending()).toBe(true);
    expect(isGoogleRedirectPending()).toBe(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(isGoogleRedirectPending()).toBe(false);
  });
});
