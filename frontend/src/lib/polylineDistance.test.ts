import { describe, expect, it } from "vitest";
import {
  distanceAlongPolyline,
  positionAlongPolyline,
  preparePolylineDistanceIndex,
} from "./polylineDistance";

describe("polyline distance index", () => {
  const path = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
    { lat: 0, lng: 0.002 },
  ] as const;

  it("reuses the cumulative index for the same route geometry", () => {
    expect(preparePolylineDistanceIndex(path)).toBe(
      preparePolylineDistanceIndex(path),
    );
  });

  it("returns monotonic positions and route-following distance", () => {
    const index = preparePolylineDistanceIndex(path);
    const start = positionAlongPolyline({ lat: 0, lng: 0.0005 }, index);
    const end = positionAlongPolyline({ lat: 0, lng: 0.0015 }, index);

    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(end!).toBeGreaterThan(start!);
    expect(
      distanceAlongPolyline(
        { lat: 0, lng: 0.0005 },
        { lat: 0, lng: 0.0015 },
        path,
      ),
    ).toBeCloseTo(end! - start!, 6);
  });

  it("falls back to straight-line distance for an unusable path", () => {
    expect(
      distanceAlongPolyline(
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
        [],
      ),
    ).toBeGreaterThan(100);
  });
});
