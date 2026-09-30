import { describe, expect, it } from "vitest";
import { normalizePassengerLiveBus, passengerLiveBusSelectionKey } from "./passengerLiveBus";

describe("stationary passenger readiness simulation", () => {
  it.each(["pre_departure", "in_service"])("keeps stopped %s service visible for 3,600 updates", tripState => {
    const start = 2_000_000_000_000;
    for (let tick = 0; tick < 3600; tick++) {
      const now = start + tick * 1000;
      const bus = normalizePassengerLiveBus("bus_route", {
        busId: "bus", routeId: "route", sessionId: "ride", status: "active",
        tripState, direction: "forward", directionState: "resolved",
        deviceState: "online", lat: 23, lng: 72, speed: 0, heading: 0,
        motionState: "stopped", timestamp: now - 200,
      }, now);
      expect(bus).not.toBeNull();
      expect(bus?.speed).toBe(0);
      expect(passengerLiveBusSelectionKey(bus!)).toBe("session:ride");
    }
  });
});
