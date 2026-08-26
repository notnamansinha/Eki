import { describe, expect, it } from "vitest";
import {
  directionLabel,
  persistedDirectionLabel,
  routeInRideDirection,
} from "./rideDirection";

const route = {
  id: "route_1",
  name: "A-Z",
  color: "#fff",
  waypoints: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
  stops: [
    { id: "a", name: "Alpha", shortName: "A", lat: 1, lng: 1 },
    { id: "z", name: "Zulu", shortName: "Z", lat: 2, lng: 2 },
  ],
};

describe("directional route views", () => {
  it("orders reverse stops and geometry without mutating Firestore route data", () => {
    const reverse = routeInRideDirection(route, "reverse");
    expect(reverse.stops.map((stop) => stop.id)).toEqual(["z", "a"]);
    expect(reverse.waypoints.map((point) => point.lat)).toEqual([2, 1]);
    expect(reverse.rideDirection).toBe("reverse");
    expect(route.stops.map((stop) => stop.id)).toEqual(["a", "z"]);
    expect(directionLabel("reverse", route.stops)).toBe("Z → A");
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
