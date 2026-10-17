import { describe, expect, it } from "vitest";
import { reduceTripState } from "./tripStateReducer";

const stops = [{ lat: 23, lng: 72 }, { lat: 23.002, lng: 72 }, { lat: 23.004, lng: 72 }];
const arrival = {
  ...stops[2], stops, currentTripState: "in_service" as const,
  currentStopIndex: 2, hasDepartedOrigin: true, motionState: "stopped" as const,
  gpsHdop: 1, speed: 0, timestamp: 10_000,
};

describe("terminal service evidence", () => {
  it("does not activate a parked armed journey", () => {
    expect(reduceTripState({ ...arrival, ...stops[0], currentTripState: "pre_departure",
      currentStopIndex: 0, hasDepartedOrigin: false }).tripState).toBe("pre_departure");
  });
  it("activates an armed journey on observed departure", () => {
    expect(reduceTripState({ ...arrival, lat: 23.0015, motionState: "moving", speed: 20,
      currentTripState: "pre_departure", currentStopIndex: 0, hasDepartedOrigin: false }))
      .toMatchObject({ tripState: "in_service", currentStopIndex: 1, hasDepartedOrigin: true });
  });
  it.each([null, 8])("does not complete on poor/unknown quality: %s", gpsHdop => {
    expect(reduceTripState({ ...arrival, gpsHdop }).tripState).toBe("in_service");
  });
  it("does not complete on a moving segment crossing the terminal", () => {
    expect(reduceTripState({ ...arrival, lat: 23.0044, previousPosition: { lat: 23.0036, lng: 72 },
      motionState: "moving", speed: 30 }).tripState).toBe("in_service");
  });
  it("does not complete from one reliable terminal sample", () => {
    expect(reduceTripState(arrival).tripState).toBe("in_service");
  });
  it("confirms across fresh samples, and rejects duplicate timestamps", () => {
    const first = reduceTripState(arrival);
    expect(first.terminalArrival).toEqual({ startedAt: 10_000, lastSampledAt: 10_000 });
    expect(reduceTripState({ ...arrival, terminalArrival: first.terminalArrival }).tripState).toBe("in_service");
    const confirmed = reduceTripState({ ...arrival, timestamp: 12_000, terminalArrival: first.terminalArrival });
    expect(confirmed.tripState).toBe("completed");
  });
  it.each(["stale", "future", "outside", "uncertain", "missing-stop", "outage"])("rejects unsupported terminal service: %s", mode => {
    const candidate = { startedAt: 8_000, lastSampledAt: 9_000 };
    const result = reduceTripState({ ...arrival, terminalArrival: candidate,
      ...(mode === "stale" ? { now: 70_001 } : {}),
      ...(mode === "future" ? { now: -1 } : {}),
      ...(mode === "outside" ? { lng: 72.0006 } : {}),
      ...(mode === "uncertain" ? { motionState: "uncertain" as const } : {}),
      ...(mode === "missing-stop" ? { currentStopIndex: 1 } : {}),
      ...(mode === "outage" ? { timestamp: 70_001 } : {}),
    });
    expect(result.tripState).toBe("in_service");
  });
});
