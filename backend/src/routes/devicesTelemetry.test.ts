import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type IngestResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; reason: "credentials" }
  | { ok: false; reason: "rate_limit"; retryAfterMs: number };

const harness = vi.hoisted(() => ({
  result: { ok: true, duplicate: false } as IngestResult,
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
  parseDeviceAuthorization: (header: string | undefined) =>
    header?.startsWith("Device ") ? header.slice("Device ".length) : null,
  recordTelemetryRejection: () => undefined,
}));

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
});
