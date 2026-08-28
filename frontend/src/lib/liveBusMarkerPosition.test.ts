import { describe, expect, it } from "vitest";
import { liveBusMarkerPosition } from "./liveBusMarkerPosition";

describe("live bus marker position", () => {
  it("uses raw RTDB coordinates when no accepted match exists", () => {
    expect(liveBusMarkerPosition({ lat: 23.012441, lng: 72.458011 })).toEqual({
      lat: 23.012441,
      lng: 72.458011,
    });
  });

  it("uses each new telemetry fix without retaining the previous position", () => {
    const first = liveBusMarkerPosition({ lat: 23.012441, lng: 72.458011 });
    const next = liveBusMarkerPosition({ lat: 23.012991, lng: 72.458731 });

    expect(next).toEqual({ lat: 23.012991, lng: 72.458731 });
    expect(next).not.toEqual(first);
  });

  it.each([
    [undefined, 72.5],
    [23, undefined],
    [91, 72.5],
    [23, 181],
  ])("rejects an invalid position (%p, %p)", (lat, lng) => {
    expect(liveBusMarkerPosition({ lat, lng })).toBeNull();
  });

  it("uses a confident current-version matched position", () => {
    expect(liveBusMarkerPosition({
      lat: 23.012441,
      lng: 72.458011,
      timestamp: 1_000,
      routeState: "ON_ROUTE",
      routeVersion: 4,
      matchedLocation: {
        lat: 23.0124,
        lng: 72.458,
        segmentIndex: 8,
        segmentFraction: 0.5,
        alongRouteDistanceM: 800,
        distanceToRouteM: 5,
        headingDifference: 2,
        matchConfidence: 0.92,
        seq: 10,
        sampledAt: 1_000,
        routeVersion: 4,
      },
    })).toEqual({ lat: 23.0124, lng: 72.458 });
  });

  it.each(["POSSIBLE_OFF_ROUTE", "OFF_ROUTE", "REROUTING"] as const)(
    "falls back to raw telemetry while route state is %s",
    (routeState) => {
      expect(liveBusMarkerPosition({
        lat: 23.01,
        lng: 72.45,
        timestamp: 2_000,
        routeState,
        routeVersion: 2,
        matchedLocation: {
          lat: 23,
          lng: 72,
          segmentIndex: 2,
          segmentFraction: 0.2,
          alongRouteDistanceM: 200,
          distanceToRouteM: 40,
          headingDifference: 80,
          matchConfidence: 0.5,
          seq: 2,
          sampledAt: 2_000,
          routeVersion: 2,
        },
      })).toEqual({ lat: 23.01, lng: 72.45 });
    },
  );

  it("rejects a stale matched route version", () => {
    expect(liveBusMarkerPosition({
      lat: 23.01,
      lng: 72.45,
      timestamp: 2_000,
      routeState: "ON_NEW_ROUTE",
      routeVersion: 3,
      matchedLocation: {
        lat: 23,
        lng: 72,
        segmentIndex: 2,
        segmentFraction: 0.2,
        alongRouteDistanceM: 200,
        distanceToRouteM: 2,
        headingDifference: 1,
        matchConfidence: 0.9,
        seq: 2,
        sampledAt: 2_000,
        routeVersion: 2,
      },
    })).toEqual({ lat: 23.01, lng: 72.45 });
  });
});
