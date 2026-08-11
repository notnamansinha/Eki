import { describe, expect, it } from "vitest";
import {
  parseTelemetryPayload,
  parseTelemetryValue,
  TELEMETRY_FIELDS,
} from "./telemetryPayload";

const now = 1_800_000_000_000;
const valid = {
  lat: 23.034,
  lng: 72.55,
  speed: 31.2,
  heading: 359.9,
  motionState: "moving",
  timestamp: now,
};

function encode(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

describe("parseTelemetryPayload", () => {
  it("accepts exactly the six approved telemetry fields", () => {
    const parsed = parseTelemetryPayload(encode(valid), now);
    expect(parsed).toEqual({ ok: true, value: valid });
    expect(TELEMETRY_FIELDS).toHaveLength(6);
  });

  it("validates an already parsed HTTPS JSON body with the same contract", () => {
    expect(parseTelemetryValue(valid, now)).toEqual({ ok: true, value: valid });
    expect(parseTelemetryValue({ ...valid, routeId: "route_1" }, now)).toEqual({
      ok: false,
      reason: "unexpected_fields",
    });
  });

  it.each(["busId", "routeId", "driverId", "hdop", "satellites", "lowAccuracy"])(
    "rejects removed or routing field %s",
    (field) => {
      expect(parseTelemetryPayload(encode({ ...valid, [field]: "bad" }), now)).toEqual({
        ok: false,
        reason: "unexpected_fields",
      });
    },
  );

  it("rejects a missing field", () => {
    const missing = { ...valid } as Partial<typeof valid>;
    delete missing.heading;
    expect(parseTelemetryPayload(encode(missing), now)).toEqual({
      ok: false,
      reason: "unexpected_fields",
    });
  });

  it("rejects out-of-range and stale values", () => {
    expect(parseTelemetryPayload(encode({ ...valid, lat: 91 }), now).ok).toBe(false);
    expect(parseTelemetryPayload(encode({ ...valid, speed: 201 }), now).ok).toBe(false);
    expect(parseTelemetryPayload(encode({ ...valid, heading: 360 }), now).ok).toBe(false);
    expect(
      parseTelemetryPayload(encode({ ...valid, timestamp: now - 60_001 }), now),
    ).toEqual({ ok: false, reason: "stale_or_invalid_timestamp" });
  });

  it("clamps an accepted future timestamp to wall clock so a skewed device clock cannot wedge a node", () => {
    const future = parseTelemetryPayload(encode({ ...valid, timestamp: now + 5_000 }), now);
    expect(future).toEqual({ ok: true, value: { ...valid, timestamp: now } });

    const boundary = parseTelemetryValue({ ...valid, timestamp: now + 10_000 }, now);
    expect(boundary).toEqual({ ok: true, value: { ...valid, timestamp: now } });

    const beyond = parseTelemetryValue({ ...valid, timestamp: now + 10_001 }, now);
    expect(beyond).toEqual({ ok: false, reason: "stale_or_invalid_timestamp" });
  });

  it("rejects oversized and malformed JSON", () => {
    expect(parseTelemetryPayload(Buffer.alloc(513), now)).toEqual({
      ok: false,
      reason: "payload_size",
    });
    expect(parseTelemetryPayload(Buffer.from("{"), now)).toEqual({
      ok: false,
      reason: "invalid_json",
    });
  });
});
