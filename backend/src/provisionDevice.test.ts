import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ runTransaction: vi.fn(), exit: vi.fn() }));
vi.mock("dotenv/config", () => ({}));
// Loading the real Firestore SDK costs ~1 s on the first dynamic import; the CLI only needs these sentinels.
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { delete: () => "<delete>", serverTimestamp: () => "<serverTimestamp>" },
}));
vi.mock("./lib/firebaseAdmin", () => ({
  db: { collection: () => ({ doc: (id: string) => ({ id }) }), runTransaction: fixture.runTransaction },
}));
vi.mock("./services/deviceTelemetryService", () => ({
  hashDeviceSecret: async () => "salt:hash",
  publishDeviceCredentialInvalidation: async () => undefined,
}));

const argv = process.argv;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  fixture.runTransaction.mockResolvedValue("saved");
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => { fixture.exit(code); }) as typeof process.exit);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { process.argv = argv; vi.restoreAllMocks(); });

async function run(...args: string[]) {
  process.argv = ["node", "provisionDevice.ts", ...args];
  await import("./provisionDevice");
  await vi.waitFor(() => expect(fixture.exit).toHaveBeenCalledOnce());
}

describe("device provisioning CLI", () => {
  it("provisions with complete arguments", async () => {
    await run("--device-id", "esp32_1", "--bus-id", "bus_1", "--route-id", "route_1");
    expect(fixture.runTransaction).toHaveBeenCalledOnce();
    expect(fixture.exit).toHaveBeenCalledWith(0);
  });

  it.each([
    [["--device-id", "--bus-id", "bus_1", "--route-id", "route_1"]],
    [["--device-id", "esp32_1", "--bus-id", "--route-id", "route_1"]],
    [["--device-id", "esp32_1", "--bus-id", "bus_1", "--route-id"]],
  ])("rejects a missing value instead of provisioning the next flag as an ID: %j", async (args) => {
    await run(...args);
    expect(fixture.runTransaction).not.toHaveBeenCalled();
    expect(fixture.exit).toHaveBeenCalledWith(1);
  });
});
