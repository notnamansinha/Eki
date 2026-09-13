import { describe, expect, it } from "vitest";
import { reduceTripState, type TripStateResult } from "./tripStateReducer";

// Accelerated synthetic samples only: no Firebase, Google or live device writes.
const naturalStops = Array.from({ length: 100 }, (_, i) => ({ lat: 23 + i * 0.0005, lng: 72 }));

describe("stationary readiness simulations", () => {
  it.each(["forward", "reverse"])("does not depart during 3,600 jittered origin samples: %s", direction => {
    const stops = direction === "forward" ? naturalStops : [...naturalStops].reverse();
    let state: TripStateResult = { tripState: "pre_departure", currentStopIndex: 0, hasDepartedOrigin: false };
    for (let tick = 0; tick < 3600; tick++) {
      state = reduceTripState({
        lat: stops[0].lat + Math.sin(tick) * 0.00003,
        lng: stops[0].lng + Math.cos(tick) * 0.00003,
        motionState: tick % 60 === 0 ? "uncertain" : "stopped", stops,
        currentTripState: state.tripState, currentStopIndex: state.currentStopIndex,
        hasDepartedOrigin: state.hasDepartedOrigin,
      });
      expect(state.currentStopIndex).toBe(0);
      expect(state.hasDepartedOrigin).toBe(false);
      expect(state.tripState).not.toBe("completed");
    }
  });

  it.each(["forward", "reverse"])("retains progress during 3,600 stopped samples between required stops: %s", direction => {
    const stops = direction === "forward" ? naturalStops : [...naturalStops].reverse();
    const midpoint = (stops[49].lat + stops[50].lat) / 2;
    let state: TripStateResult = { tripState: "in_service", currentStopIndex: 50, hasDepartedOrigin: true };
    for (let tick = 0; tick < 3600; tick++) {
      state = reduceTripState({ lat: midpoint + Math.sin(tick) * 0.00001, lng: 72,
        motionState: tick % 30 === 0 ? "uncertain" : "stopped", stops,
        currentTripState: state.tripState, currentStopIndex: state.currentStopIndex,
        hasDepartedOrigin: state.hasDepartedOrigin });
      expect(state).toEqual({ tripState: "in_service", currentStopIndex: 50, hasDepartedOrigin: true });
    }
  });
});
