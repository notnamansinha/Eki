import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({
  device: { deviceId: "device", busId: "bus", routeId: "old", enabled: true, assignmentRevision: 1 } as Record<string, unknown>,
  locked: false, competing: false, retire: vi.fn(), invalidate: vi.fn(),
}));
vi.mock("../middleware/requireAdmin", () => ({ requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../services/deviceAssignmentRetirement", () => ({ retireDeviceAssignment: harness.retire }));
vi.mock("../services/deviceTelemetryService", () => ({
  authenticateDeviceCredentials: vi.fn(), ingestDeviceTelemetry: vi.fn(), parseDeviceAuthorization: vi.fn(),
  publishDeviceCredentialInvalidation: harness.invalidate, recordTelemetryRejection: vi.fn(),
}));
vi.mock("../services/deviceDiagnostics", () => ({ ingestDeviceDiagnostics: vi.fn(), parseDeviceDiagnosticsValue: vi.fn() }));
vi.mock("../lib/firebaseAdmin", () => {
  const ref = (collection: string, id: string) => ({ collection, id });
  const read = (value: ReturnType<typeof ref>) => ({
    exists: value.collection === "active_rides" || value.collection === "_active_bus_locks" ? harness.locked : true,
    data: () => value.collection === "devices" ? harness.device : value.collection === "buses" ? { assignedRoutes: ["old", "new", "third"] } : {},
    docs: harness.competing ? [{ id: "another" }] : [],
  });
  return { db: {
    collection: (name: string) => ({ doc: (id: string) => ref(name, id), where: () => ({ where: () => ref("query", "query") }) }),
    runTransaction: async (work: (tx: unknown) => Promise<unknown>) => work({
      get: async (value: ReturnType<typeof ref>) => read(value),
      set: (_ref: unknown, value: Record<string, unknown>) => { Object.assign(harness.device, value); },
      update: () => { delete harness.device.pendingAssignmentRetirement; },
    }),
  } };
});
import devicesRouter from "./devices";
let server: Server;
let url: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use("/api/devices", devicesRouter);
  server = await new Promise<Server>(done => { const listener = app.listen(0, "127.0.0.1", () => done(listener)); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("No test address");
  url = `http://127.0.0.1:${address.port}/api/devices/device`;
});
afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });
beforeEach(() => {
  harness.device = { deviceId: "device", busId: "bus", routeId: "old", enabled: true, assignmentRevision: 1 };
  harness.locked = false; harness.competing = false;
  harness.retire.mockReset().mockResolvedValue(undefined); harness.invalidate.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
const assign = (routeId = "new") => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ busId: "bus", routeId, enabled: true }) });
describe("device assignment HTTP retirement", () => {
  it("invalidates credentials and retires old presence before acknowledging", async () => {
    expect((await assign()).status).toBe(200);
    expect(harness.device).toMatchObject({ routeId: "new", assignmentRevision: 2 });
    expect(harness.device).not.toHaveProperty("pendingAssignmentRetirement");
    expect(harness.retire).toHaveBeenCalledWith("device", "bus", "old", 2);
  });
  it("durably retries retirement after a cross-store failure without losing the previous route", async () => {
    harness.retire.mockRejectedValueOnce(Error("RTDB temporarily unavailable"));
    expect((await assign()).status).toBe(500);
    expect(harness.device.pendingAssignmentRetirement).toEqual({ busId: "bus", routeId: "old", revision: 2 });
    expect((await assign("third")).status).toBe(409);
    expect((await assign()).status).toBe(200);
    expect(harness.retire).toHaveBeenLastCalledWith("device", "bus", "old", 2);
    expect(harness.device.assignmentRevision).toBe(2);
    expect(harness.device).not.toHaveProperty("pendingAssignmentRetirement");
  });
  it.each(["locked", "competing"] as const)("rejects %s reassignment without changing the registry or retiring presence", async key => {
    harness[key] = true;
    expect((await assign()).status).toBe(409);
    expect(harness.device.routeId).toBe("old");
    expect(harness.retire).not.toHaveBeenCalled();
  });
});
