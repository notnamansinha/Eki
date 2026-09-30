import { describe, expect, it } from "vitest";
import { normalizePassengerBusAvailability } from "./passengerBusAvailability";

const now = 2_000_000;

function onlineDevice(overrides: Record<string, unknown> = {}) {
  return {
    busId: "bus_1",
    routeId: "route_1",
    deviceState: "online",
    status: "offline",
    timestamp: now - 500,
    speed: 0,
    motionState: "stopped",
    ...overrides,
  };
}

describe("passenger bus availability", () => {
  it("shows a fresh stopped device without creating ride fields", () => {
    expect(normalizePassengerBusAvailability(
      "bus_1_route_1",
      onlineDevice(),
      now,
    )).toEqual({ busId: "bus_1", routeId: "route_1" });
  });

  it("does not duplicate an active ride as device-only availability", () => {
    expect(normalizePassengerBusAvailability(
      "bus_1_route_1",
      onlineDevice({
        status: "active",
        sessionId: "session_1",
        direction: "forward",
        tripState: "in_service",
      }),
      now,
    )).toBeNull();
  });

  it.each([
    { timestamp: now - 120_000 },
    { deviceState: "offline" },
    { routeId: "" },
  ])("hides stale, offline, or unassigned devices: %o", (overrides) => {
    expect(normalizePassengerBusAvailability(
      "bus_1_route_1",
      onlineDevice(overrides),
      now,
    )).toBeNull();
  });
});
