import { describe, expect, it } from "vitest";
import { routeGeometrySignature } from "./routeGeometrySignature";

describe("route geometry signature", () => {
  const stops = [
    { id: "a", name: "A", lat: 23, lng: 72 },
    { id: "b", name: "B", lat: 23.1, lng: 72.1 },
  ];

  it("changes for order, add/remove, or any coordinate change", () => {
    const original = routeGeometrySignature(stops);
    expect(routeGeometrySignature([...stops].reverse())).not.toBe(original);
    expect(routeGeometrySignature([...stops, { id: "c", name: "C", lat: 23.2, lng: 72.2 }]))
      .not.toBe(original);
    expect(routeGeometrySignature(stops.slice(0, 1))).not.toBe(original);
    expect(routeGeometrySignature([{ ...stops[0], lat: 23.000000001 }, stops[1]]))
      .not.toBe(original);
  });

  it("ignores metadata and stop IDs that do not shape the road request", () => {
    expect(routeGeometrySignature(stops)).toBe(routeGeometrySignature([
      { ...stops[0], id: "renamed-id", name: "Renamed" },
      { ...stops[1], id: "other-id", name: "Other" },
    ]));
  });
});
