// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ app: { options: { authDomain: undefined as string | undefined, apiKey: "synthetic-key" } }, auth: {}, initialize: vi.fn() }));
vi.mock("./firebaseCore", () => ({ firebaseApp: fixture.app }));
vi.mock("firebase/auth", () => ({
  initializeAuth: fixture.initialize.mockReturnValue(fixture.auth),
  browserLocalPersistence: { type: "LOCAL" },
  indexedDBLocalPersistence: { type: "INDEXED_DB" },
  browserSessionPersistence: { type: "SESSION" },
  browserPopupRedirectResolver: {},
  GoogleAuthProvider: class {},
}));
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
async function initializeFor(userAgent?: string) {
  if (userAgent) vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  vi.resetModules();
  const sdk = await import("firebase/auth");
  const authModule = await import("./firebaseAuth");
  return { sdk, module: authModule, options: fixture.initialize.mock.lastCall?.[1] as Record<string, unknown> };
}
beforeEach(() => {
  fixture.initialize.mockClear();
  fixture.app.options.authDomain = undefined;
  sessionStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); });

describe("Firebase Auth initialization", () => {
  it("restores local persistence first without switching an existing tab to another store", async () => {
    const { sdk, module: { auth, googleProvider } } = await initializeFor();
    expect(fixture.initialize).toHaveBeenCalledExactlyOnceWith(fixture.app, {
      persistence: [sdk.browserLocalPersistence, sdk.indexedDBLocalPersistence, sdk.browserSessionPersistence],
      popupRedirectResolver: sdk.browserPopupRedirectResolver,
    });
    expect(auth).toBe(fixture.auth);
    expect(googleProvider).toBeInstanceOf(sdk.GoogleAuthProvider);
  });
  it("lets a phone report its auth state without waiting for Google's sign-in iframe", async () => {
    fixture.app.options.authDomain = window.location.host;
    const { sdk, module, options } = await initializeFor(IPHONE);
    expect(options).toEqual({ persistence: [sdk.browserLocalPersistence, sdk.indexedDBLocalPersistence, sdk.browserSessionPersistence] });
    // Sign-in still receives the resolver per call.
    expect(module.popupRedirectResolver).toBe(sdk.browserPopupRedirectResolver);
  });
  it("installs the resolver at startup while a phone returns from a Google redirect", async () => {
    fixture.app.options.authDomain = window.location.host;
    sessionStorage.setItem("eki:google-redirect-pending", "true");
    const { sdk, options } = await initializeFor(IPHONE);
    expect(options.popupRedirectResolver).toBe(sdk.browserPopupRedirectResolver);
  });
  it("installs the resolver at startup while Firebase still has a redirect pending without our marker", async () => {
    fixture.app.options.authDomain = window.location.host;
    sessionStorage.setItem("firebase:pendingRedirect:synthetic-key:[DEFAULT]", JSON.stringify("true"));
    const { sdk, options } = await initializeFor(IPHONE);
    expect(options.popupRedirectResolver).toBe(sdk.browserPopupRedirectResolver);
  });
  it("keeps the resolver at startup on popup platforms so the popup opens within the click", async () => {
    fixture.app.options.authDomain = window.location.host;
    const { sdk, options } = await initializeFor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0");
    expect(options.popupRedirectResolver).toBe(sdk.browserPopupRedirectResolver);
  });
});
