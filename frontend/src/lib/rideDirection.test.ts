import { describe, expect, it } from "vitest";
import {
  directionLabel,
  directionLabelState,
  directionsMatch,
  isPendingDirection,
  normalizeRideDirection,
  persistedDirectionLabel,
  routeInRideDirection,
} from "./rideDirection";

const route = {
  id: "route_1",
  name: "A-Z",
  color: "#fff",
  polyline: "legacy-forward",
  forwardPolyline: "legal-forward",
  reversePolyline: "legal-reverse",
  polylineQuality: "HIGH_QUALITY" as const,
  waypoints: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
  stops: [
    { id: "a", name: "Alpha", shortName: "A", lat: 1, lng: 1 },
    { id: "z", name: "Zulu", shortName: "Z", lat: 2, lng: 2 },
  ],
};

describe("normalizeRideDirection (issue #149 problem 1)", () => {
  it("keeps missing direction pending instead of silently forward", () => {
    expect(normalizeRideDirection(undefined)).toBe("pending");
    expect(normalizeRideDirection(null)).toBe("pending");
    expect(normalizeRideDirection("")).toBe("pending");
    expect(normalizeRideDirection("sideways")).toBe("pending");
    expect(normalizeRideDirection(123)).toBe("pending");
  });

  it("resolves only explicit forward/reverse", () => {
    expect(normalizeRideDirection("forward")).toBe("forward");
    expect(normalizeRideDirection("reverse")).toBe("reverse");
  });

  it("isPendingDirection separates the unresolved state", () => {
    expect(isPendingDirection("pending")).toBe(true);
    expect(isPendingDirection("forward")).toBe(false);
    expect(isPendingDirection("reverse")).toBe(false);
  });

  it("directionLabelState renders 'Direction pending' when unresolved", () => {
    expect(directionLabelState("pending", route.stops)).toBe("Direction pending");
    expect(directionLabelState("forward", route.stops)).toBe("A → Z");
  });

  it("directionsMatch never matches a pending direction", () => {
    expect(directionsMatch("forward", "forward")).toBe(true);
    expect(directionsMatch("reverse", "reverse")).toBe(true);
    expect(directionsMatch("forward", "reverse")).toBe(false);
    expect(directionsMatch(undefined, "forward")).toBe(false);
    expect(directionsMatch("reverse", undefined)).toBe(false);
    expect(directionsMatch(undefined, undefined)).toBe(false);
  });
});

describe("directional route views", () => {
  it("orders reverse stops and geometry without mutating Firestore route data", () => {
    const reverse = routeInRideDirection(route, "reverse");
    expect(reverse.stops.map((stop) => stop.id)).toEqual(["z", "a"]);
    expect(reverse.waypoints.map((point) => point.lat)).toEqual([2, 1]);
    expect(reverse.rideDirection).toBe("reverse");
    expect(reverse.polyline).toBe("legal-reverse");
    expect(route.stops.map((stop) => stop.id)).toEqual(["a", "z"]);
    expect(directionLabel("reverse", route.stops)).toBe("Z → A");
  });

  it("selects independently routed forward geometry", () => {
    expect(routeInRideDirection(route, "forward").polyline).toBe("legal-forward");
  });

  it("keeps persisted session endpoints stable after the route is edited", () => {
    const editedStops = [
      { id: "new-a", name: "New Alpha", shortName: "NA", lat: 0, lng: 0 },
      ...route.stops,
      { id: "new-z", name: "New Zulu", shortName: "NZ", lat: 3, lng: 3 },
    ];
    expect(persistedDirectionLabel("forward", editedStops, "a", "z")).toBe("A → Z");
    expect(persistedDirectionLabel("reverse", editedStops, "z", "a")).toBe("Z → A");
    expect(persistedDirectionLabel("reverse", editedStops, null, null)).toBe("NZ → NA");
  });
});
