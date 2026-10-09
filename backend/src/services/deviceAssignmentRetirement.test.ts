import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/firebaseAdmin", () => ({ rtdb: {} }));
import { retiredDevicePresence } from "./deviceAssignmentRetirement";
import { nextTelemetryValue } from "./deviceTelemetryService";
const old = { busId: "bus", routeId: "old", deviceId: "device", assignmentRevision: 1,
  deviceState: "online", timestamp: 1000, seq: 1 };
const sample = { lat: 23, lng: 72, speed: 0, heading: 0, gpsHdop: 1,
  motionState: "stopped" as const, timestamp: 2000, deviceSentAt: 2000, seq: 2 };
describe("device assignment retirement", () => {
  it("retires old presence and blocks an already authenticated old request", () => {
    const retired = retiredDevicePresence(old, "device", 2)!;
    expect(retired).toMatchObject({ retiredAssignmentRevision: 2, deviceState: "offline" });
    expect(nextTelemetryValue(retired, { busId: "bus", routeId: "old", assignmentRevision: 1 }, sample, 2100)).toBeUndefined();
  });
  it("permits a later reassignment back to the same route", () => {
    const next = nextTelemetryValue(retiredDevicePresence(old, "device", 2)!,
      { busId: "bus", routeId: "old", deviceId: "device", assignmentRevision: 3 }, sample, 2100);
    expect(next).toMatchObject({ deviceState: "online", assignmentRevision: 3 });
    expect(next).not.toHaveProperty("retiredAssignmentRevision");
  });
  it("does not fence a separately registered replacement device by another device's revision", () => {
    const next = nextTelemetryValue(retiredDevicePresence(old, "device", 20)!,
      { busId: "bus", routeId: "old", deviceId: "replacement", assignmentRevision: 1 }, sample, 2100);
    expect(next).toMatchObject({ deviceId: "replacement", deviceState: "online", assignmentRevision: 1 });
    expect(next).not.toHaveProperty("retiredAssignmentRevision");
  });
  it.each([
    { ...old, assignmentRevision: 3 }, { ...old, deviceId: "replacement" },
    { ...old, status: "active", sessionId: "armed" },
  ])("never retires a replacement assignment or an active service", current => {
    expect(retiredDevicePresence(current, "device", 2)).toBeUndefined();
  });
  it("fences legacy presence without deleting its retained metadata", () => {
    const legacy: Record<string, unknown> = { ...old };
    delete legacy.assignmentRevision; delete legacy.deviceId;
    const retired = retiredDevicePresence(legacy, "device", 1)!;
    expect(retired).toMatchObject({ ...legacy, deviceState: "offline", deviceId: "device", retiredAssignmentRevision: 1 });
    expect(nextTelemetryValue(retired, { busId: "bus", routeId: "old" }, sample, 2100)).toBeUndefined();
  });
});
