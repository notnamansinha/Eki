import { contractFetch } from "../../test-support/openapi";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  authenticated: true,
  unassigned: false,
  activeRide: false,
  activeBusLock: false,
  maintenance: null as Record<string, unknown> | null,
  transactionTail: Promise.resolve() as Promise<unknown>,
  disabled: new Map<string, Record<string, unknown>>(),
  invalidated: [] as string[],
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/firebaseAdmin", () => ({
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: name === "active_rides"
            ? harness.activeRide
            : name === "devices" || harness.activeBusLock || !!harness.maintenance,
          data: () => name === "devices" ? { busId: "bus_1", routeId: "route_1", enabled: true } : harness.maintenance,
        }),
        create: (value: Record<string, unknown>) => { harness.maintenance = value; },
        delete: () => { harness.maintenance = null; },
        set: async (value: Record<string, unknown>) => {
          if (name === "devices") harness.disabled.set(id, value);
        },
      }),
    }),
    runTransaction: (callback: (tx: unknown) => Promise<unknown>) => {
      type Ref = { get: () => Promise<unknown>; create: (value: Record<string, unknown>) => void; delete: () => void };
      const run = harness.transactionTail.then(() => callback({
        get: (ref: Ref) => ref.get(),
        create: (ref: Ref, value: Record<string, unknown>) => ref.create(value),
        delete: (ref: Ref) => ref.delete(),
      }));
      harness.transactionTail = run.catch(() => {});
      return run;
    },
  },
}));

vi.mock("../services/telemetryPayload", () => ({
  parseTelemetryValue: () => ({ ok: false, reason: "shape" }),
}));

vi.mock("../services/deviceTelemetryService", () => ({
  authenticateDeviceCredentials: async () => harness.authenticated
    ? { busId: "bus_1", routeId: "route_1" }
    : null,
  checkDeviceCredentials: async () => !harness.authenticated ? { status: "invalid" }
    : harness.unassigned ? { status: "unassigned" }
      : { status: "assigned", assignment: { busId: "bus_1", routeId: "route_1" } },
  ingestDeviceTelemetry: async () => ({ ok: false, reason: "credentials" }),
  invalidateDeviceCredentialCache: () => undefined,
  publishDeviceCredentialInvalidation: async (id: string) => {
    harness.invalidated.push(id);
  },
  parseDeviceAuthorization: (header: string | undefined) =>
    header?.startsWith("Device ") ? header.slice("Device ".length) : null,
  recordTelemetryRejection: () => undefined,
}));

vi.mock("../services/deviceDiagnostics", () => ({
  ingestDeviceDiagnostics: async () => false,
  parseDeviceDiagnosticsValue: () => ({ ok: false }),
}));

import devicesRouter, { devicesV2Router } from "./devices";

let server: Server;
let baseUrl = "";
const releaseVariables = [
  "FIRMWARE_RELEASE_VERSION",
  "FIRMWARE_RELEASE_SEQUENCE",
  "FIRMWARE_RELEASE_URL",
  "FIRMWARE_RELEASE_ALLOWED_ORIGIN",
  "FIRMWARE_RELEASE_SHA256",
  "FIRMWARE_RELEASE_SIZE",
] as const;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/devices", devicesRouter);
  app.use("/api/v2/devices", devicesV2Router);
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
  harness.unassigned = false;
  harness.activeRide = false;
  harness.activeBusLock = false;
  harness.maintenance = null;
  harness.transactionTail = Promise.resolve();
  harness.disabled = new Map();
  harness.invalidated = [];
  process.env.FIRMWARE_RELEASE_VERSION = "s2-gnss-v2";
  process.env.FIRMWARE_RELEASE_SEQUENCE = "2";
  process.env.FIRMWARE_RELEASE_URL = "https://releases.example.edu/firmware.bin";
  process.env.FIRMWARE_RELEASE_ALLOWED_ORIGIN = "https://releases.example.edu";
  process.env.FIRMWARE_RELEASE_SHA256 = "ab".repeat(32);
  process.env.FIRMWARE_RELEASE_SIZE = "1500000";
});

describe("device disable aliases", () => {
  it("shares disable and credential invalidation behavior", async () => {
    const v2 = await contractFetch(`${baseUrl}/api/v2/devices/device_1`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(v2.status).toBe(200);
    await expect(v2.json()).resolves.toEqual({ disabled: true });
    expect(harness.disabled.get("device_1")).toMatchObject({ enabled: false });
    expect(harness.invalidated).toEqual(["device_1"]);

    const legacy = await contractFetch(`${baseUrl}/api/devices/device_2/disable`, { method: "POST" });
    expect(legacy.status).toBe(200);
    expect(harness.invalidated).toEqual(["device_1", "device_2"]);
    const invalid = await contractFetch(`${baseUrl}/api/v2/devices/device_3`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(invalid.status).toBe(400);
    expect(harness.invalidated).toEqual(["device_1", "device_2"]);
  });
});

function requestFirmware(sequence = "1", authorization = `Device ${"a".repeat(20)}`) {
  return contractFetch(`${baseUrl}/api/devices/device_1/firmware?sequence=${sequence}`, {
    headers: { Authorization: authorization },
  });
}

describe("device firmware release endpoint", () => {
  const maintenance = (action: string, authorization = `Device ${"a".repeat(20)}`) =>
    contractFetch(`${baseUrl}/api/devices/device_1/firmware/installation`, {
      method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  it("rechecks ride state after discovery and reserves the shared bus lock", async () => {
    expect((await requestFirmware()).status).toBe(200);
    harness.activeRide = true;
    expect((await maintenance("acquire")).status).toBe(409);
    harness.activeRide = false;
    const results = await Promise.all([maintenance("acquire"), maintenance("acquire")]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await requestFirmware()).status).toBe(204);
    expect(harness.maintenance).toMatchObject({ kind: "firmware", deviceId: "device_1" });
    expect((await maintenance("release")).status).toBe(200);
    expect(harness.maintenance).toBeNull();
  });
  it("fails closed on authentication and never releases another device's or ride's lock", async () => {
    expect((await maintenance("acquire", "")).status).toBe(401);
    harness.authenticated = false;
    expect((await maintenance("acquire")).status).toBe(401);
    harness.authenticated = true;
    harness.maintenance = { kind: "firmware", deviceId: "other" };
    expect((await maintenance("release")).status).toBe(200);
    expect(harness.maintenance).toEqual({ kind: "firmware", deviceId: "other" });
    expect((await maintenance("unknown")).status).toBe(400);
  });
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
  it("returns 403 for a valid device without an assignment on OTA endpoints", async () => {
    harness.unassigned = true;
    expect((await requestFirmware()).status).toBe(403);
    expect((await maintenance("acquire")).status).toBe(403);
  });

  it("fails closed when release configuration is partial", async () => {
    delete process.env.FIRMWARE_RELEASE_SHA256;
    expect((await requestFirmware()).status).toBe(503);
  });
});
