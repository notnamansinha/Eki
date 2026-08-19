import { describe, expect, it } from "vitest";
import { selectStableMarkerPosition, type MarkerPositionSample } from "./stableMarkerPosition";

const previous: MarkerPositionSample = {
  point: { lat: 23, lng: 72.46 },
  timestamp: 1_000,
  speedKmh: 0,
  sessionId: "ride-1",
  trustworthy: true,
};

describe("stable marker position", () => {
  it("holds the last trusted point when route snapping fails", () => {
    const decision = selectStableMarkerPosition(previous, {
      ...previous,
      point: { lat: 23.05, lng: 72.54 },
      timestamp: 4_000,
      trustworthy: false,
    });
    expect(decision.point).toEqual(previous.point);
  });

  it("does not accept an untrusted point merely because the session changed", () => {
    const decision = selectStableMarkerPosition(previous, {
      ...previous,
      point: { lat: 23.05, lng: 72.54 },
      timestamp: 4_000,
      sessionId: "ride-2",
      trustworthy: false,
    });
    expect(decision.point).toEqual(previous.point);
    expect(decision.accepted).toEqual(previous);
  });

  it("rejects a short-interval city-scale teleport", () => {
    const decision = selectStableMarkerPosition(previous, {
      ...previous,
      point: { lat: 23.05, lng: 72.54 },
      timestamp: 4_000,
    });
    expect(decision.point).toEqual(previous.point);
  });

  it("reacquires after a prolonged outage or a session change", () => {
    const point = { lat: 23.05, lng: 72.54 };
    expect(selectStableMarkerPosition(previous, {
      ...previous,
      point,
      timestamp: 301_001,
    }).point).toEqual(point);
    expect(selectStableMarkerPosition(previous, {
      ...previous,
      point,
      timestamp: 4_000,
      sessionId: "ride-2",
    }).point).toEqual(point);
  });

  it("ignores duplicate and out-of-order timestamps", () => {
    const point = { lat: 23.0001, lng: 72.4601 };
    expect(selectStableMarkerPosition(previous, {
      ...previous,
      point,
      timestamp: 1_000,
    }).point).toEqual(previous.point);
    expect(selectStableMarkerPosition(previous, {
      ...previous,
      point,
      timestamp: 999,
    }).point).toEqual(previous.point);
  });
});
