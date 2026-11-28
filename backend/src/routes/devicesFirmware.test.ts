import { contractFetch } from "../../test-support/openapi";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  authenticated: true,
  validSecret: "a".repeat(20),
  deviceEnabled: true,
  unassigned: false,
  activeRide: false,
  activeBusLock: false,
  maintenance: null as Record<string, unknown> | null,
  transactionTail: Promise.resolve() as Promise<unknown>,
  disabled: new Map<string, Record<string, unknown>>(),
  invalidated: [] as string[],
  credentialChecks: 0,
  throttled: false,
  verifyIdentity: vi.fn(),
}));

vi.mock("../middleware/verifiedRequest", () => ({ verifyRequestToken: harness.verifyIdentity }));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/firebaseAdmin", () => ({
  firebaseAdminApp: {},
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: name === "active_rides"
            ? harness.activeRide
            : name === "devices" || (name === "_active_bus_locks" && (harness.activeBusLock || !!harness.maintenance)),
          data: () => name === "devices" ? { busId: "bus_1", routeId: "route_1", enabled: harness.deviceEnabled }
            : name === "_active_bus_locks" ? harness.maintenance : undefined,
        }),
        create: (value: Record<string, unknown>) => { harness.maintenance = value; },
        delete: () => { harness.maintenance = null; },
        set: async (value: Record<string, unknown>) => {
          if (name === "devices") harness.disabled.set(id, value);
        },
        update: async (value: Record<string, unknown>) => {
          if (name === "devices" && id === "missing_device") throw Object.assign(new Error("No document to update"), { code: 5 });
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
  checkDeviceCredentials: async (deviceId: string, secret: string) => {
    harness.credentialChecks += 1;
    if (harness.throttled) throw new (await import("../lib/deviceCredentialGuard")).DeviceCredentialThrottledError("ip");
    const expectedSecret = deviceId === "device_1" ? harness.validSecret : deviceId === "device_2" ? "c".repeat(20) : null;
    return !harness.authenticated || !harness.deviceEnabled || secret !== expectedSecret ? { status: "invalid" }
    : harness.unassigned ? { status: "unassigned" }
      : { status: "assigned", assignment: { busId: "bus_1", routeId: "route_1" } };
  },
  ingestDeviceTelemetry: async () => ({ ok: false, reason: "credentials" }),
  invalidateDeviceCredentialCache: () => undefined,
  publishDeviceCredentialInvalidation: async (id: string) => {
    harness.invalidated.push(id);
  },
  parseDeviceAuthorization: (header: string | undefined) =>
    header?.startsWith("Device ") && header.length >= 27 && header.length <= 519 ? header.slice("Device ".length) : null,
  recordTelemetryRejection: () => undefined,
}));

vi.mock("../services/deviceDiagnostics", () => ({
  ingestDeviceDiagnostics: async () => false,
  parseDeviceDiagnosticsValue: () => ({ ok: false }),
}));

import devicesRouter, { devicesV2Router } from "./devices";
import { createBrowserAdmission, createBrowserIngressLimiter } from "../lib/browserAdmission";
import { isDeviceIngressPath } from "../lib/deviceIngressPolicy";

let server: Server;
let baseUrl = "";
const integrationServers: Server[] = [];
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
  await Promise.all(integrationServers.map(listener => new Promise<void>((resolve, reject) => {
    listener.close(error => error ? reject(error) : resolve());
    listener.closeAllConnections();
  })));
});

