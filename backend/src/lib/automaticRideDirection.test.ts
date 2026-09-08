import { describe, expect, it } from "vitest";
import {
  ARRIVAL_RADIUS_M,
  ENDPOINT_GEOFENCE_M,
  automaticTurnaroundIsReady,
  inferRideDirectionAtEndpoint,
  oppositeRideDirection,
} from "./automaticRideDirection";
import { STOP_GEOFENCE_M } from "../services/tripStateReducer";

const stops = [
  { lat: 23, lng: 72 },
  { lat: 23.05, lng: 72.05 },
  { lat: 23.1, lng: 72.1 },
];

describe("endpoint geofence (#149 p3)", () => {
  it("shares ONE geofence source of truth with the trip engine", () => {
    expect(ENDPOINT_GEOFENCE_M).toBe(20);
    expect(STOP_GEOFENCE_M).toBe(ENDPOINT_GEOFENCE_M);
  });

  it("keeps direction inference at the 20 m geofence, not the 75 m arrival radius", () => {
    // ~4 m from A → inside inference geofence → forward.
    expect(inferRideDirectionAtEndpoint(stops, { lat: 23.00004, lng: 72 })).toBe("forward");
    // ~33 m from A, beyond the 20 m geofence but inside 75 m → must stay pending.
    expect(inferRideDirectionAtEndpoint(stops, { lat: 23.0003, lng: 72 })).toBeNull();
    // Separate constants so turnaround arrival keeps the wider 75 m radius.
    expect(ARRIVAL_RADIUS_M).toBe(75);
  });

  it("does not guess a reverse direction 257 m from Z", () => {
    // Z is (23.1, 72.1); ~256 m south is far outside any geofence → pending.
    expect(inferRideDirectionAtEndpoint(stops, { lat: 23.0977, lng: 72.1 })).toBeNull();
  });
});

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
    expect(automaticTurnaroundIsReady({ ...ready, telemetryTimestamp: 179_999 })).toBe(false);
    expect(automaticTurnaroundIsReady({ ...ready, now: 170_000 })).toBe(false);
    expect(automaticTurnaroundIsReady({
      ...ready,
      position: { lat: 23.05, lng: 72.05 },
    })).toBe(false);
  });
});
