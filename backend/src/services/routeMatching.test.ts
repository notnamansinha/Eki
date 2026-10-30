import { describe, expect, it } from "vitest";
import {
  evaluateRouteAdherence,
  matchRoutePosition,
  plausibleProgressBound,
  trajectoryHeading,
} from "./routeMatching";
import { adaptiveGnssErrorMeters } from "../lib/telemetryMotion";

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

  it("requires two reliable ordinary off-route samples before rerouting", () => {
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
    expect(first.routeState).toBe("POSSIBLE_OFF_ROUTE");
    expect(first.shouldReroute).toBe(false);
    expect(second).toMatchObject({
      routeState: "OFF_ROUTE",
      offRouteSampleCount: 2,
      shouldReroute: true,
    });
  });

  it("confirms one strong measured deviation but not a missing match", () => {
    const strong = matchRoutePosition(
      { lat: 23.002, lng: 72.0005 },
      [{ lat: 23, lng: 72 }, { lat: 23, lng: 72.001 }],
      90,
    );

    expect(evaluateRouteAdherence("ON_ROUTE", 0, strong, true))
      .toMatchObject({ routeState: "OFF_ROUTE", shouldReroute: true });
    expect(evaluateRouteAdherence("ON_ROUTE", 0, null, true))
      .toMatchObject({ routeState: "POSSIBLE_OFF_ROUTE", shouldReroute: false });
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

  it("does not snap a self-intersection when non-adjacent segments are equally plausible", () => {
    const intersection = matchRoutePosition(
      { lat: 23, lng: 72.001 },
      [
        { lat: 23, lng: 72 },
        { lat: 23, lng: 72.001 },
        { lat: 23, lng: 72.002 },
        { lat: 23.001, lng: 72.002 },
        { lat: 22.999, lng: 72.002 },
        { lat: 22.999, lng: 72.001 },
        { lat: 23.001, lng: 72.001 },
      ],
    );
    expect(intersection?.isAmbiguous).toBe(true);
    expect(intersection?.matchConfidence).toBeLessThan(0.6);
    expect(evaluateRouteAdherence("ON_ROUTE", 0, intersection, true)).toEqual({
      routeState: "POSSIBLE_OFF_ROUTE",
      offRouteSampleCount: 0,
      shouldReroute: false,
    });
  });

  it("does not treat an ordinary straight-line vertex as ambiguous", () => {
    const match = matchRoutePosition(
      { lat: 23, lng: 72.001 },
      [
        { lat: 23, lng: 72 },
        { lat: 23, lng: 72.001 },
        { lat: 23, lng: 72.002 },
      ],
    );
    expect(match?.isAmbiguous).toBe(false);
  });

  it("does not treat a repeated polyline vertex as competing geometry", () => {
    // Provider polylines and saved routes can repeat a vertex at 1e-5
    // quantization; the zero-length segment joins one continuous leg.
    const path = [
      { lat: 23, lng: 72 },
      { lat: 23, lng: 72.001 },
      { lat: 23, lng: 72.001 },
      { lat: 23, lng: 72.002 },
    ];
    for (const heading of [90, undefined]) {
      const match = matchRoutePosition({ lat: 23.00001, lng: 72.00101 }, path, heading);
      expect(match?.isAmbiguous).toBe(false);
      expect(evaluateRouteAdherence("ON_ROUTE", 0, match, true).routeState).toBe("ON_ROUTE");
    }
  });

  it("does not treat densely sampled vertices of one road as competing geometry", () => {
    // High-quality provider polylines place vertices a few metres apart on
    // curves; nearby non-adjacent segments of the same leg are not a crossing.
    const straight = Array.from({ length: 201 }, (_, index) => ({ lat: 23, lng: 72 + index * 0.00002 }));
    const curve = Array.from({ length: 84 }, (_, index) => {
      const angle = index * 3 / 80;
      return { lat: 23 + 80 * Math.sin(angle) / 111_195, lng: 72 + 80 * (1 - Math.cos(angle)) / 102_350 };
    });
    for (const path of [straight, curve]) {
      for (const index of [10, 41, 77]) {
        const point = { lat: (path[index].lat + path[index + 1].lat) / 2, lng: (path[index].lng + path[index + 1].lng) / 2 };
        for (const heading of [undefined, 90]) {
          const match = matchRoutePosition(point, path, heading, null, 10);
          expect(match?.isAmbiguous).toBe(false);
          expect(evaluateRouteAdherence("ON_ROUTE", 0, match, true).routeState).toBe("ON_ROUTE");
        }
      }
    }
  });

  it("does not treat an ordinary sharp turn as competing geometry", () => {
    const match = matchRoutePosition(
      { lat: 23, lng: 72.001 },
      [
        { lat: 23, lng: 72 },
        { lat: 23, lng: 72.001 },
        { lat: 23.001, lng: 72.001 },
      ],
    );

    expect(match?.isAmbiguous).toBe(false);
  });

  it("finds a non-adjacent crossing when an adjacent runner-up is equivalent", () => {
    const match = matchRoutePosition(
      { lat: 23, lng: 72.001 },
      [
        { lat: 23, lng: 72 },
        { lat: 23, lng: 72.001 },
        { lat: 23, lng: 72.002 },
        { lat: 23.001, lng: 72.002 },
        { lat: 22.999, lng: 72.002 },
        { lat: 22.999, lng: 72.001 },
        { lat: 23.001, lng: 72.001 },
      ],
    );

    expect(match?.segmentIndex).toBe(0);
    expect(match?.isAmbiguous).toBe(true);
    expect(match?.matchConfidence).toBeLessThan(0.6);
  });
});

