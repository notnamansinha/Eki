import { describe, expect, it } from "vitest";
import {
  hasSelectedRideStop,
  isPostRideFeedbackEligible,
  observeRide,
  recordStopSelection,
  type RideIdentity,
} from "./rideFeedbackEligibility";

const ride = (overrides: Partial<RideIdentity> = {}): RideIdentity => ({
  sessionId: "session-a",
  busId: "bus-a",
  routeId: "route-a",
  driverId: "driver-a",
  ...overrides,
});

describe("post-ride feedback eligibility", () => {
  it("treats either a boarding or destination choice as participation", () => {
    expect(hasSelectedRideStop("boarding", "")).toBe(true);
    expect(hasSelectedRideStop("", "destination")).toBe(true);
    expect(hasSelectedRideStop("", "")).toBe(false);
  });

  it("never prompts a spectator when a ride completes", () => {
    const tracked = observeRide(null, ride());

    expect(isPostRideFeedbackEligible(tracked, "completed")).toBe(false);
  });

  it("prompts a participating passenger only after completion", () => {
    const observed = observeRide(null, ride());
    const tracked = recordStopSelection(observed, "session-a", true);

    expect(tracked).not.toBeNull();
    expect(isPostRideFeedbackEligible(tracked!, "in_service")).toBe(false);
    expect(isPostRideFeedbackEligible(tracked!, "completed")).toBe(true);
  });

  it("does not clear participation if the user later clears the selectors", () => {
    const joined = recordStopSelection(observeRide(null, ride()), "session-a", true);

    expect(recordStopSelection(joined, "session-a", false)?.hasSelectedStop).toBe(true);
  });

  it("ignores stale callbacks and resets participation for a new session", () => {
    const oldRide = recordStopSelection(observeRide(null, ride()), "session-a", true);
    const newRide = observeRide(oldRide, ride({ sessionId: "session-b" }));

    expect(recordStopSelection(newRide, "session-a", true)).toEqual(newRide);
    expect(newRide.hasSelectedStop).toBe(false);
    expect(isPostRideFeedbackEligible(newRide, "completed")).toBe(false);
  });
});
