import { describe, expect, it } from "vitest";
import { ORIGIN_DEPARTURE_M, reduceTripState } from "./tripStateReducer";

const origin = { lat: 23.012441, lng: 72.458011 };
const about200mNorth = { lat: origin.lat + 0.0018, lng: origin.lng };

function input(overrides: Partial<Parameters<typeof reduceTripState>[0]> = {}) {
  return {
    lat: origin.lat,
    lng: origin.lng,
    motionState: "stopped" as const,
    currentTripState: "in_service" as const,
    currentStopIndex: 0,
    stops: [origin, about200mNorth],
    hasDepartedOrigin: false,
    ...overrides,
  };
}

describe("reduceTripState", () => {
  it("does not complete repeatedly at a circular route origin", () => {
    const stops = [origin, origin];
    const first = reduceTripState(input({ stops }));
    const second = reduceTripState(input({ stops, ...first }));

    expect(first.tripState).toBe("in_service");
    expect(second.tripState).toBe("in_service");
    expect(second.hasDepartedOrigin).toBe(false);
  });

  it("does not complete when the terminal is close to the origin", () => {
    const nearbyTerminal = { lat: origin.lat + 0.0001, lng: origin.lng };
    const result = reduceTripState(input({ stops: [origin, nearbyTerminal] }));

    expect(result.tripState).toBe("in_service");
  });

  it("requires departure when the driver starts directly in service", () => {
    const result = reduceTripState(input());

    expect(result.tripState).toBe("in_service");
    expect(result.hasDepartedOrigin).toBe(false);
  });

  it("persists departure evidence after moving beyond the origin radius", () => {
    const result = reduceTripState(
      input({
        lat: origin.lat + 0.0015,
        stops: [origin, { lat: origin.lat + 0.003, lng: origin.lng }],
      }),
    );

    expect(result.hasDepartedOrigin).toBe(true);
    expect(ORIGIN_DEPARTURE_M).toBe(150);
  });

  it("does not complete before end-of-route progress", () => {
    const terminal = { lat: origin.lat + 0.004, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: terminal.lat,
        lng: terminal.lng,
        stops: [origin, about200mNorth, { lat: origin.lat + 0.003, lng: origin.lng }, terminal],
        hasDepartedOrigin: true,
        currentStopIndex: 0,
      }),
    );

    expect(result.tripState).toBe("in_service");
  });

  it("completes once after departure, route progress, and terminal arrival", () => {
    const terminal = { lat: origin.lat + 0.004, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: terminal.lat,
        lng: terminal.lng,
        stops: [origin, about200mNorth, { lat: origin.lat + 0.003, lng: origin.lng }, terminal],
        hasDepartedOrigin: true,
        currentStopIndex: 3,
      }),
    );

    expect(result).toEqual({
      tripState: "completed",
      currentStopIndex: 3,
      hasDepartedOrigin: true,
    });
  });

  it("does not trust a client index to complete a straight two-stop trip in one update", () => {
    const result = reduceTripState(
      input({
        lat: about200mNorth.lat,
        lng: about200mNorth.lng,
        hasDepartedOrigin: true,
      }),
    );

    expect(result).toEqual({
      tripState: "in_service",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
    });
  });

  it("advances from the origin to the first destination after departure", () => {
    const middle = { lat: origin.lat + 0.003, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: origin.lat + 0.0015,
        stops: [origin, middle, { lat: origin.lat + 0.006, lng: origin.lng }],
      }),
    );

    expect(result.currentStopIndex).toBe(1);
    expect(result.hasDepartedOrigin).toBe(true);
    expect(result.tripState).toBe("in_service");
  });

  it("advances one stop at a time when entering an intermediate geofence", () => {
    const middle = { lat: origin.lat + 0.003, lng: origin.lng };
    const terminal = { lat: origin.lat + 0.006, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: middle.lat,
        lng: middle.lng,
        stops: [origin, middle, terminal],
        currentStopIndex: 1,
        hasDepartedOrigin: true,
      }),
    );

    expect(result).toEqual({
      tripState: "in_service",
      currentStopIndex: 2,
      hasDepartedOrigin: true,
    });
  });

  it("advances when an intermediate stop is crossed between telemetry fixes", () => {
    const middle = { lat: origin.lat + 0.003, lng: origin.lng };
    const terminal = { lat: origin.lat + 0.006, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: middle.lat + 0.00045,
        lng: middle.lng,
        previousPosition: { lat: middle.lat - 0.00045, lng: middle.lng },
        stops: [origin, middle, terminal],
        currentStopIndex: 1,
        hasDepartedOrigin: true,
      }),
    );

    expect(result).toEqual({
      tripState: "in_service",
      currentStopIndex: 2,
      hasDepartedOrigin: true,
    });
  });

  it("recovers progress when the bus reaches a downstream stop", () => {
    const missed = { lat: origin.lat + 0.002, lng: origin.lng };
    const downstream = { lat: origin.lat + 0.004, lng: origin.lng };
    const terminal = { lat: origin.lat + 0.006, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: downstream.lat,
        lng: downstream.lng,
        stops: [origin, missed, downstream, terminal],
        currentStopIndex: 1,
        hasDepartedOrigin: true,
      }),
    );

    expect(result.currentStopIndex).toBe(3);
    expect(result.tripState).toBe("in_service");
  });

  it("does not infer crossed stops from an implausibly long GPS jump", () => {
    const middle = { lat: origin.lat + 0.003, lng: origin.lng };
    const result = reduceTripState(
      input({
        lat: origin.lat + 0.006,
        previousPosition: { lat: origin.lat - 0.006, lng: origin.lng },
        stops: [origin, middle, { lat: origin.lat + 0.009, lng: origin.lng }],
        currentStopIndex: 1,
        hasDepartedOrigin: true,
      }),
    );

    expect(result.currentStopIndex).toBe(1);
  });

  it("requires the authoritative terminal index before completion", () => {
    const result = reduceTripState(
      input({
        lat: about200mNorth.lat,
        lng: about200mNorth.lng,
        currentStopIndex: 1,
        hasDepartedOrigin: true,
      }),
    );

    expect(result.tripState).toBe("completed");
  });

  it("preserves maintenance recovery behavior", () => {
    const lost = reduceTripState(input({ motionState: "uncertain" }));
    const recovered = reduceTripState(
      input({
        currentTripState: "maintenance",
        hasDepartedOrigin: lost.hasDepartedOrigin,
      }),
    );

    expect(lost.tripState).toBe("maintenance");
    expect(recovered.tripState).toBe("in_service");
  });
});
