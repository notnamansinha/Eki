import { describe, expect, it } from "vitest";
import {
  remainingRerouteStops,
  rerouteContextIsCurrent,
} from "./telemetryRouteService";

const stops = [
  { id: "A", lat: 23, lng: 72 },
  { id: "B", lat: 23.01, lng: 72.01 },
  { id: "C", lat: 23.02, lng: 72.02 },
  { id: "D", lat: 23.03, lng: 72.03 },
];

describe("remaining reroute itinerary", () => {
  it("preserves the next required stop and destination", () => {
    expect(remainingRerouteStops(stops, "forward", 2).map((stop) => stop.id))
      .toEqual(["C", "D"]);
  });

  it("uses ride-direction order and never resets trip progress", () => {
    expect(remainingRerouteStops(stops, "reverse", 1).map((stop) => stop.id))
      .toEqual(["C", "B", "A"]);
  });

  it("does not send a moving in-service bus back to its origin", () => {
    expect(remainingRerouteStops(stops, "forward", 0).map((stop) => stop.id))
      .toEqual(["B", "C", "D"]);
  });
});

describe("reroute result guards", () => {
  const expected = {
    requestId: "request-5",
    routeVersion: 5,
    sessionId: "session-new",
    direction: "forward" as const,
  };
  const live = {
    rerouteRequestId: expected.requestId,
    routeVersion: expected.routeVersion,
    sessionId: expected.sessionId,
    direction: expected.direction,
  };

  it("accepts only the request for the current route session and version", () => {
    expect(rerouteContextIsCurrent(live, expected)).toBe(true);
    expect(rerouteContextIsCurrent({ ...live, routeVersion: 6 }, expected)).toBe(false);
    expect(rerouteContextIsCurrent({ ...live, sessionId: "session-old" }, expected)).toBe(false);
    expect(rerouteContextIsCurrent({ ...live, rerouteRequestId: "request-4" }, expected)).toBe(false);
    expect(rerouteContextIsCurrent({ ...live, direction: "reverse" }, expected)).toBe(false);
  });
});
