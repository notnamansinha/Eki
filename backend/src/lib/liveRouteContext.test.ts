import { describe, expect, it } from "vitest";
import { withoutLiveRouteContext } from "./liveRouteContext";

describe("withoutLiveRouteContext", () => {
  it("preserves physical telemetry and lifecycle state while removing route-session state", () => {
    const result = withoutLiveRouteContext({
      busId: "bus_1",
      sessionId: "old-session",
      lat: 23.2,
      lng: 72.7,
      motionState: "stopped",
      activeRouteId: "route_1:reroute:7",
      activeRoutePolyline: "old-polyline",
      routeVersion: 7,
      routeSource: "dynamic-reroute",
      routeDirection: "forward",
      routeSessionId: "old-session",
      routeState: "ON_NEW_ROUTE",
      routeMatchHistory: [{ lat: 23.2, lng: 72.7 }],
      offRouteSampleCount: 4,
      mapMatchUpdatedAt: 1_000,
      matchConfidence: 0.8,
      distanceToActiveRoute: 42,
      matchedLocation: { lat: 23.2, lng: 72.7 },
      rerouteRequestId: "old-request",
      lastRerouteAttemptAt: 900,
      rerouteError: "old-error",
      rerouteCompletedAt: 950,
      rerouteFailedAt: 975,
    });

    expect(result).toEqual({
      busId: "bus_1",
      sessionId: "old-session",
      lat: 23.2,
      lng: 72.7,
      motionState: "stopped",
    });
  });
});
