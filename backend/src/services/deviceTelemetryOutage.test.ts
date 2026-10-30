import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/firebaseAdmin", () => ({ db: {}, rtdb: {} }));
import { nextTelemetryValue } from "./deviceTelemetryService";
import type { TelemetryPayload } from "./telemetryPayload";

const assignment = { busId: "bus_test", routeId: "route_test" };
function fix(timestamp: number, lng: number, seq: number, overrides: Partial<TelemetryPayload> = {}): TelemetryPayload {
  return { lat: 23, lng, speed: 30, heading: 90, gpsHdop: 1,
    motionState: "moving", timestamp, deviceSentAt: timestamp, seq, ...overrides };
}
function initial() {
  return nextTelemetryValue(null, assignment, fix(1_000_000, 72, 1), 1_000_000)!;
}
function ingest(current: Record<string, unknown>, sample: TelemetryPayload) {
  return nextTelemetryValue(current, assignment, sample, sample.timestamp)!;
}

describe("bounded outage reacquisition", () => {
  it.each([1, -1])("recovers plausible continuing travel after a two-minute outage, direction %s", sign => {
    let current = initial();
    current = ingest(current, fix(1_120_000, 72 + sign * .009, 2));
    expect(current.lat).toBe(23); expect(current.lng).toBe(72);
    current = ingest(current, fix(1_121_000, 72 + sign * .00908, 3));
    expect(current.lng).toBe(72);
    current = ingest(current, fix(1_122_000, 72 + sign * .00916, 4));
    expect(current.lng).toBeCloseTo(72 + sign * .00916, 7);
    expect(current.motionState).toBe("moving");
    expect(current).not.toHaveProperty("plausibilityReacquisition");
  });

  it.each([1, -1])("continues through 600 fixes after reacquisition, direction %s", sign => {
    let current = initial();
    for (let i = 0; i < 600; i++) {
      const lng = 72 + sign * (.009 + i * .00008);
      current = ingest(current, fix(1_120_000 + i * 1_000, lng, i + 2));
      if (i >= 2) expect(current.lng).toBeCloseTo(lng, 7);
    }
  });

  it("keeps city-scale teleports held even across coherent candidate fixes", () => {
    let current = initial();
    for (let i = 0; i < 5; i++) current = ingest(current, fix(1_120_000 + i * 1_000, 72.1 + i * .00008, i + 2));
    expect(current.lng).toBe(72);
    expect(current.motionState).toBe("uncertain");
    expect(current).not.toHaveProperty("plausibilityReacquisition");
  });

  it.each([{ gpsHdop: null }, { gpsHdop: 4.1 }, { motionState: "uncertain" as const }])(
    "does not use poor or unknown quality for early reacquisition: %j", overrides => {
      let current = initial();
      for (let i = 0; i < 4; i++) current = ingest(current, fix(1_120_000 + i * 1_000, 72.009 + i * .00008, i + 2, overrides));
      expect(current.lng).toBe(72);
      expect(current).not.toHaveProperty("plausibilityReacquisition");
    },
  );

  it.each([100, 5_001])("restarts evidence when consecutive samples are %s ms apart", delta => {
    let current = ingest(initial(), fix(1_120_000, 72.009, 2));
    current = ingest(current, fix(1_120_000 + delta, 72.00908, 3));
    expect(current.lng).toBe(72);
    expect(current.plausibilityReacquisition).toEqual({ count: 1, startedAt: 1_120_000 + delta });
  });

  it("does not count a repeated or out-of-order sample and keeps its accepted anchor", () => {
    const sample = fix(1_120_000, 72.009, 2);
    const current = ingest(initial(), sample);
    expect(nextTelemetryValue(current, assignment, sample, sample.timestamp)).toBeUndefined();
    expect(nextTelemetryValue(current, assignment, fix(1_119_999, 72.00908, 3), sample.timestamp)).toBeUndefined();
    expect(current.plausibilityReacquisition).toEqual({ count: 1, startedAt: sample.timestamp });
    expect(current.plausibilityAnchor).toMatchObject({ lng: 72, timestamp: 1_000_000 });
  });

  it("clears candidates when an ordinary plausible fix returns to the original anchor", () => {
    const pending = ingest(initial(), fix(1_120_000, 72.009, 2));
    const recovered = ingest(pending, fix(1_121_000, 72.00001, 3));
    expect(recovered.lng).toBe(72.00001);
    expect(recovered).not.toHaveProperty("plausibilityReacquisition");
  });

  it("restarts evidence after an inconsistent nearby candidate, without accepting the rejected point", () => {
    let current = ingest(initial(), fix(1_120_000, 72.009, 2));
    current = ingest(current, fix(1_121_000, 72.007, 3));
    expect(current.lng).toBe(72);
    expect(current.plausibilityReacquisition).toEqual({ count: 1, startedAt: 1_121_000 });
  });

  it.each([null, { count: 99, startedAt: 1_120_000 }, {count: 2, startedAt: 1_121_000},
    {count: 1, startedAt: "1120000"}, {count: 2, startedAt: 1_000_000}])(
    "ignores malformed or mismatched stored evidence: %j", evidence => {
      const current = ingest(initial(), fix(1_120_000, 72.009, 2));
      const next = ingest({ ...current, plausibilityReacquisition: evidence }, fix(1_121_000, 72.00908, 3));
      expect(next.lng).toBe(72);
      expect(next.plausibilityReacquisition).toEqual({ count: 1, startedAt: 1_121_000 });
    },
  );

  it("preserves lifecycle and route data while reacquiring, and clears evidence at the old prolonged-outage boundary", () => {
    let current = { ...initial(), sessionId: "session_test", currentStopIndex: 3, routeGeometryVersion: 8 };
    current = ingest(current, fix(1_120_000, 72.009, 2)) as typeof current;
    current = ingest(current, fix(1_300_001, 72.02, 3)) as typeof current;
    expect(current).toMatchObject({ sessionId: "session_test", currentStopIndex: 3, routeGeometryVersion: 8, lng: 72.02 });
    expect(current).not.toHaveProperty("plausibilityReacquisition");
  });
});

describe("GNSS-loss packet and the plausibility anchor (break-it review, 29 Oct 2026)", () => {
  it("keeps the last good fix as the anchor, so GPS recovers while the bus slows into a stop", () => {
    // Moving at 30 km/h, then the firmware's single loss packet: same coordinates, speed 0, HDOP 99.
    let current = initial();
    current = ingest(current, fix(1_001_000, 72.00008, 2));
    current = ingest(current, fix(1_002_000, 72.00008, 3, { speed: 0, gpsHdop: 99, motionState: "uncertain" }));
    expect(current).toMatchObject({ motionState: "uncertain", signalState: "gnss_lost" });
    expect(current.plausibilityAnchor).toMatchObject({ speed: 30, timestamp: 1_001_000 });
    // GPS returns 40 s later, 330 m on, as the bus brakes to 4 km/h: plausible from the last good fix.
    current = ingest(current, fix(1_042_000, 72.00332, 4, { speed: 4 }));
    expect(current).toMatchObject({ motionState: "moving", signalState: "connected" });
    expect(current.lng).toBeCloseTo(72.00332, 7);
  });
});
