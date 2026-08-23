import { describe, expect, it } from "vitest";
import {
  automaticTurnaroundIsReady,
  inferRideDirectionAtEndpoint,
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
    expect(automaticTurnaroundIsReady({ ...ready, now: 170_000 })).toBe(false);
    expect(automaticTurnaroundIsReady({
      ...ready,
      position: { lat: 23.05, lng: 72.05 },
    })).toBe(false);
  });
});
