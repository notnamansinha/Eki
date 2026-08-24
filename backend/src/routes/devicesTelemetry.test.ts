import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type IngestResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; reason: "credentials" }
  | { ok: false; reason: "rate_limit"; retryAfterMs: number };

const harness = vi.hoisted(() => ({
  result: { ok: true, duplicate: false } as IngestResult,
  diagnosticsAccepted: true,
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/firebaseAdmin", () => ({ db: {} }));

vi.mock("../services/telemetryPayload", () => ({
  parseTelemetryValue: () => ({
    ok: true,
    value: {
      lat: 23,
      lng: 72,
      speed: 0,
      heading: 0,
      motionState: "stopped",
      timestamp: Date.now(),
    },
  }),
}));

vi.mock("../services/deviceTelemetryService", () => ({
  ingestDeviceTelemetry: async () => harness.result,
  invalidateDeviceCredentialCache: () => undefined,
  publishDeviceCredentialInvalidation: async () => undefined,
  parseDeviceAuthorization: (header: string | undefined) =>
    header?.startsWith("Device ") ? header.slice("Device ".length) : null,
  recordTelemetryRejection: () => undefined,
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
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => {
  harness.result = { ok: true, duplicate: false };
  harness.diagnosticsAccepted = true;
});

function sendTelemetry() {
  return fetch(`${baseUrl}/api/devices/device_1/telemetry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Device ${"a".repeat(20)}`,
    },
    body: JSON.stringify({ sample: true }),
  });
}

function sendDiagnostics() {
  return fetch(`${baseUrl}/api/devices/device_1/diagnostics`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Device ${"a".repeat(20)}`,
    },
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

describe("device telemetry HTTP responses", () => {
  it("returns the accepted and duplicate statuses in the firmware contract", async () => {
    expect((await sendTelemetry()).status).toBe(202);

    harness.result = { ok: true, duplicate: true };
    expect((await sendTelemetry()).status).toBe(200);
  });

  it("returns a standards-compatible Retry-After delay for device throttling", async () => {
    harness.result = { ok: false, reason: "rate_limit", retryAfterMs: 1_234 };

    const response = await sendTelemetry();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    await expect(response.json()).resolves.toEqual({
      error: "Telemetry rate limit exceeded.",
      retryAfterMs: 1_234,
    });
  });

  it("does not attach retry guidance to credential rejection", async () => {
    harness.result = { ok: false, reason: "credentials" };

    const response = await sendTelemetry();

    expect(response.status).toBe(401);
    expect(response.headers.get("retry-after")).toBeNull();
  });

  it("accepts authenticated remote diagnostics and rejects bad credentials", async () => {
    expect((await sendDiagnostics()).status).toBe(202);

    harness.diagnosticsAccepted = false;
    expect((await sendDiagnostics()).status).toBe(401);
  });

  it("keeps the pre-auth telemetry limiter shared by campus NAT", async () => {
    const statuses = await Promise.all(Array.from({ length: 130 }, async (_, attempt) => {
      const deviceId = attempt % 2 === 0 ? "device_1" : "device_2";
      const response = await fetch(`${baseUrl}/api/devices/${deviceId}/telemetry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Device ${`a`.repeat(20)}`,
        },
        body: JSON.stringify({ sample: true }),
      });
      return response.status;
    }));

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });

  it("still caps unauthenticated telemetry by client IP", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 130; attempt += 1) {
      const deviceId = attempt % 2 === 0 ? "device_1" : "device_2";
      const response = await fetch(`${baseUrl}/api/devices/${deviceId}/telemetry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample: true }),
      });
      statuses.push(response.status);
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });

  it("returns the same retry contract when the outer per-device limiter rejects", async () => {
    let limited: Response | undefined;
    for (let attempt = 0; attempt < 130; attempt += 1) {
      const response = await sendTelemetry();
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBe("60");
    await expect(limited?.json()).resolves.toEqual({
      error: "Telemetry request limit exceeded.",
      retryAfterMs: 60_000,
    });
  });
});
