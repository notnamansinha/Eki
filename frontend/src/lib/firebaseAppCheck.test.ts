// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ initialize: vi.fn(), token: vi.fn() }));
vi.mock("./firebaseCore", () => ({ firebaseApp: {} }));
vi.mock("firebase/app-check", () => ({
  initializeAppCheck: sdk.initialize, getToken: sdk.token,
  ReCaptchaEnterpriseProvider: class {}, CustomProvider: class {},
}));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_APPCHECK_DISABLED", "");
  sdk.initialize.mockReturnValue({}); sdk.token.mockResolvedValue({ token: "valid" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("App Check verification", () => {
  it("returns the verified SDK token for the authenticated API header", async () => {
    vi.stubEnv("NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY", "test-key");
    const { browserAppCheckToken } = await import("./firebaseAppCheck");
    expect(await browserAppCheckToken()).toBe("valid");
  });
  it("forces an App Check refresh for explicit access recovery", async () => {
    vi.stubEnv("NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY", "test-key");
    const { ensureAppCheck } = await import("./firebaseAppCheck");
    await ensureAppCheck({ forceRefresh: true }); expect(sdk.token).toHaveBeenCalledWith(expect.anything(), true);
  });
  it("retains one raw token acquisition after a caller timeout rather than repeatedly launching verification", async () => {
    vi.useFakeTimers(); vi.stubEnv("NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY", "test-key");
    let release!: (value: { token: string }) => void; sdk.token.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const { ensureAppCheck } = await import("./firebaseAppCheck");
    const first = expect(ensureAppCheck()).rejects.toMatchObject({ name: "AppCheckVerificationError" });
    await vi.advanceTimersByTimeAsync(10000); await first;
    const second = expect(ensureAppCheck({ forceRefresh: true })).rejects.toMatchObject({ name: "AppCheckVerificationError" });
    await vi.advanceTimersByTimeAsync(10000); await second; expect(sdk.token).toHaveBeenCalledOnce();
    release({ token: "late" }); await Promise.resolve();
    sdk.token.mockResolvedValue({ token: "fresh" });
    await ensureAppCheck({ forceRefresh: true }); expect(sdk.token).toHaveBeenCalledTimes(2);
  });
  it("does nothing on the server", async () => {
    vi.stubGlobal("window", undefined);
    await (await import("./firebaseAppCheck")).ensureAppCheck();
    expect(sdk.initialize).not.toHaveBeenCalled();
  });
  it("requires configuration by default in development", async () => {
    await expect((await import("./firebaseAppCheck")).ensureAppCheck()).rejects.toMatchObject({ name: "AppCheckVerificationError" });
  });
  it("permits an explicit unenforced development project", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APPCHECK_DISABLED", "true");
    await (await import("./firebaseAppCheck")).ensureAppCheck();
    expect(sdk.initialize).not.toHaveBeenCalled();
  });
  it("never bypasses production using the opt-out or debug token", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_FIREBASE_APPCHECK_DISABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN", "debug-only");
    await expect((await import("./firebaseAppCheck")).ensureAppCheck()).rejects.toMatchObject({ name: "AppCheckVerificationError" });
  });
  it.each(["test", "staging", ""])("does not enable the local opt-out in NODE_ENV=%s", async environment => {
    vi.stubEnv("NODE_ENV", environment); vi.stubEnv("NEXT_PUBLIC_FIREBASE_APPCHECK_DISABLED", "true");
    await expect((await import("./firebaseAppCheck")).ensureAppCheck()).rejects.toMatchObject({ name: "AppCheckVerificationError" });
    expect(sdk.token).not.toHaveBeenCalled();
  });
  it("exchanges the configured local debug token", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN", "registered-debug");
    await (await import("./firebaseAppCheck")).ensureAppCheck();
    expect((self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN).toBe("registered-debug");
    expect(sdk.token).toHaveBeenCalledOnce();
  });
  it("initializes once and waits for a valid token", async () => {
    vi.stubEnv("NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY", "test-key");
    const { ensureAppCheck } = await import("./firebaseAppCheck");
    await ensureAppCheck(); await ensureAppCheck(); expect(sdk.initialize).toHaveBeenCalledOnce();
  });
  it.each([{ token: "" }, { token: "fake", error: new Error("provider failed") }])("rejects an invalid token result %j", async result => {
    vi.stubEnv("NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY", "test-key"); sdk.token.mockResolvedValue(result);
    await expect((await import("./firebaseAppCheck")).ensureAppCheck()).rejects.toMatchObject({ name: "AppCheckVerificationError" });
  });
  it("normalizes SDK rejections without exposing provider details", async () => {
    vi.stubEnv("NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY", "test-key"); sdk.token.mockRejectedValue(new Error("sensitive-provider-detail"));
    await expect((await import("./firebaseAppCheck")).ensureAppCheck()).rejects.toThrow("Security verification is unavailable.");
  });
  it("normalizes the token deadline into the same recovery error", async () => {
    vi.useFakeTimers(); vi.stubEnv("NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY", "test-key"); sdk.token.mockReturnValue(new Promise(() => {}));
    const { ensureAppCheck } = await import("./firebaseAppCheck");
    const assertion = expect(ensureAppCheck()).rejects.toMatchObject({ name: "AppCheckVerificationError" });
    await vi.advanceTimersByTimeAsync(10000); await assertion;
  });
});
