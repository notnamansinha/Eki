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
        currentStopIndex: 2,
      }),
    );

    expect(result).toEqual({
      tripState: "completed",
      currentStopIndex: 3,
      hasDepartedOrigin: true,
    });
  });

  it("uses persisted departure evidence after a backend restart", () => {
    const result = reduceTripState(
      input({
        lat: about200mNorth.lat,
        lng: about200mNorth.lng,
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
