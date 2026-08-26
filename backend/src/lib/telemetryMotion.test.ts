import { describe, expect, it } from "vitest";
import { isPlausibleTelemetryTransition } from "./telemetryMotion";

describe("telemetry motion plausibility", () => {
  it("accepts a normal urban movement between fresh samples", () => {
    expect(
      isPlausibleTelemetryTransition(
        { lat: 23.0, lng: 72.5, speed: 30, timestamp: 1_000 },
        { lat: 23.001, lng: 72.5, speed: 30, timestamp: 4_000 },
      ),
    ).toBe(true);
  });

  it("rejects a city-scale teleport even when the new fix is otherwise valid", () => {
    expect(
      isPlausibleTelemetryTransition(
        { lat: 23.0, lng: 72.46, speed: 0, timestamp: 1_000 },
        { lat: 23.05, lng: 72.54, speed: 0, timestamp: 4_000 },
      ),
    ).toBe(false);
  });

  it("allows the first fix because there is no prior position to compare", () => {
    expect(
      isPlausibleTelemetryTransition(null, {
        lat: 23.0,
        lng: 72.5,
        speed: 0,
        timestamp: 1_000,
      }),
    ).toBe(true);
  });

  it("reacquires a validated position after a prolonged outage", () => {
    expect(
      isPlausibleTelemetryTransition(
        { lat: 23.0, lng: 72.46, speed: 0, timestamp: 1_000 },
        { lat: 23.05, lng: 72.54, speed: 0, timestamp: 301_001 },
      ),
    ).toBe(true);
  });

  it("keeps the jump guard through the exact reacquisition boundary", () => {
    const previous = { lat: 23.0, lng: 72.46, speed: 0, timestamp: 1_000 };
    expect(
      isPlausibleTelemetryTransition(previous, {
        lat: 23.05,
        lng: 72.54,
        speed: 0,
        timestamp: 301_000,
      }),
    ).toBe(false);
    expect(
      isPlausibleTelemetryTransition(previous, {
        lat: 23.05,
        lng: 72.54,
        speed: 0,
        timestamp: 301_001,
      }),
    ).toBe(true);
  });

  it("uses the larger reported speed without allowing negative speed", () => {
    expect(
      isPlausibleTelemetryTransition(
        { lat: 23.0, lng: 72.5, speed: -20, timestamp: 1_000 },
        { lat: 23.001, lng: 72.5, speed: 30, timestamp: 11_000 },
      ),
    ).toBe(true);
  });
});