beforeEach(() => {
  harness.authenticated = true;
  harness.validSecret = "a".repeat(20);
  harness.deviceEnabled = true;
  harness.unassigned = false;
  harness.activeRide = false;
  harness.activeBusLock = false;
  harness.maintenance = null;
  harness.transactionTail = Promise.resolve();
  harness.disabled = new Map();
  harness.invalidated = [];
  harness.credentialChecks = 0;
  harness.throttled = false;
  harness.verifyIdentity.mockReset();
  harness.verifyIdentity.mockResolvedValue({ uid: "rider", admin: false });
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
    for (const missing of [
      contractFetch(`${baseUrl}/api/devices/missing_device/disable`, { method: "POST" }),
      contractFetch(`${baseUrl}/api/v2/devices/missing_device`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) }),
    ]) {
      expect((await missing).status).toBe(404);
    }
    expect(harness.disabled.has("missing_device")).toBe(false);
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

  it("answers a refused credential check with 429 and a 10 s Retry-After on both firmware paths", async () => {
    harness.throttled = true;
    const base = await bootDeviceIngress();
    const valid = `Device ${harness.validSecret}`;
    const update = await fetch(`${base}/api/devices/device_1/firmware?sequence=1`, { headers: { Authorization: valid } });
    expect(update.status).toBe(429);
    expect(update.headers.get("retry-after")).toBe("10");
    await expect(update.json()).resolves.toEqual({ error: "Too many failed device credential checks.", retryAfterMs: 10_000 });
    const reservation = await installation(base, "acquire", valid);
    expect(reservation.status).toBe(429);
    expect(reservation.headers.get("retry-after")).toBe("10");
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

async function bootDeviceIngress() {
  const app = express();
  app.use(createBrowserIngressLimiter(1, 1000));
  app.use(express.json());
  app.use("/api", createBrowserAdmission(1, { read: 100, mutation: 100 }));
  app.use("/api/devices", devicesRouter);
  const listener = await new Promise<Server>(resolve => {
    const running = app.listen(0, "127.0.0.1", () => resolve(running));
  });
  integrationServers.push(listener);
  const address = listener.address();
  if (!address || typeof address === "string") throw Error("Test server did not bind.");
  return `http://127.0.0.1:${address.port}`;
}

function installation(base: string, action: string, authorization?: string, deviceId = "device_1") {
  return fetch(`${base}/api/devices/${deviceId}/firmware/installation`, {
    method: "POST", headers: {
      ...(authorization === undefined ? {} : { Authorization: authorization }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action }),
  });
}

describe("device OTA through browser admission and the production router", () => {
  const valid = `Device ${"a".repeat(20)}`;
  it("acquires and releases without browser identity or attestation", async () => {
    const base = await bootDeviceIngress();
    expect((await installation(base, "acquire", valid)).status).toBe(200);
    expect(harness.maintenance).toMatchObject({ kind: "firmware", deviceId: "device_1" });
    expect((await installation(base, "release", valid)).status).toBe(200);
    expect(harness.maintenance).toBeNull();
    expect((await installation(base, "release", valid)).status).toBe(200);
    expect(harness.credentialChecks).toBe(3);
    expect(harness.verifyIdentity).not.toHaveBeenCalled();
  });

  it("releases a reservation acquired through another server instance", async () => {
    const first = await bootDeviceIngress();
    const second = await bootDeviceIngress();
    expect((await installation(first, "acquire", valid)).status).toBe(200);
    expect(harness.maintenance).toMatchObject({ deviceId: "device_1" });
    expect((await installation(second, "release", valid)).status).toBe(200);
    expect(harness.maintenance).toBeNull();
  });

  it("keeps missing, malformed, invalid, rotated, disabled and unassigned credentials denied", async () => {
    const base = await bootDeviceIngress();
    for (const authorization of [undefined, "Bearer browser", "Device short", `Device ${"b".repeat(20)}`]) {
      expect((await installation(base, "acquire", authorization)).status).toBe(401);
    }
    harness.validSecret = "b".repeat(20);
    expect((await installation(base, "acquire", valid)).status).toBe(401);
    expect((await installation(base, "acquire", `Device ${harness.validSecret}`)).status).toBe(200);
    expect((await installation(base, "release", `Device ${harness.validSecret}`)).status).toBe(200);
    harness.deviceEnabled = false;
    expect((await installation(base, "acquire", `Device ${harness.validSecret}`)).status).toBe(401);
    harness.deviceEnabled = true;
    harness.unassigned = true;
    expect((await installation(base, "acquire", `Device ${harness.validSecret}`)).status).toBe(403);
    expect(harness.maintenance).toBeNull();
  });

  it("preserves ride, conflicting lock, owner and retry safeguards", async () => {
    const base = await bootDeviceIngress();
    harness.activeRide = true;
    expect((await installation(base, "acquire", valid)).status).toBe(409);
    harness.activeRide = false;
    harness.maintenance = { kind: "firmware", deviceId: "other" };
    expect((await installation(base, "acquire", valid)).status).toBe(409);
    expect((await installation(base, "release", valid)).status).toBe(200);
    expect(harness.maintenance).toMatchObject({ deviceId: "other" });
    // A ride lock can carry the same device ID; only firmware locks may be released.
    harness.maintenance = { kind: "ride", deviceId: "device_1" };
    expect((await installation(base, "acquire", valid)).status).toBe(409);
    expect((await installation(base, "release", valid)).status).toBe(200);
    expect(harness.maintenance).toEqual({ kind: "ride", deviceId: "device_1" });
    harness.maintenance = null;
    const concurrent = await Promise.all([installation(base, "acquire", valid), installation(base, "acquire", valid)]);
    expect(concurrent.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await installation(base, "release", valid, "device_2")).status).toBe(401);
    expect(harness.maintenance).toMatchObject({ deviceId: "device_1" });
    expect((await installation(base, "release", `Device ${"c".repeat(20)}`, "device_2")).status).toBe(200);
    expect(harness.maintenance).toMatchObject({ deviceId: "device_1" });
    expect((await installation(base, "release", valid)).status).toBe(200);
    expect(harness.maintenance).toBeNull();
  });

  it("keeps an existing reservation intact when release credentials are denied", async () => {
    const base = await bootDeviceIngress();
    expect((await installation(base, "acquire", valid)).status).toBe(200);
    const reservation = { ...harness.maintenance };
    for (const authorization of [undefined, "Bearer browser", "Device short", `Device ${"b".repeat(20)}`]) {
      expect((await installation(base, "release", authorization)).status).toBe(401);
      expect(harness.maintenance).toEqual(reservation);
    }
    harness.validSecret = "b".repeat(20);
    expect((await installation(base, "release", valid)).status).toBe(401);
    expect(harness.maintenance).toEqual(reservation);
    harness.deviceEnabled = false;
    expect((await installation(base, "release", `Device ${harness.validSecret}`)).status).toBe(401);
    expect(harness.maintenance).toEqual(reservation);
    harness.deviceEnabled = true;
    harness.unassigned = true;
    expect((await installation(base, "release", `Device ${harness.validSecret}`)).status).toBe(403);
    expect(harness.maintenance).toEqual(reservation);
    harness.unassigned = false;
    expect((await installation(base, "release", `Device ${harness.validSecret}`)).status).toBe(200);
    expect(harness.maintenance).toBeNull();
  });

  it("applies one exact device path policy to all ingress endpoints", async () => {
    const base = await bootDeviceIngress();
    for (const [method, path] of [
      ["POST", "/api/devices/device_1/telemetry"],
      ["POST", "/api/devices/device_1/diagnostics"],
      ["GET", "/api/devices/device_1/firmware"],
      ["POST", "/api/devices/device_1/firmware/installation"],
    ]) expect(isDeviceIngressPath(method, path)).toBe(true);
    expect((await fetch(`${base}/api/devices/device_1/telemetry`, { method: "POST", headers: { Authorization: valid, "Content-Type": "application/json" }, body: "{}" })).status).toBe(400);
    expect((await fetch(`${base}/api/devices/device_1/diagnostics`, { method: "POST", headers: { Authorization: valid, "Content-Type": "application/json" }, body: "{}" })).status).toBe(400);
    expect((await fetch(`${base}/api/devices/device_1/firmware?sequence=1`, { headers: { Authorization: valid } })).status).toBe(200);
    const checks = harness.credentialChecks;
    for (const [method, path] of [
      ["POST", "/api/devices/device_1/firmware/installation/extra"],
      ["PUT", "/api/devices/device_1/firmware/installation"],
      ["POST", "/api/devices/device_1/firmware"],
      ["GET", "/api/devices/device_1/telemetry"],
    ]) {
      expect(isDeviceIngressPath(method, path)).toBe(false);
      expect((await fetch(base + path, { method, headers: { Authorization: valid } })).status).toBe(401);
    }
    expect(harness.credentialChecks).toBe(checks);
  });

  it("admits browser identity without attestation while retaining device credentials", async () => {
    const base = await bootDeviceIngress();
    const path = "/api/devices/device_1/firmware/installation";
    // The non-exempt trailing slash reaches browser authentication first, then
    // the real device handler must still reject a browser bearer credential.
    const response = await fetch(`${base}${path}/`, {
      method: "POST", headers: { Authorization: "Bearer rider", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "acquire" }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid firmware maintenance request." });
    expect(harness.verifyIdentity).toHaveBeenCalledTimes(1);
    expect(harness.credentialChecks).toBe(0);
    expect(harness.maintenance).toBeNull();
  });
});
