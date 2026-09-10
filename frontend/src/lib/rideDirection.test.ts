import { describe, expect, it } from "vitest";
import {
  directionLabel,
  directionLabelState,
  directionsMatch,
  normalizeRideDirection,
  persistedDirectionLabel,
  persistedDirectionLabelState,
  routeInRideDirection,
  routeInRideDirectionState,
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

describe("directional route views", () => {
  it("keeps missing, null, and invalid direction pending", () => {
    for (const value of [undefined, null, "", "sideways", 123]) {
      expect(normalizeRideDirection(value)).toBe("pending");
    }
    expect(normalizeRideDirection("forward")).toBe("forward");
    expect(normalizeRideDirection("reverse")).toBe("reverse");
  });

  it("does not match, label, order, or expose a route while pending", () => {
    expect(directionsMatch(undefined, undefined)).toBe(false);
    expect(directionsMatch(null, "forward")).toBe(false);
    expect(directionsMatch("sideways", "forward")).toBe(false);
    expect(directionsMatch("forward", "forward")).toBe(true);
    expect(directionsMatch("reverse", "reverse")).toBe(true);
    expect(directionLabelState("pending", route.stops)).toBe("Direction pending");
    expect(persistedDirectionLabelState("pending", route.stops, "a", "z"))
      .toBe("Direction pending");
    expect(routeInRideDirectionState(route, "pending")).toBeUndefined();
  });

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
    const forward = routeInRideDirection(route, "forward");
    expect(forward.polyline).toBe("legal-forward");
    expect(forward.rideDirection).toBe("forward");
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
