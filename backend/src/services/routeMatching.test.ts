import { describe, expect, it } from "vitest";
import {
  evaluateRouteAdherence,
  matchRoutePosition,
  trajectoryHeading,
} from "./routeMatching";

describe("route matching", () => {
  it("derives heading from a short recent trajectory", () => {
    expect(trajectoryHeading([
      { lat: 23, lng: 72 },
      { lat: 23, lng: 72.0001 },
      { lat: 23, lng: 72.0002 },
    ])).toBeCloseTo(90, 0);
    expect(trajectoryHeading([
      { lat: 23, lng: 72 },
      { lat: 23.000001, lng: 72 },
    ])).toBeUndefined();
  });

  it("uses heading to choose the correct parallel carriageway", () => {
    const path = [
      { lat: 23, lng: 72 },
      { lat: 23, lng: 72.002 },
      { lat: 23.00008, lng: 72.002 },
      { lat: 23.00008, lng: 72 },
    ];
    const eastbound = matchRoutePosition(
      { lat: 23.00005, lng: 72.001 },
      path,
      90,
    );

    expect(eastbound?.segmentIndex).toBe(0);
    expect(eastbound?.headingDifference).toBeLessThan(10);
  });

  it("penalizes backwards jumps near a crossing", () => {
    const path = [
      { lat: 23, lng: 72 },
      { lat: 23.001, lng: 72.001 },
      { lat: 23.002, lng: 72.002 },
      { lat: 23.002, lng: 72 },
      { lat: 23.001, lng: 72.001 },
      { lat: 23, lng: 72.002 },
    ];
    const result = matchRoutePosition(
      { lat: 23.001, lng: 72.001 },
      path,
      225,
      { segmentIndex: 3, alongRouteDistanceM: 450 },
    );

    expect(result?.segmentIndex).toBeGreaterThanOrEqual(3);
  });

  it("requires three reliable off-route samples before rerouting", () => {
    const offRoute = matchRoutePosition(
      { lat: 23.001, lng: 72.0005 },
      [{ lat: 23, lng: 72 }, { lat: 23, lng: 72.001 }],
      90,
    );
    const first = evaluateRouteAdherence("ON_ROUTE", 0, offRoute, true);
    const second = evaluateRouteAdherence(
      first.routeState,
      first.offRouteSampleCount,
      offRoute,
      true,
    );
    const third = evaluateRouteAdherence(
      second.routeState,
      second.offRouteSampleCount,
      offRoute,
      true,
    );

    expect(first.routeState).toBe("POSSIBLE_OFF_ROUTE");
    expect(second.shouldReroute).toBe(false);
    expect(third).toMatchObject({
      routeState: "OFF_ROUTE",
      offRouteSampleCount: 3,
      shouldReroute: true,
    });
  });

  it("does not accumulate stationary GPS noise toward rerouting", () => {
    const decision = evaluateRouteAdherence(
      "ON_ROUTE",
      0,
      null,
      false,
    );
    expect(decision).toEqual({
      routeState: "POSSIBLE_OFF_ROUTE",
      offRouteSampleCount: 0,
      shouldReroute: false,
    });
  });

  it("returns to the active route with hysteresis reset", () => {
    const match = matchRoutePosition(
      { lat: 23.00002, lng: 72.0005 },
      [{ lat: 23, lng: 72 }, { lat: 23, lng: 72.001 }],
      90,
    );
    expect(evaluateRouteAdherence("POSSIBLE_OFF_ROUTE", 2, match, true)).toEqual({
      routeState: "ON_ROUTE",
      offRouteSampleCount: 0,
      shouldReroute: false,
    });
  });
});
