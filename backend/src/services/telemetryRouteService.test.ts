import { describe, expect, it } from "vitest";
import {
  isReliableMovingSample,
  remainingRerouteStops,
  rerouteContextIsCurrent,
  routeRepairSnapshotWrite,
} from "./telemetryRouteService";

const stops = [
  { id: "A", lat: 23, lng: 72 },
  { id: "B", lat: 23.01, lng: 72.01 },
  { id: "C", lat: 23.02, lng: 72.02 },
  { id: "D", lat: 23.03, lng: 72.03 },
];

describe("remaining reroute itinerary", () => {
  it("preserves the next required stop and destination", () => {
    expect(remainingRerouteStops(stops, "forward", 2).map((stop) => stop.id))
      .toEqual(["C", "D"]);
  });

  it("uses ride-direction order and never resets trip progress", () => {
    expect(remainingRerouteStops(stops, "reverse", 1).map((stop) => stop.id))
      .toEqual(["C", "B", "A"]);
  });

  it("does not send a moving in-service bus back to its origin", () => {
    expect(remainingRerouteStops(stops, "forward", 0).map((stop) => stop.id))
      .toEqual(["B", "C", "D"]);
  });
});

describe("reroute result guards", () => {
  const expected = {
    requestId: "request-5",
    routeVersion: 5,
    sessionId: "session-new",
    direction: "forward" as const,
  };
  const live = {
    rerouteRequestId: expected.requestId,
    routeVersion: expected.routeVersion,
    sessionId: expected.sessionId,
    direction: expected.direction,
  };

  it("accepts only the request for the current route session and version", () => {
    expect(rerouteContextIsCurrent(live, expected)).toBe(true);
    expect(rerouteContextIsCurrent({ ...live, routeVersion: 6 }, expected)).toBe(false);
    expect(rerouteContextIsCurrent({ ...live, sessionId: "session-old" }, expected)).toBe(false);
    expect(rerouteContextIsCurrent({ ...live, rerouteRequestId: "request-4" }, expected)).toBe(false);
    expect(rerouteContextIsCurrent({ ...live, direction: "reverse" }, expected)).toBe(false);
  });
});

describe("reliable moving sample HDOP gate", () => {
  const base = {
    lat: 23,
    lng: 72,
    speed: 18,
    heading: 90,
    motionState: "moving" as const,
    seq: 5,
    deviceSentAt: 1_500,
    timestamp: 1_000,
    gpsHdop: 4,
  };

  it("requires a non-null gpsHdop for a moving fast sample", () => {
    // Legacy compatibility samples carry gpsHdop null and must never be
    // treated as reliable enough to confirm an off-route deviation.
    expect(isReliableMovingSample({ ...base, gpsHdop: null })).toBe(false);
  });

  it("accepts a moving fast sample with a valid HDOP at or below the threshold", () => {
    expect(isReliableMovingSample({ ...base, gpsHdop: 4 })).toBe(true);
    expect(isReliableMovingSample({ ...base, gpsHdop: 3.2 })).toBe(true);
  });

  it("rejects slow, stopped, or high-HDOP samples", () => {
    expect(isReliableMovingSample({ ...base, gpsHdop: 2, speed: 2 })).toBe(false);
    expect(
      isReliableMovingSample({ ...base, gpsHdop: 2, motionState: "stopped" }),
    ).toBe(false);
    expect(isReliableMovingSample({ ...base, gpsHdop: 99 })).toBe(false);
  });
});

describe("route repair snapshot writes", () => {
  const forward = { encoded: "fwd" };
  const reverse = { encoded: "rev" };
  const fresh = { distanceMeters: 5000, duration: "600s" };

  it("stamps HIGH_QUALITY plus metrics only when both directions were freshly computed", () => {
    const write = routeRepairSnapshotWrite({
      forward,
      reverse,
      forwardRepair: fresh,
      reverseRepair: fresh,
    });
    expect(write.polylineQuality).toBe("HIGH_QUALITY");
    expect(write.distanceMeters).toBe(5000);
    expect(write.reverseDistanceMeters).toBe(5000);
    expect(write.duration).toBe("600s");
  });

  it("preserves legacy forward geometry but never claims quality or metrics", () => {
    const write = routeRepairSnapshotWrite({
      forward,
      reverse,
      forwardRepair: null,
      reverseRepair: fresh,
    });
    expect(write.polyline).toBe("fwd");
    expect(write.forwardPolyline).toBe("fwd");
    expect(write.polylineQuality).toBeUndefined();
    expect(write.distanceMeters).toBeUndefined();
    expect(write.duration).toBeUndefined();
    expect(write.reverseDistanceMeters).toBe(5000);
  });
});
