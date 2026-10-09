import { describe, expect, it } from "vitest";
import { parseDeviceDiagnosticsValue } from "./deviceDiagnostics";

function validDiagnostics() {
  return {
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
  };
}

describe("device diagnostics payload", () => {
  it("accepts complete no-fix and last-response evidence while retaining legacy compatibility", () => {
    const payload = { ...validDiagnostics(), gnssFixAvailable: false, gnssNoFixMs: 300000, lastTelemetryResponseCode: 400 };
    expect(parseDeviceDiagnosticsValue(payload)).toEqual({ ok: true, value: payload });
    expect(parseDeviceDiagnosticsValue({ ...payload, gnssFixAvailable: true })).toEqual({ ok: false });
    expect(parseDeviceDiagnosticsValue({ ...payload, gnssNoFixMs: -1 })).toEqual({ ok: false });
    expect(parseDeviceDiagnosticsValue({ ...validDiagnostics(), gnssFixAvailable: false })).toEqual({ ok: false });
    expect(parseDeviceDiagnosticsValue({ ...payload, secret: "no" })).toEqual({ ok: false });
  });
  it("accepts the closed bounded firmware health contract", () => {
    expect(parseDeviceDiagnosticsValue(validDiagnostics())).toEqual({
      ok: true,
      value: validDiagnostics(),
    });
  });

  it("rejects unknown fields and unsafe values", () => {
    expect(parseDeviceDiagnosticsValue({
      ...validDiagnostics(),
      deviceSecret: "must-never-be-accepted",
    })).toEqual({ ok: false });
    expect(parseDeviceDiagnosticsValue({
      ...validDiagnostics(),
      rssiDbm: 20,
    })).toEqual({ ok: false });
    expect(parseDeviceDiagnosticsValue({
      ...validDiagnostics(),
      fault: "arbitrary",
    })).toEqual({ ok: false });
    expect(parseDeviceDiagnosticsValue({
      ...validDiagnostics(),
      fault: "wifi-recovery",
    })).toEqual({ ok: false });
  });
});
