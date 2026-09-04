import { describe, expect, it } from "vitest";
import {
  parseTelemetryPayload,
  parseTelemetryValue,
  LEGACY_TELEMETRY_FIELDS,
  PREVIOUS_SEQUENCED_TELEMETRY_FIELDS,
  TELEMETRY_FIELDS,
} from "./telemetryPayload";

const now = 1_800_000_000_000;
const valid = {
  deviceSentAt: now,
  gpsHdop: 1.2,
  lat: 23.034,
  lng: 72.55,
  speed: 31.2,
  heading: 359.9,
  motionState: "moving",
  seq: 41,
  timestamp: now,
};

function encode(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

describe("parseTelemetryPayload", () => {
  it("accepts exactly the nine approved telemetry fields", () => {
    const parsed = parseTelemetryPayload(encode(valid), now);
    expect(parsed).toEqual({ ok: true, value: valid });
    expect(TELEMETRY_FIELDS).toHaveLength(9);
  });

  it("accepts the previous sequenced schema during staged rollout", () => {
    const { gpsHdop: _gpsHdop, ...previous } = valid;
    void _gpsHdop;
    expect(PREVIOUS_SEQUENCED_TELEMETRY_FIELDS).toHaveLength(8);
    expect(parseTelemetryValue(previous, now)).toEqual({
      ok: true,
      value: { ...previous, gpsHdop: null },
    });
  });

  it("accepts only the immediately previous closed schema during fleet rollout", () => {
    const legacy = {
      lat: valid.lat,
      lng: valid.lng,
      speed: valid.speed,
      heading: valid.heading,
      motionState: valid.motionState,
      timestamp: valid.timestamp,
    };
    expect(LEGACY_TELEMETRY_FIELDS).toHaveLength(6);
    expect(parseTelemetryValue(legacy, now)).toEqual({
      ok: true,
      value: { ...legacy, deviceSentAt: now, gpsHdop: null, seq: 1 },
    });
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
    expect(parseTelemetryPayload(encode({ ...valid, gpsHdop: 100 }), now)).toEqual({
      ok: false,
      reason: "invalid_gps_hdop",
    });
    expect(parseTelemetryPayload(encode({ ...valid, seq: 0 }), now)).toEqual({
      ok: false,
      reason: "invalid_sequence",
    });
    expect(
      parseTelemetryPayload(encode({ ...valid, timestamp: now - 60_001 }), now),
    ).toEqual({ ok: false, reason: "stale_or_invalid_timestamp" });
  });

  it("clamps an accepted future timestamp to wall clock so a skewed device clock cannot wedge a node", () => {
    const future = parseTelemetryPayload(encode({
      ...valid,
      timestamp: now + 5_000,
      deviceSentAt: now + 5_000,
    }), now);
    expect(future).toEqual({ ok: true, value: { ...valid, timestamp: now, deviceSentAt: now } });

    const boundary = parseTelemetryValue({
      ...valid,
      timestamp: now + 10_000,
      deviceSentAt: now + 10_000,
    }, now);
    expect(boundary).toEqual({ ok: true, value: { ...valid, timestamp: now, deviceSentAt: now } });

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
