import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  authenticated: true,
  activeRide: false,
  activeBusLock: false,
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/firebaseAdmin", () => ({
  db: {
    collection: (name: string) => ({
      doc: () => ({
        get: async () => ({
          exists: name === "active_rides"
            ? harness.activeRide
            : harness.activeBusLock,
        }),
      }),
    }),
  },
}));

vi.mock("../services/telemetryPayload", () => ({
  parseTelemetryValue: () => ({ ok: false, reason: "shape" }),
}));

vi.mock("../services/deviceTelemetryService", () => ({
  authenticateDeviceCredentials: async () => harness.authenticated
    ? { busId: "bus_1", routeId: "route_1" }
    : null,
  ingestDeviceTelemetry: async () => ({ ok: false, reason: "credentials" }),
  invalidateDeviceCredentialCache: () => undefined,
  parseDeviceAuthorization: (header: string | undefined) =>
    header?.startsWith("Device ") ? header.slice("Device ".length) : null,
  recordTelemetryRejection: () => undefined,
}));

vi.mock("../services/deviceDiagnostics", () => ({
  ingestDeviceDiagnostics: async () => false,
  parseDeviceDiagnosticsValue: () => ({ ok: false }),
}));

import devicesRouter from "./devices";

let server: Server;
let baseUrl = "";
const releaseVariables = [
  "FIRMWARE_RELEASE_VERSION",
  "FIRMWARE_RELEASE_SEQUENCE",
  "FIRMWARE_RELEASE_URL",
  "FIRMWARE_RELEASE_SHA256",
  "FIRMWARE_RELEASE_SIZE",
] as const;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/devices", devicesRouter);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const name of releaseVariables) delete process.env[name];
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => {
  harness.authenticated = true;
  harness.activeRide = false;
  harness.activeBusLock = false;
  process.env.FIRMWARE_RELEASE_VERSION = "s2-gnss-v2";
  process.env.FIRMWARE_RELEASE_SEQUENCE = "2";
  process.env.FIRMWARE_RELEASE_URL = "https://releases.example.edu/firmware.bin";
  process.env.FIRMWARE_RELEASE_SHA256 = "ab".repeat(32);
  process.env.FIRMWARE_RELEASE_SIZE = "1500000";
});

function requestFirmware(sequence = "1", authorization = `Device ${"a".repeat(20)}`) {
  return fetch(`${baseUrl}/api/devices/device_1/firmware?sequence=${sequence}`, {
    headers: { Authorization: authorization },
  });
}

describe("device firmware release endpoint", () => {
  it("returns only the complete newer signed release descriptor", async () => {
    const response = await requestFirmware();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      version: "s2-gnss-v2",
      sequence: 2,
      url: "https://releases.example.edu/firmware.bin",
      sha256: "ab".repeat(32),
      size: 1500000,
    });
    expect((await requestFirmware("2")).status).toBe(204);
  });

  it("withholds updates during an active ride", async () => {
    harness.activeRide = true;
    expect((await requestFirmware()).status).toBe(204);
    harness.activeRide = false;
    harness.activeBusLock = true;
    expect((await requestFirmware()).status).toBe(204);
  });

  it("rejects bad credentials and malformed current sequences", async () => {
    harness.authenticated = false;
    expect((await requestFirmware()).status).toBe(401);
    expect((await requestFirmware("-1")).status).toBe(400);
  });

  it("fails closed when release configuration is partial", async () => {
    delete process.env.FIRMWARE_RELEASE_SHA256;
    expect((await requestFirmware()).status).toBe(503);
  });
});
