import { describe, expect, it } from "vitest";
import {
  automaticTurnaroundIsReady,
  inferRideDirectionAtEndpoint,
  inferRideDirectionFromTelemetry,
  oppositeRideDirection,
} from "./automaticRideDirection";

const stops = [
  { lat: 23, lng: 72 },
  { lat: 23.05, lng: 72.05 },
  { lat: 23.1, lng: 72.1 },
];

describe("automatic ride direction", () => {
  it("infers forward at A and reverse at Z", () => {
    expect(inferRideDirectionAtEndpoint(stops, { lat: 23, lng: 72 })).toBe("forward");
    expect(inferRideDirectionAtEndpoint(stops, { lat: 23.1, lng: 72.1 })).toBe("reverse");
  });

  it("fails closed between endpoints and when endpoints overlap", () => {
    expect(inferRideDirectionAtEndpoint(stops, { lat: 23.05, lng: 72.05 })).toBeNull();
    expect(inferRideDirectionAtEndpoint(
      [{ lat: 23, lng: 72 }, { lat: 23, lng: 72 }],
      { lat: 23, lng: 72 },
    )).toBeNull();
  });

  it("resolves only a fresh, stopped, high-quality fix inside one endpoint geofence", () => {
    const telemetry = {
      now: 100_000,
      timestamp: 99_000,
      motionState: "stopped",
      gpsHdop: 2,
      position: { lat: 23, lng: 72 },
    };
    expect(inferRideDirectionFromTelemetry(stops, telemetry)).toBe("forward");
    expect(inferRideDirectionFromTelemetry(stops, {
      ...telemetry,
      position: { lat: 23.1, lng: 72.1 },
    })).toBe("reverse");
    expect(inferRideDirectionFromTelemetry(stops, {
      ...telemetry,
      motionState: "moving",
    })).toBeNull();
    expect(inferRideDirectionFromTelemetry(stops, {
      ...telemetry,
      gpsHdop: 4.1,
    })).toBeNull();
    expect(inferRideDirectionFromTelemetry(stops, {
      ...telemetry,
      gpsHdop: -1,
    })).toBeNull();
    expect(inferRideDirectionFromTelemetry(stops, {
      ...telemetry,
      timestamp: 39_999,
    })).toBeNull();
    expect(inferRideDirectionFromTelemetry(stops, {
      ...telemetry,
      position: { lat: 23.00025, lng: 72 },
    })).toBeNull();
  });

  it("always selects the opposite return direction", () => {
    expect(oppositeRideDirection("forward")).toBe("reverse");
    expect(oppositeRideDirection("reverse")).toBe("forward");
  });

  it("requires fresh stopped endpoint telemetry after the dwell", () => {
    const ready = {
      now: 200_000,
      telemetryTimestamp: 199_000,
      eligibleAt: 180_000,
      motionState: "stopped",
      position: { lat: 23.1, lng: 72.1 },
      destination: { lat: 23.1, lng: 72.1 },
    };
    expect(automaticTurnaroundIsReady(ready)).toBe(true);
    expect(automaticTurnaroundIsReady({ ...ready, motionState: "moving" })).toBe(false);
    expect(automaticTurnaroundIsReady({ ...ready, telemetryTimestamp: 100_000 })).toBe(false);
    expect(automaticTurnaroundIsReady({ ...ready, telemetryTimestamp: 179_999 })).toBe(false);
    expect(automaticTurnaroundIsReady({ ...ready, now: 170_000 })).toBe(false);
    expect(automaticTurnaroundIsReady({
      ...ready,
      position: { lat: 23.05, lng: 72.05 },
    })).toBe(false);
  });
});

it("allows a return trip on the first stopped sample when no dwell is configured", () => {
  expect(automaticTurnaroundIsReady({ now: 200000, telemetryTimestamp: 200000,
    eligibleAt: 200000, motionState: "stopped", position: { lat: 23.1, lng: 72.1 },
    destination: { lat: 23.1, lng: 72.1 } })).toBe(true);
});
