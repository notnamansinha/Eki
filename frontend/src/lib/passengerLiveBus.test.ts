import { describe, expect, it } from "vitest";
import { BUS_EXPIRY_MS } from "./liveBusFreshness";
import {
  normalizePassengerLiveBus,
  passengerLiveBuses,
  passengerLiveBusSelectionKey,
  passengerTripStates,
} from "./passengerLiveBus";

const now = 2_000_000_000_000;

function telemetry(overrides: Record<string, unknown> = {}) {
  return {
    busId: "Bus01",
    routeId: "route_1",
    lat: 23.03,
    lng: 72.47,
    heading: 70,
    speed: 22,
    timestamp: now - 1_000,
    deviceState: "online",
    tripState: "pre_departure",
    motionState: "moving",
    status: "offline",
    ...overrides,
  };
}

describe("passenger live-bus normalization", () => {
  it("shows a fresh powered bus before a ride session exists", () => {
    const bus = normalizePassengerLiveBus("Bus01_route_1", telemetry(), now);
    expect(bus).toMatchObject({
      busId: "Bus01",
      routeId: "route_1",
      deviceState: "online",
    });
    expect(bus?.sessionId).toBeUndefined();
  });

  it("shows fresh and stale active-session buses", () => {
    const fresh = telemetry({
      status: "active",
      sessionId: "session_1",
      tripState: "in_service",
    });
    const stale = { ...fresh, timestamp: now - BUS_EXPIRY_MS };

    expect(normalizePassengerLiveBus("Bus01_route_1", fresh, now)?.sessionId)
      .toBe("session_1");
    expect(normalizePassengerLiveBus("Bus01_route_1", stale, now)?.sessionId)
      .toBe("session_1");
  });

  it("hides stale sessionless and completed buses", () => {
    expect(
      normalizePassengerLiveBus(
        "Bus01_route_1",
        telemetry({ timestamp: now - BUS_EXPIRY_MS }),
        now,
      ),
    ).toBeNull();
    expect(
      normalizePassengerLiveBus(
        "Bus01_route_1",
        telemetry({
          status: "active",
          sessionId: "session_1",
          tripState: "completed",
        }),
        now,
      ),
    ).toBeNull();
  });

  it("rejects invalid routes, coordinates, timestamps, and enum values", () => {
    const malformed = [
      telemetry({ routeId: "" }),
      telemetry({ lat: 91 }),
      telemetry({ lng: Number.NaN }),
      telemetry({ timestamp: now + 10_001 }),
      telemetry({ status: "unknown" }),
      telemetry({ deviceState: "unknown" }),
      telemetry({ motionState: "flying" }),
      telemetry({ tripState: "paused" }),
    ];
    for (const value of malformed) {
      expect(normalizePassengerLiveBus("Bus01_route_1", value, now)).toBeNull();
    }
  });

  it("recovers an underscored bus id from a legacy node key", () => {
    const legacy = telemetry({ busId: undefined, routeId: "route_01" });
    expect(
      normalizePassengerLiveBus("bus_01_route_01", legacy, now)?.busId,
    ).toBe("bus_01");
    expect(normalizePassengerLiveBus("unrelated", legacy, now)).toBeNull();
  });

  it("supplies safe display defaults for a stale active legacy ride", () => {
    const bus = normalizePassengerLiveBus(
      "Bus01_route_1",
      {
        busId: "Bus01",
        routeId: "route_1",
        lat: 23.03,
        lng: 72.47,
        status: "active",
        sessionId: "session_1",
        tripState: "pre_departure",
      },
      now,
    );
    expect(bus).toMatchObject({
      heading: 0,
      speed: 0,
      timestamp: 0,
      deviceState: "offline",
      motionState: "uncertain",
    });
  });

  it("preserves multiple buses and gives sessionless selections stable keys", () => {
    const buses = passengerLiveBuses(
      {
        Bus01_route_1: telemetry(),
        Bus02_route_1: telemetry({ busId: "Bus02", sessionId: "session_2", status: "active" }),
        stale: telemetry({ busId: "Bus03", timestamp: now - BUS_EXPIRY_MS }),
      },
      now,
    );
    expect(buses.map((bus) => bus.busId)).toEqual(["Bus01", "Bus02"]);
    expect(passengerLiveBusSelectionKey(buses[0])).toBe("bus:route_1:Bus01");
    expect(passengerLiveBusSelectionKey(buses[1])).toBe("session:session_2");
  });

  it("observes a completed session even though that bus is no longer visible", () => {
    const completed = telemetry({
      status: "active",
      sessionId: "session_done",
      tripState: "completed",
    });
    const snapshot = { Bus01_route_1: completed };

    expect(passengerLiveBuses(snapshot, now)).toEqual([]);
    expect(passengerTripStates(snapshot)).toEqual(
      new Map([["session_done", "completed"]]),
    );
  });

  it("ignores malformed session lifecycle observations", () => {
    expect(
      passengerTripStates({
        missingSession: { tripState: "completed" },
        emptySession: { sessionId: "", tripState: "completed" },
        invalidState: { sessionId: "session_1", tripState: "paused" },
        valid: { sessionId: "session_2", tripState: "in_service" },
      }),
    ).toEqual(new Map([["session_2", "in_service"]]));
  });
});
