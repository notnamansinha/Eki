import { describe, expect, it } from "vitest";
import { generateGnssPlan } from "../../../docs/testing/simulations/generate-gnss.mjs";
import { checkSeededProperty } from "../../../scripts/qa/seeded-property.mjs";
import { parseTelemetryPayload, parseTelemetryValue } from "./telemetryPayload";
import { adaptiveGnssErrorMeters, evaluateOutageReacquisition, isPlausibleTelemetryTransition } from "../lib/telemetryMotion";
import { haversineMeters } from "../lib/geo";

const epoch = 1_800_000_000_000;
const valid = { lat: 23, lng: 72, speed: 30, heading: 90, gpsHdop: 1,
  motionState: "moving", seq: 1, timestamp: epoch, deviceSentAt: epoch };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const fromMeters = (meters: number) => meters / 6_371_000 * 180 / Math.PI;
const seed = process.env.EKI_QA_SEED === undefined ? 42 : Number(process.env.EKI_QA_SEED);
const replayPath = process.env.EKI_QA_REPLAY_PATH === undefined ? undefined : Number(process.env.EKI_QA_REPLAY_PATH);
const property = (options: Record<string, unknown>) => checkSeededProperty({ seed, runs: 400, replayPath, ...options });

describe("deterministic GNSS software properties", () => {
  it("enforces numeric coordinate speed heading HDOP and sequence boundaries", () => {
    const dimensions = [
      ["lat", [-90, 0, 90], [-90.000001, 90.000001], "invalid_lat"],
      ["lng", [-180, 0, 180], [-180.000001, 180.000001], "invalid_lng"],
      ["speed", [0, 2.5, 200], [-0.000001, 200.000001], "invalid_speed"],
      ["heading", [0, 0.01, 359.999999], [-0.000001, 360], "invalid_heading"],
      ["gpsHdop", [0, 4, 4.000001, 99], [-0.000001, 99.000001], "invalid_gps_hdop"],
      ["seq", [1, 0xffffffff], [0, -1, 1.1, 0x100000000], "invalid_sequence"],
    ] as const;
    for (const [key, accepted, rejected, reason] of dimensions) {
      for (const value of accepted) expect(parseTelemetryValue({ ...valid, [key]: value }, epoch).ok, `${key}=${value}`).toBe(true);
      for (const value of [...rejected, NaN, Infinity, -Infinity, null, "1", [], {}]) {
        expect(parseTelemetryValue({ ...valid, [key]: value }, epoch), `${key}=${String(value)}`).toEqual({ ok: false, reason });
      }
    }
  });
  it("enforces inclusive sample clock and send clock bounds with future clamping", () => {
    for (const offset of [-60000, -59999, 0, 9999, 10000]) {
      const timestamp = epoch + offset;
      const input = { ...valid, timestamp, deviceSentAt: Math.max(timestamp, epoch) };
      expect(parseTelemetryValue(input, epoch)).toEqual({ ok: true, value: {
        ...input, timestamp: Math.min(timestamp, epoch), deviceSentAt: epoch,
        ...(timestamp > epoch ? { deviceTimestamp: timestamp } : {}),
      } });
    }
    for (const offset of [-60001, 10001]) expect(parseTelemetryValue({ ...valid, timestamp: epoch + offset }, epoch))
      .toEqual({ ok: false, reason: "stale_or_invalid_timestamp" });
    for (const timestamp of [epoch - 0.5, epoch + 0.5, NaN, Infinity, -Infinity, null, String(epoch), [], {}]) {
      expect(parseTelemetryValue({ ...valid, timestamp }, epoch)).toEqual({ ok: false, reason: "stale_or_invalid_timestamp" });
    }
    for (const timestamp of [epoch - 0.5, epoch + 0.5]) {
      expect(parseTelemetryPayload(encode({ ...valid, timestamp }), epoch))
        .toEqual({ ok: false, reason: "stale_or_invalid_timestamp" });
    }
    for (const deviceSentAt of [epoch - 1, epoch + 10001, epoch + 0.5, "1800000000000", null]) {
      expect(parseTelemetryValue({ ...valid, deviceSentAt }, epoch)).toEqual({ ok: false, reason: "invalid_device_sent_at" });
    }
    expect(parseTelemetryValue({ ...valid, deviceSentAt: epoch + 10000 }, epoch))
      .toEqual({ ok: true, value: valid });
  });
  it("enforces closed rollout schemas and motion enum without trusting assignment fields", () => {
    const { gpsHdop: _hdop, ...eight } = valid; void _hdop;
    const { seq: _seq, deviceSentAt: _sent, ...six } = eight; void _seq; void _sent;
    expect(parseTelemetryValue(eight, epoch)).toEqual({ ok: true, value: { ...valid, gpsHdop: null } });
    expect(parseTelemetryValue(six, epoch)).toEqual({ ok: true, value: { ...valid, gpsHdop: null } });
    for (const key of ["busId", "routeId", "sessionId", "driverId", "constructor", "__proto__"]) {
      const malicious = JSON.parse(JSON.stringify(valid).slice(0, -1) + `,"${key}":"forged"}`);
      expect(parseTelemetryValue(malicious, epoch)).toEqual({ ok: false, reason: "unexpected_fields" });
    }
    for (const motionState of ["Moving", "", "unknown", null, 1]) expect(parseTelemetryValue({ ...valid, motionState }, epoch))
      .toEqual({ ok: false, reason: "invalid_motion_state" });
    for (const motionState of ["moving", "stopped", "uncertain"]) expect(parseTelemetryValue({ ...valid, motionState }, epoch).ok).toBe(true);
  });
  it("enforces the 512 byte boundary before decoding malformed or multibyte JSON", () => {
    const body = encode(valid);
    for (const bytes of [511, 512]) expect(parseTelemetryPayload(Buffer.concat([body, Buffer.alloc(bytes - body.length, 32)]), epoch).ok).toBe(true);
    expect(parseTelemetryPayload(Buffer.concat([body, Buffer.alloc(513 - body.length, 32)]), epoch))
      .toEqual({ ok: false, reason: "payload_size" });
    const unicode = JSON.stringify({ ...valid, "é": "🙂" });
    expect(Buffer.byteLength(unicode)).toBeGreaterThan(unicode.length);
    const padded = Buffer.concat([Buffer.from(unicode), Buffer.alloc(512 - Buffer.byteLength(unicode), 32)]);
    expect(parseTelemetryPayload(padded, epoch)).toEqual({ ok: false, reason: "unexpected_fields" });
    expect(parseTelemetryPayload(Buffer.concat([padded, Buffer.from(" ")]), epoch)).toEqual({ ok: false, reason: "payload_size" });
    for (const text of ["{", "null", "[]", JSON.stringify(valid) + "{}"])
      expect(parseTelemetryPayload(Buffer.from(text), epoch).ok).toBe(false);
  });
  it("accepts seeded legal payloads with independent clock normalization", () => {
    property({ generate: (random: () => number) => ({ ...valid, lat: random() * 180 - 90,
      lng: random() * 360 - 180, speed: random() * 200, heading: random() * 360,
      gpsHdop: random() * 99, seq: Math.floor(random() * 0xffffffff) + 1,
      timestamp: epoch + Math.floor(random() * 70001) - 60000 }),
    check: (input: typeof valid) => {
      const payload = { ...input, deviceSentAt: Math.max(epoch, input.timestamp) };
      expect(parseTelemetryPayload(encode(payload), epoch)).toEqual({ ok: true, value: { ...input,
        timestamp: Math.min(epoch, input.timestamp), deviceSentAt: epoch,
        ...(input.timestamp > epoch ? { deviceTimestamp: input.timestamp } : {}) } });
    } });
  });
  it("rejects seeded adversarial authority fields without modifying the valid input", () => {
    property({ generate: (random: () => number) => ({ key: ["busId", "routeId", "driverId", "sessionId"][Math.floor(random() * 4)], value: Math.floor(random() * 10000) }),
      check: ({ key, value }: { key: string; value: number }) => {
        expect(parseTelemetryPayload(encode({ ...valid, [key]: value }), epoch)).toEqual({ ok: false, reason: "unexpected_fields" });
        expect(parseTelemetryValue(valid, epoch)).toEqual({ ok: true, value: valid });
      } });
  });
  it("replays every declared profile deterministically and detects its transport disturbances", () => {
    const profiles = ["moving", "reverse", "stationary", "jitter", "stop-start", "duplicate", "reorder", "burst", "outage45", "outage120", "outage301", "teleport", "poor-hdop", "uncertain", "missing-hdop", "invalid-speed", "invalid-heading", "stale", "future", "wrong-fields"];
    for (const profile of profiles) {
      const plan = generateGnssPlan({ profile, seed, count: 360 });
      expect(plan).toEqual(generateGnssPlan({ profile, seed, count: 360 }));
      expect(plan.every((event: any, i: number) => i === 0 || event.scheduleOffsetMs >= plan[i - 1].scheduleOffsetMs)).toBe(true);
      const rejected = plan.filter((event: any) => !parseTelemetryValue({ ...event.body,
        timestamp: epoch + event.sampleOffsetMs, deviceSentAt: epoch + event.sentOffsetMs }, epoch + event.scheduleOffsetMs).ok);
      if (["invalid-speed", "invalid-heading", "wrong-fields"].includes(profile)) expect(rejected).toHaveLength(1);
      else if (["stale", "future"].includes(profile)) expect(rejected).toHaveLength(plan.length);
      else if (profile === "burst") expect(rejected.length).toBeGreaterThan(0);
      else expect(rejected).toHaveLength(0);
    }
  });
  it("preserves duplicate identity and bounded synthetic outages and direction", () => {
    const duplicates = generateGnssPlan({ profile: "duplicate", count: 60 });
    for (const event of duplicates.filter((event: any, i: number) => i > 0 && event.body.seq === duplicates[i - 1].body.seq)) {
      const original = duplicates.find((row: any) => row.body.seq === event.body.seq);
      expect(event.body).toEqual(original.body); expect(event.sampleOffsetMs).toBe(original.sampleOffsetMs);
      expect(event.scheduleOffsetMs - original.scheduleOffsetMs).toBe(250);
    }
    for (const gap of [45, 120, 301]) {
      const plan = generateGnssPlan({ profile: `outage${gap}`, count: 360 });
      expect(plan).toHaveLength(360 - gap);
      expect(plan[20].sampleOffsetMs - plan[19].sampleOffsetMs).toBe((gap + 1) * 1000);
    }
    const forward = generateGnssPlan({ count: 20 }); const reverse = generateGnssPlan({ profile: "reverse", count: 20 });
    expect(forward[1].body.lat).toBeGreaterThan(forward[0].body.lat);
    expect(reverse[1].body.lat).toBeLessThan(reverse[0].body.lat);
    expect(generateGnssPlan({ profile: "jitter", seed: 0, count: 20 }))
      .not.toEqual(generateGnssPlan({ profile: "jitter", seed: 1, count: 20 }));
    expect(generateGnssPlan({ seed: 0, count: 3 })[0].seed).toBe(0);
    expect(() => generateGnssPlan({ count: 0 })).toThrow(/count/);
    expect(() => generateGnssPlan({ profile: "outage301", count: 20 })).toThrow(/enough samples/);
    expect(() => generateGnssPlan({ points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }] })).toThrow(/positive length/);
  });
  it("bounds equatorial travel with independently constructed metre offsets", () => {
    property({ generate: (random: () => number) => ({ speed: random() * 200, elapsedMs: Math.floor(random() * 10000) + 1 }),
      check: ({ speed, elapsedMs }: { speed: number; elapsedMs: number }) => {
        const anchor = { lat: 0, lng: 0, speed, gpsHdop: 0, timestamp: epoch };
        const limit = 15 + (speed <= 2.5 ? 10 : 0) + speed / 3.6 * elapsedMs / 1000;
        expect(isPlausibleTelemetryTransition(anchor, { ...anchor, lng: fromMeters(limit - 0.01), timestamp: epoch + elapsedMs })).toBe(true);
        expect(isPlausibleTelemetryTransition(anchor, { ...anchor, lng: fromMeters(limit + 0.01), timestamp: epoch + elapsedMs })).toBe(false);
      } });
    expect(haversineMeters({ lat: 0, lng: 179.999 }, { lat: 0, lng: -179.999 })).toBeCloseTo(222.389853, 3);
    expect(haversineMeters({ lat: 90, lng: 0 }, { lat: 90, lng: 180 })).toBeLessThan(0.001);
    expect(adaptiveGnssErrorMeters(null, 30)).toBe(50);
  });
  it("holds a teleport and recovers normal motion in forward reverse and jitter traces", () => {
    for (const profile of ["moving", "reverse", "jitter", "teleport"]) {
      const plan = generateGnssPlan({ profile, count: 60, seed });
      let anchor = null; let held = 0;
      for (const event of plan) {
        const sample = { ...event.body, timestamp: epoch + event.sampleOffsetMs };
        if (isPlausibleTelemetryTransition(anchor, sample)) anchor = sample;
        else held++;
      }
      expect(held).toBe(profile === "teleport" ? 1 : 0);
      expect(anchor?.timestamp).toBe(epoch + 59000);
    }
  });
  it("requires three coherent good fixes in the bounded outage window", () => {
    property({ generate: (random: () => number) => {
      const gap = Math.floor(random() * 175000) + 90000;
      return { gap, interval: Math.floor(random() * 4501) + 500,
        meters: gap / 1000 * 30 / 3.6 * (0.75 + random() * 0.1) };
    },
    check: ({ gap, interval, meters }: { gap: number; interval: number; meters: number }) => {
      const anchor = { lat: 0, lng: 0, speed: 30, timestamp: epoch, gpsHdop: 1 };
      let priorRaw: unknown = null; let evidence: unknown = null;
      for (let i = 0; i < 3; i++) {
        const sample = { ...anchor, motionState: "moving", timestamp: epoch + gap + i * interval,
          lng: fromMeters(meters + i * interval / 1000 * 30 / 3.6) };
        const result = evaluateOutageReacquisition(anchor, sample, priorRaw, evidence);
        expect(result.accepted).toBe(i === 2);
        priorRaw = { ...sample, sampledAt: sample.timestamp }; evidence = result.pending;
      }
    } });
  });
  it("rejects poor unknown uncertain burst and excessive outage candidates", () => {
    const anchor = { lat: 0, lng: 0, speed: 30, timestamp: epoch, gpsHdop: 1 };
    const first = { ...anchor, timestamp: epoch + 120000, lng: fromMeters(900), motionState: "moving" };
    for (const overrides of [{ gpsHdop: 4.000001 }, { gpsHdop: null }, { motionState: "uncertain" }, { lng: 1 }]) {
      expect(evaluateOutageReacquisition(anchor, { ...first, ...overrides }, null, null).accepted).toBe(false);
    }
    for (const interval of [499, 500, 5000, 5001]) {
      const evidence = evaluateOutageReacquisition(anchor, first, null, null).pending;
      const next = { ...first, timestamp: first.timestamp + interval };
      const result = evaluateOutageReacquisition(anchor, next, { ...first, sampledAt: first.timestamp }, evidence);
      expect(result.pending?.count).toBe(interval >= 500 && interval <= 5000 ? 2 : 1);
      expect(result.accepted).toBe(false);
    }
    for (const gap of [60000, 60001, 300000, 300001]) {
      const sample = { ...first, timestamp: epoch + gap, lng: fromMeters(100) };
      expect(Boolean(evaluateOutageReacquisition(anchor, sample, null, null).pending)).toBe(gap > 60000 && gap <= 300000);
    }
  });
});
