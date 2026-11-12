// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { authLoadPolicy, hasStoredSessionHint, isWorkspacePath } from "./authLoadPolicy";

afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("authLoadPolicy (#522)", () => {
  it("loads Firebase immediately on the workspaces and without a router", () => {
    for (const path of ["/passenger", "/passenger/", "/admin", "/admin/", "/feedback", "/passenger/anything"]) {
      expect(authLoadPolicy(path, () => false)).toBe("eager");
    }
    expect(authLoadPolicy(null, () => false)).toBe("eager");
  });

  it("defers the signed-out landing page until the visitor interacts", () => {
    expect(authLoadPolicy("/", () => false)).toBe("on-intent");
    expect(authLoadPolicy("/", () => true)).toBe("eager");
  });

  it("never loads Firebase up front on /install or the 404 shell", () => {
    for (const path of ["/install", "/install/", "/does-not-exist", "/passengers", "/administrator"]) {
      expect(authLoadPolicy(path, () => true)).toBe("on-demand");
    }
    expect(isWorkspacePath("/passengers")).toBe(false);
  });

  it("treats stored accounts, role hints and Google redirects as a probable session", () => {
    expect(hasStoredSessionHint("key")).toBe(false);
    localStorage.setItem("firebase:authUser:key:[DEFAULT]", "{}");
    expect(hasStoredSessionHint("key")).toBe(true);
    localStorage.clear();
    localStorage.setItem("eki:role:uid-1", "passenger");
    expect(hasStoredSessionHint("key")).toBe(true);
    localStorage.clear();
    localStorage.setItem("eki:last-workspace", "/passenger");
    expect(hasStoredSessionHint("key")).toBe(true);
    localStorage.clear();
    sessionStorage.setItem("firebase:pendingRedirect:key:[DEFAULT]", '"true"');
    expect(hasStoredSessionHint("key")).toBe(true);
  });
});
