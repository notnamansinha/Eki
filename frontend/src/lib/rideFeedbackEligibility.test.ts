import { describe, expect, it } from "vitest";
import {
  decideRideTracking,
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

describe("decideRideTracking", () => {
  const noStates = () => undefined;
  const stateOf = (map: Record<string, "completed" | "in_service">) =>
    (sessionId: string) => map[sessionId];

  it("starts tracking the active ride when nothing is tracked yet", () => {
    const action = decideRideTracking(null, new Set(["session-a"]), ride(), noStates);
    expect(action.type).toBe("observe");
    if (action.type === "observe") {
      expect(action.ride.sessionId).toBe("session-a");
      expect(action.ride.hasSelectedStop).toBe(false);
    }
  });

  it("does nothing when nothing is tracked and no ride is active", () => {
    expect(decideRideTracking(null, new Set(), null, noStates).type).toBe("none");
  });

  it("keeps observing the tracked session while it is still active", () => {
    const tracked = recordStopSelection(observeRide(null, ride()), "session-a", true);
    const action = decideRideTracking(tracked, new Set(["session-a"]), ride(), noStates);
    expect(action.type).toBe("observe");
    if (action.type === "observe") {
      expect(action.ride.hasSelectedStop).toBe(true);
    }
  });

  it("completes the ride when the tracked session vanished after completion", () => {
    const tracked = recordStopSelection(observeRide(null, ride()), "session-a", true);
    const action = decideRideTracking(
      tracked,
      new Set(),
      null,
      stateOf({ "session-a": "completed" }),
    );
    expect(action.type).toBe("complete");
    if (action.type === "complete") expect(action.ride.sessionId).toBe("session-a");
  });

  it("never re-binds to a different session when the tracked ride vanished (#68)", () => {
    // The driver ended/re-armed the shift: the tracked session is gone and a
    // NEW session is active on the same route. The passenger rode the old
    // session, so tracking must freeze instead of silently switching.
    const tracked = recordStopSelection(observeRide(null, ride()), "session-a", true);
    const rearmed = ride({ sessionId: "session-b" });
    const action = decideRideTracking(tracked, new Set(["session-b"]), rearmed, noStates);
    expect(action.type).toBe("freeze");
  });

  it("freezes even when the vanished ride never reached a completed state", () => {
    const tracked = observeRide(null, ride());
    expect(
      decideRideTracking(tracked, new Set(), null, stateOf({ "session-a": "in_service" })).type,
    ).toBe("freeze");
  });
});
