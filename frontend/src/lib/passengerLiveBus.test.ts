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
  it("does not advertise a fresh powered device as passenger service", () => {
    const bus = normalizePassengerLiveBus("Bus01_route_1", telemetry(), now);
    expect(bus).toBeNull();
  });

  it("shows fresh and stale active-session buses", () => {
    const fresh = telemetry({
      status: "active",
      sessionId: "session_1",
      tripState: "in_service",
      direction: "forward",
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
          direction: "forward",
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
    const legacy = telemetry({
      busId: undefined,
      routeId: "route_01",
      status: "active",
      sessionId: "session_legacy",
      direction: "forward",
    });
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
        direction: "reverse",
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

  it("keeps only complete services and retains stable selection keys", () => {
    const buses = passengerLiveBuses(
      {
        Bus01_route_1: telemetry(),
        Bus02_route_1: telemetry({
          busId: "Bus02",
          sessionId: "session_2",
          status: "active",
          direction: "forward",
        }),
        stale: telemetry({ busId: "Bus03", timestamp: now - BUS_EXPIRY_MS }),
      },
      now,
    );
    expect(buses.map((bus) => bus.busId)).toEqual(["Bus02"]);
    expect(passengerLiveBusSelectionKey(buses[0])).toBe("session:session_2");
    expect(passengerLiveBusSelectionKey({
      ...telemetry(),
      busId: "Bus01",
      routeId: "route_1",
    } as never)).toBe("bus:route_1:Bus01");
  });

  it("observes a completed session even though that bus is no longer visible", () => {
    const completed = telemetry({
      status: "active",
      sessionId: "session_done",
      tripState: "completed",
      direction: "forward",
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