it("rejects physically unreachable progress regardless of polyline density", () => {
  const path = [{ lat: 23, lng: 72 }, { lat: 23, lng: 72.1 }];
  expect(matchRoutePosition({ lat: 23, lng: 72.08 }, path, 90,
    { segmentIndex: 0, alongRouteDistanceM: 10 }, 25, 80)).toBeNull();
  expect(matchRoutePosition({ lat: 23, lng: 72.0003 }, path, 90,
    { segmentIndex: 0, alongRouteDistanceM: 10 }, 25, 80)).not.toBeNull();
});

describe("carriageway hysteresis at an out-and-back turnaround (field ride, 29 Oct 2026)", () => {
  // Outbound north along one carriageway, U-turn, return south 20 m east of it.
  const metersPerLng = 6_371_000 * Math.cos(23 * Math.PI / 180) * Math.PI / 180;
  const at = (north: number, east: number) => ({ lat: 23 + north / 6_371_000 * 180 / Math.PI, lng: 72 + east / metersPerLng });
  const path = [at(0, 0), at(250, 0), at(500, 0), at(500, 20), at(250, 20), at(0, 20)];
  const outboundAt = (north: number) => ({ segmentIndex: north < 250 ? 0 : 1, alongRouteDistanceM: north });

  it("keeps a slow bus in the median on its own carriageway instead of jumping ahead to the return leg", () => {
    // 15 m before the tip and 12 m east of the outbound lane: the return lane is nearer (8 m), but
    // reaching it means 51 m of progress in one second for a bus that is barely moving.
    const match = matchRoutePosition(at(485, 12), path, undefined, outboundAt(484), 25, 54, plausibleProgressBound(1_000, 0, 25));
    expect(match).toMatchObject({ isAmbiguous: false, segmentIndex: 1 });
    expect(match!.alongRouteDistanceM).toBeCloseTo(485, 0);
    expect(match!.matchConfidence).toBeGreaterThanOrEqual(0.45);
  });

  it("still follows a bus that has really driven round the turnaround", () => {
    const turned = matchRoutePosition(at(480, 19), path, 180, { segmentIndex: 3, alongRouteDistanceM: 525 }, 25, 54, plausibleProgressBound(1_000, 15, 25));
    expect(turned).toMatchObject({ segmentIndex: 3, isAmbiguous: false });
    expect(turned!.alongRouteDistanceM).toBeCloseTo(540, 0);
  });

  it("without a plausible-progress bound keeps the existing behaviour", () => {
    const legacy = matchRoutePosition(at(485, 12), path, undefined, outboundAt(484), 25, 54);
    expect(legacy?.isAmbiguous).toBe(true);
  });
});

describe("plausible-progress bound never drags a real bus backwards (break-it review)", () => {
  const metersPerLng = 6_371_000 * Math.cos(23 * Math.PI / 180) * Math.PI / 180;
  const at = (north: number, east: number) => ({ lat: 23 + north / 6_371_000 * 180 / Math.PI, lng: 72 + east / metersPerLng });
  // A straight road with a vertex every 10 m, like a decoded town polyline.
  const straight = Array.from({ length: 101 }, (_, index) => at(index * 10, 0));
  const serviceMatch = (raw: { lat: number; lng: number }, speedKmh: number, elapsedMs: number) => {
    const u = adaptiveGnssErrorMeters(1, speedKmh, speedKmh, elapsedMs);
    return matchRoutePosition(raw, straight, speedKmh >= 3 ? 0 : undefined, { segmentIndex: 10, alongRouteDistanceM: 100 }, u,
      (speedKmh + 15) / 3.6 * elapsedMs / 1000 + 2 * u, plausibleProgressBound(elapsedMs, speedKmh, u));
  };

  it("applies only to a fresh 1 Hz neighbour, never after a gap", () => {
    expect(plausibleProgressBound(1_000, 0, 25)).toBeCloseTo(15 / 3.6 + 25, 5);
    expect(plausibleProgressBound(10_001, 30, 25)).toBeUndefined();
    expect(plausibleProgressBound(0, 30, 25)).toBeUndefined();
    expect(plausibleProgressBound(Number.NaN, 30, 25)).toBeUndefined();
  });

  it.each([[15, 30_000, 350], [10, 40_000, 380], [0, 20_000, 220], [10, 8_000, 170], [0, 3_000, 130]])(
    "keeps a bus now at %i km/h after %i ms on its true position along a straight road", (speed, elapsed, north) => {
      const match = serviceMatch(at(north, 3), speed, elapsed)!;
      expect(match.alongRouteDistanceM).toBeCloseTo(north, 0);
      expect(match.distanceToRouteM).toBeLessThan(10);
      expect(evaluateRouteAdherence("ON_ROUTE", 0, match, true)).toMatchObject({ routeState: "ON_ROUTE", shouldReroute: false });
    });

  it("lets a bus that drove round the turnaround during a 20 s gap stay on the return carriageway", () => {
    const turnaround = [at(0, 0), at(250, 0), at(500, 0), at(500, 20), at(250, 20), at(0, 20)];
    const u = adaptiveGnssErrorMeters(1, 0, 0, 20_000);
    const match = matchRoutePosition(at(470, 20), turnaround, undefined, { segmentIndex: 1, alongRouteDistanceM: 450 }, u,
      15 / 3.6 * 20 + 2 * u, plausibleProgressBound(20_000, 0, u));
    expect(match).toMatchObject({ segmentIndex: 3 });
  });
});
