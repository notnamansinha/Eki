import { describe, expect, it } from "vitest";
import {
  countRidesByDirection,
  normalizeRideDirection,
  stopsInRideDirection,
} from "./rideDirection";
import { reduceTripState } from "../services/tripStateReducer";

describe("ride direction", () => {
  it("defaults legacy rides to forward and reverses without mutating the route", () => {
    const source = ["A", "M", "Z"];
    expect(normalizeRideDirection(undefined)).toBe("forward");
    expect(stopsInRideDirection(source, "forward")).toEqual(["A", "M", "Z"]);
    expect(stopsInRideDirection(source, "reverse")).toEqual(["Z", "M", "A"]);
    expect(source).toEqual(["A", "M", "Z"]);
  });

  it("counts completed rides by direction and treats legacy rides as forward", () => {
    expect(countRidesByDirection([
      { direction: "forward" },
      { direction: "reverse" },
      {},
    ])).toEqual({ forward: 2, reverse: 1, total: 3 });
  });

  it("runs the same reducer from Z back to A in reverse travel order", () => {
    const naturalStops = [
      { id: "a", lat: 0, lng: 0 },
      { id: "middle", lat: 0.01, lng: 0 },
      { id: "z", lat: 0.02, lng: 0 },
    ];
    const stops = stopsInRideDirection(naturalStops, "reverse");
    const activated = reduceTripState({
      lat: 0.02,
      lng: 0,
      motionState: "stopped",
      currentTripState: "pre_departure",
      currentStopIndex: 0,
      stops,
      hasDepartedOrigin: false,
    });
    const departed = reduceTripState({
      lat: 0.018,
      lng: 0,
      previousPosition: { lat: 0.02, lng: 0 },
      motionState: "moving",
      currentTripState: activated.tripState,
      currentStopIndex: activated.currentStopIndex,
      stops,
      hasDepartedOrigin: activated.hasDepartedOrigin,
    });
    const middle = reduceTripState({
      lat: 0.01,
      lng: 0,
      previousPosition: { lat: 0.011, lng: 0 },
      motionState: "stopped",
      currentTripState: departed.tripState,
      currentStopIndex: departed.currentStopIndex,
      stops,
      hasDepartedOrigin: departed.hasDepartedOrigin,
    });
    const completed = reduceTripState({
      lat: 0,
      lng: 0,
      previousPosition: { lat: 0.001, lng: 0 },
      motionState: "stopped",
      currentTripState: middle.tripState,
      currentStopIndex: middle.currentStopIndex,
      stops,
      hasDepartedOrigin: middle.hasDepartedOrigin,
    });

    expect(activated.tripState).toBe("in_service");
    expect(departed).toMatchObject({ currentStopIndex: 1, hasDepartedOrigin: true });
    expect(middle.currentStopIndex).toBe(2);
    expect(completed.tripState).toBe("completed");
  });
});
