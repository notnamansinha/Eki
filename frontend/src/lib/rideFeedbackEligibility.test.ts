import { describe, expect, it } from "vitest";
import {
  decideRideTracking,
  isPostRideFeedbackEligible,
  observeRide,
  recordSuccessfulJoin,
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
  it("never prompts a spectator when a ride completes", () => {
    const tracked = observeRide(null, ride());

    expect(isPostRideFeedbackEligible(tracked, "completed")).toBe(false);
  });

  it("prompts a successfully joined passenger only after completion", () => {
    const tracked = recordSuccessfulJoin(null, ride());

    expect(isPostRideFeedbackEligible(tracked, "in_service")).toBe(false);
    expect(isPostRideFeedbackEligible(tracked, "completed")).toBe(true);
  });
});

describe("decideRideTracking", () => {
  const noStates = () => undefined;
  const stateOf = (map: Record<string, "completed" | "in_service">) =>
    (sessionId: string) => map[sessionId];
  const activeRides = (...rides: RideIdentity[]) =>
    new Map(rides.map((activeRide) => [activeRide.sessionId, activeRide]));

  it("does not start tracking from passive observation", () => {
    const action = decideRideTracking(null, activeRides(ride()), noStates);
    expect(action.type).toBe("none");
  });

  it("does nothing when nothing is tracked and no ride is active", () => {
    expect(decideRideTracking(null, new Map(), noStates).type).toBe("none");
  });

  it("keeps observing the tracked session while it is still active", () => {
    const tracked = recordSuccessfulJoin(null, ride());
    const action = decideRideTracking(tracked, activeRides(ride()), noStates);
    expect(action.type).toBe("observe");
    if (action.type === "observe") {
      expect(action.ride.hasJoined).toBe(true);
    }
  });

  it("completes the ride when the tracked session vanished after completion", () => {
    const tracked = recordSuccessfulJoin(null, ride());
    const action = decideRideTracking(
      tracked,
      new Map(),
      stateOf({ "session-a": "completed" }),
    );
    expect(action.type).toBe("complete");
    if (action.type === "complete") expect(action.ride.sessionId).toBe("session-a");
  });

  it("never re-binds to a different session when the tracked ride vanished (#68)", () => {
    // The driver ended/re-armed the shift: the tracked session is gone and a
    // NEW session is active on the same route. The passenger rode the old
    // session, so tracking must freeze instead of silently switching.
    const tracked = recordSuccessfulJoin(null, ride());
    const rearmed = ride({ sessionId: "session-b" });
    const action = decideRideTracking(tracked, activeRides(rearmed), noStates);
    expect(action.type).toBe("freeze");
  });

  it("observes the tracked identity when two sessions share a route", () => {
    const tracked = recordSuccessfulJoin(null, ride());
    const other = ride({ sessionId: "session-b", busId: "bus-b" });
    const action = decideRideTracking(
      tracked,
      activeRides(other, ride()),
      noStates,
    );
    expect(action.type).toBe("observe");
    if (action.type === "observe") {
      expect(action.ride.sessionId).toBe("session-a");
      expect(action.ride.busId).toBe("bus-a");
      expect(action.ride.hasJoined).toBe(true);
    }
  });

  it("freezes even when the vanished ride never reached a completed state", () => {
    const tracked = observeRide(null, ride());
    expect(
      decideRideTracking(tracked, new Map(), stateOf({ "session-a": "in_service" })).type,
    ).toBe("freeze");
  });

  it("lets an explicit successful join replace a frozen spectator ride", () => {
    const spectator = observeRide(null, ride());
    const joined = recordSuccessfulJoin(
      spectator,
      ride({ sessionId: "session-b", busId: "bus-b" }),
    );
    expect(joined).toMatchObject({
      sessionId: "session-b",
      busId: "bus-b",
      hasJoined: true,
    });
  });
});
