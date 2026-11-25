import { describe, expect, it, vi } from "vitest";
import { assertEmulatorEnvironment, emulatorDatabaseUrl, installCommittedDatabaseRules } from "./emulatorIsolation";
const valid = { GCLOUD_PROJECT: "demo-eki-qa", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
  FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9005", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9095",
  EKI_QA_CONFIRM_DISPOSABLE: "1", EKI_QA_EXTERNAL_PROVIDERS: "mock", FIREBASE_DATABASE_URL: "http://127.0.0.1:9005/" };
describe("emulator SDK configuration boundary", () => {
  it("requires complete demo configuration and the preloaded transport guard", () => {
    const target = globalThis as typeof globalThis & { __ekiQaNetworkGuard?: { enabled: boolean } };
    const original = target.__ekiQaNetworkGuard;
    try {
      target.__ekiQaNetworkGuard = { enabled: true };
      expect(() => assertEmulatorEnvironment(valid)).not.toThrow();
      for (const [key, value] of Object.entries(valid)) {
        expect(() => assertEmulatorEnvironment({ ...valid, [key]: undefined }), key).toThrow();
        expect(() => assertEmulatorEnvironment({ ...valid, [key]: value + "-external" }), key).toThrow();
      }
      expect(() => assertEmulatorEnvironment({ ...valid, GOOGLE_APPLICATION_CREDENTIALS: "private-value" })).toThrow(/forbidden/);
      target.__ekiQaNetworkGuard = undefined;
      expect(() => assertEmulatorEnvironment(valid)).toThrow(/preloaded/);
    } finally { target.__ekiQaNetworkGuard = original; }
  });
  it("builds literal-loopback URLs only for synthetic demo namespaces", () => {
    expect(emulatorDatabaseUrl("demo-eki-ingest-test")).toBe("http://127.0.0.1:9005/?ns=demo-eki-ingest-test-default-rtdb");
    for (const project of ["eki-production", "demo-eki-../", "https://cloud", "demo-other-test"])
      expect(() => emulatorDatabaseUrl(project)).toThrow(/synthetic/);
  });
  it("installs the committed rules only on a loopback emulator and a synthetic namespace", async () => {
    const fetched: Array<{ url: string; init: RequestInit }> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => { fetched.push({ url: String(url), init: init! }); return new Response("{}"); });
    try {
      for (const host of ["", "localhost:9005", "10.0.0.5:9005", "bustrack-be165-asia-rtdb.asia-southeast1.firebasedatabase.app", "127.0.0.1:9005@evil"])
        await expect(installCommittedDatabaseRules("demo-eki-rules-test", host)).rejects.toThrow(/Loopback/);
      await expect(installCommittedDatabaseRules("eki-production", "127.0.0.1:9005")).rejects.toThrow(/synthetic/);
      expect(fetched).toHaveLength(0);
      await installCommittedDatabaseRules("demo-eki-rules-test", "127.0.0.1:9005");
      expect(fetched).toHaveLength(1);
      expect(fetched[0].url).toBe("http://127.0.0.1:9005/.settings/rules.json?ns=demo-eki-rules-test-default-rtdb");
      expect(JSON.parse(String(fetched[0].init.body)).rules.publicRouteBuses).toBeDefined();
    } finally { fetchSpy.mockRestore(); }
  });
});
