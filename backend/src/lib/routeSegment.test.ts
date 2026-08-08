import { describe, expect, it } from "vitest";
import { buildRouteSegment, type SegmentStop } from "./routeSegment";

const coordinates = [0, 1, 2, 3, 4].map((lng) => ({ lat: 0, lng }));
const stops: SegmentStop[] = coordinates.map((point, index) => ({
  ...point,
  id: `stop-${index}`,
  waypointIndex: index,
}));

describe("buildRouteSegment", () => {
  it("returns a forward slice and stops in travel order", () => {
    const result = buildRouteSegment(coordinates, stops, stops[1], stops[4]);
    expect(result.coordinates).toEqual(coordinates.slice(1));
    expect(result.stops.map((stop) => stop.id)).toEqual([
      "stop-1", "stop-2", "stop-3", "stop-4",
    ]);
  });

  it("returns the same slice reversed for reverse travel", () => {
    const result = buildRouteSegment(coordinates, stops, stops[4], stops[1], stops[2]);
    expect(result.coordinates).toEqual(coordinates.slice(1).reverse());
    expect(result.stops.map((stop) => stop.id)).toEqual([
      "stop-4", "stop-3", "stop-2", "stop-1",
    ]);
  });

  it("rejects a via stop outside the selected segment", () => {
    expect(() => buildRouteSegment(coordinates, stops, stops[1], stops[3], stops[4]))
      .toThrow("Via stop is not between");
  });

  it("rejects endpoints that resolve to the same polyline point", () => {
    const duplicate = { id: "duplicate", lat: 0, lng: 1.01 };
    expect(() => buildRouteSegment(coordinates, [...stops, duplicate], stops[1], duplicate))
      .toThrow("too close together");
  });
});
