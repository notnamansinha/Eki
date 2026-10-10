import { describe, expect, it } from "vitest";
import { evaluateOutageReacquisition } from "./telemetryMotion";

const anchor = { lat: 0, lng: 0, speed: 30, timestamp: 1_000_000, gpsHdop: 1 };
const candidate = (timestamp: number, lng: number) => ({
  lat: 0, lng, speed: 30, timestamp, gpsHdop: 1, motionState: "moving",
});
const raw = (fix: ReturnType<typeof candidate>) => ({
  lat: fix.lat, lng: fix.lng, speed: fix.speed,
  sampledAt: fix.timestamp, gpsHdop: fix.gpsHdop, motionState: fix.motionState,
});

describe("outage reacquisition evidence", () => {
  it("accepts only the third coherent fix after a qualifying outage", () => {
    const firstFix = candidate(anchor.timestamp + 90_000, 0.005);
    const secondFix = candidate(anchor.timestamp + 91_000, 0.00505);
    const thirdFix = candidate(anchor.timestamp + 92_000, 0.0051);

    const first = evaluateOutageReacquisition(anchor, firstFix, null, null);
    expect(first).toEqual({ accepted: false, pending: { count: 1, startedAt: firstFix.timestamp } });
    const second = evaluateOutageReacquisition(anchor, secondFix, raw(firstFix), first.pending);
    expect(second).toEqual({ accepted: false, pending: { count: 2, startedAt: firstFix.timestamp } });
    expect(evaluateOutageReacquisition(anchor, thirdFix, raw(secondFix), second.pending))
      .toEqual({ accepted: true });
  });

  it("rejects bad quality, inflated speed and implausible travel", () => {
    const valid = candidate(anchor.timestamp + 90_000, 0.005);
    expect(evaluateOutageReacquisition(anchor, { ...valid, gpsHdop: 5 }, null, null))
      .toEqual({ accepted: false });
    expect(evaluateOutageReacquisition(anchor, { ...valid, speed: 1000 }, null, null))
      .toEqual({ accepted: false });
    expect(evaluateOutageReacquisition(anchor, { ...valid, lng: 1 }, null, null))
      .toEqual({ accepted: false });
  });

  it("resets corroboration after stale, malformed or spoofed evidence", () => {
    const firstFix = candidate(anchor.timestamp + 90_000, 0.005);
    const next = candidate(anchor.timestamp + 96_000, 0.0051);
    const pending = { count: 1 as const, startedAt: firstFix.timestamp };
    expect(evaluateOutageReacquisition(anchor, next, raw(firstFix), pending))
      .toEqual({ accepted: false, pending: { count: 1, startedAt: next.timestamp } });
    expect(evaluateOutageReacquisition(anchor, candidate(anchor.timestamp + 91_000, 0.0051),
      { ...raw(firstFix), sampledAt: "invalid" }, pending))
      .toEqual({ accepted: false, pending: { count: 1, startedAt: anchor.timestamp + 91_000 } });
    expect(evaluateOutageReacquisition(anchor, candidate(anchor.timestamp + 91_000, 0.02),
      raw(firstFix), pending))
      .toEqual({ accepted: false });
  });
});
