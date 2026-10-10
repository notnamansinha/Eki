import { contractFetch } from "../../test-support/openapi";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type IngestResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; reason: "credentials" | "unassigned" }
  | { ok: false; reason: "rate_limit"; retryAfterMs: number };

type CredentialStatus = "invalid" | "unassigned" | "assigned";

const harness = vi.hoisted(() => ({
  credentialStatus: "invalid" as CredentialStatus,
  telemetryResult: { ok: true, duplicate: false } as IngestResult,
  diagnosticsAccepted: "accepted" as "accepted" | "credentials" | "unassigned",
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/firebaseAdmin", () => ({ db: {} }));

vi.mock("../services/telemetryPayload", () => ({
  parseTelemetryValue: () => ({
    ok: true,
    value: {
      deviceSentAt: Date.now(),
      lat: 23,
      lng: 72,
      speed: 0,
      heading: 0,
      motionState: "stopped",
      seq: 1,
      timestamp: Date.now(),
    },
  }),
}));

vi.mock("../services/deviceTelemetryService", () => ({
  checkDeviceCredentials: async () => ({ status: harness.credentialStatus }),
  ingestDeviceTelemetry: async () => harness.telemetryResult,
  parseDeviceAuthorization: (header: string | undefined) =>
    header?.startsWith("Device ") ? header.slice("Device ".length) : null,
  publishDeviceCredentialInvalidation: async () => undefined,
  recordTelemetryRejection: () => undefined,
}));

vi.mock("../services/telemetryDiagnosticCounters", () => ({
  recordDiagnosticRejection: () => undefined,
  recordDiagnosticSchema: () => undefined,
}));

vi.mock("../services/deviceDiagnostics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/deviceDiagnostics")>();
  return {
    ...actual,
    ingestDeviceDiagnostics: async () => harness.diagnosticsAccepted,
  };
});

import devicesRouter from "./devices";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/devices", devicesRouter);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  harness.credentialStatus = "invalid";
  harness.telemetryResult = { ok: true, duplicate: false };
  harness.diagnosticsAccepted = "accepted";
});

const authHeader = { Authorization: "Device qa_secret" };

function sendTelemetry() {
  return contractFetch(`${baseUrl}/api/devices/device_1/telemetry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify({ sample: true }),
  });
}

function sendDiagnostics() {
  return contractFetch(`${baseUrl}/api/devices/device_1/diagnostics`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify({
      firmwareVersion: "gnss-compiletime-v1",
      uptimeMs: 30_000,
      freeHeapBytes: 180_000,
      rssiDbm: -55,
      queueDepth: 2,
      queueHighWater: 9,
      queueOverflowDrops: 0,
      queueStaleDrops: 1,
      acceptedFixes: 100,
      rejectedFixes: 2,
      nmeaChecksumFailures: 4,
      uartBufferOverflows: 0,
      uartFifoOverflows: 0,
      resetTotal: 3,
      fault: "none",
      flashEncryption: true,
      secureBoot: true,
      timestamp: 1_800_000_000_000,
    }),
  });
}

function checkFirmware() {
  return contractFetch(`${baseUrl}/api/devices/device_1/firmware?sequence=1`, {
    headers: authHeader,
  });
}

function acquireFirmwareInstallation() {
  return contractFetch(
    `${baseUrl}/api/devices/device_1/firmware/installation`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ action: "acquire" }),
    },
  );
}

describe("device 401-vs-403 credential status mapping (qa)", () => {
  it("telemetry: unassigned -> 403, invalid -> 401", async () => {
    harness.telemetryResult = { ok: false, reason: "unassigned" };
    const unassigned = await sendTelemetry();
    expect(unassigned.status).toBe(403);
    expect((await unassigned.json()).error).toBe(
      "Device assignment is unavailable.",
    );

    harness.telemetryResult = { ok: false, reason: "credentials" };
    const invalid = await sendTelemetry();
    expect(invalid.status).toBe(401);
    expect((await invalid.json()).error).toBe("Invalid device credentials.");
  });

  it("diagnostics: unassigned -> 403, invalid -> 401", async () => {
    harness.diagnosticsAccepted = "unassigned";
    const unassigned = await sendDiagnostics();
    expect(unassigned.status).toBe(403);
    expect((await unassigned.json()).error).toBe(
      "Device assignment is unavailable.",
    );

    harness.diagnosticsAccepted = "credentials";
    const invalid = await sendDiagnostics();
    expect(invalid.status).toBe(401);
    expect((await invalid.json()).error).toBe("Invalid device credentials.");
  });

  it("firmware release check: unassigned -> 403, invalid -> 401", async () => {
    harness.credentialStatus = "unassigned";
    const unassigned = await checkFirmware();
    expect(unassigned.status).toBe(403);
    expect((await unassigned.json()).error).toBe(
      "Device assignment is unavailable.",
    );

    harness.credentialStatus = "invalid";
    const invalid = await checkFirmware();
    expect(invalid.status).toBe(401);
    expect((await invalid.json()).error).toBe("Invalid device credentials.");
  });

  it("firmware installation: unassigned -> 403, invalid -> 401", async () => {
    harness.credentialStatus = "unassigned";
    const unassigned = await acquireFirmwareInstallation();
    expect(unassigned.status).toBe(403);
    expect((await unassigned.json()).error).toBe(
      "Device assignment is unavailable.",
    );

    harness.credentialStatus = "invalid";
    const invalid = await acquireFirmwareInstallation();
    expect(invalid.status).toBe(401);
    expect((await invalid.json()).error).toBe("Invalid device credentials.");
  });

  it("missing device secret is a 401 before any credential lookup", async () => {
    const response = await contractFetch(
      `${baseUrl}/api/devices/device_1/telemetry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample: true }),
      },
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Invalid device credentials.");
  });
});
