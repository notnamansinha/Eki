import { describe, expect, it } from "vitest";
import { directionLabel, routeInRideDirection } from "./rideDirection";

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
});
