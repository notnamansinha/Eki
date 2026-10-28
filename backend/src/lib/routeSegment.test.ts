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
    const reverseCoordinates = [...coordinates].reverse();
    const reverseStops = [...stops].reverse();
    const result = buildRouteSegment(reverseCoordinates, reverseStops, stops[4], stops[1], stops[2]);
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
    const withDuplicate = [stops[0], stops[1], duplicate, stops[2], stops[3], stops[4]];
    expect(() => buildRouteSegment(coordinates, withDuplicate, stops[1], duplicate))
      .toThrow("too close together");
  });

  it("rejects an end stop listed before the start stop in travel order", () => {
    expect(() => buildRouteSegment(coordinates, stops, stops[3], stops[1]))
      .toThrow("must come before");
  });

  describe("routes that revisit earlier coordinates", () => {
    // Campus loop: Gate -> Library -> Hostel -> back to Gate.
    const road = [
      { lat: 23.0, lng: 72.0 }, { lat: 23.0, lng: 72.001 }, { lat: 23.0, lng: 72.002 },
      { lat: 23.001, lng: 72.002 }, { lat: 23.001, lng: 72.001 }, { lat: 23.001, lng: 72.0 },
      { lat: 23.0, lng: 72.0 },
    ];
    const gate = { id: "gate", lat: 23.0, lng: 72.0 };
    const library = { id: "library", lat: 23.0, lng: 72.002 };
    const hostel = { id: "hostel", lat: 23.001, lng: 72.001 };
    const gateEnd = { id: "gate_end", lat: 23.0, lng: 72.0 };
    const loopStops = [gate, library, hostel, gateEnd];

    it("slices the remaining loop forward when the end stop sits at the origin", () => {
      const result = buildRouteSegment(road, loopStops, hostel, gateEnd);
      expect(result.coordinates).toEqual(road.slice(4));
      expect(result.stops.map((stop) => stop.id)).toEqual(["hostel", "gate_end"]);
    });

    it("keeps the whole loop for origin to terminal and accepts a via stop on it", () => {
      const result = buildRouteSegment(road, loopStops, gate, gateEnd, hostel);
      expect(result.coordinates).toEqual(road);
      expect(result.stops.map((stop) => stop.id)).toEqual(["gate", "library", "hostel", "gate_end"]);
    });

    it("rejects a via stop that the loop already passed", () => {
      expect(() => buildRouteSegment(road, loopStops, hostel, gateEnd, library))
        .toThrow("Via stop is not between");
    });

    it("uses the inbound visit on an out-and-back route sharing outbound coordinates", () => {
      const line = [0, 1, 2, 3, 2, 1, 0].map((lng) => ({ lat: 0, lng }));
      const depot = { id: "depot", lat: 0, lng: 0 };
      const outbound = { id: "outbound", lat: 0, lng: 1 };
      const turn = { id: "turn", lat: 0, lng: 3 };
      const inbound = { id: "inbound", lat: 0, lng: 1 };
      const depotEnd = { id: "depot_end", lat: 0, lng: 0 };
      const itinerary = [depot, outbound, turn, inbound, depotEnd];

      const result = buildRouteSegment(line, itinerary, inbound, depotEnd);
      expect(result.coordinates).toEqual(line.slice(5));
      expect(result.stops.map((stop) => stop.id)).toEqual(["inbound", "depot_end"]);

      const outward = buildRouteSegment(line, itinerary, outbound, inbound, turn);
      expect(outward.coordinates).toEqual(line.slice(1, 6));
      expect(outward.stops.map((stop) => stop.id)).toEqual(["outbound", "turn", "inbound"]);
    });
  });

  it("rejects a requested endpoint outside the route's stop list", () => {
    expect(() => buildRouteSegment(coordinates, stops,
      { ...stops[1] }, stops[4])).toThrow("not part of the route");
  });
});
