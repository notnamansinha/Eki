import { describe, expect, it } from "vitest";
import { isBehindBus, stopProgress, stopVisitLabel } from "./stopProgress";

describe("stop progress (field ride, 29 Oct 2026: A marked only at B, B never marked)", () => {
  it("shows the bus at A while it is still at the origin, with B next", () => {
    expect(stopProgress(4, { currentStopIndex: 0, atStopIndex: 0 })).toEqual({
      states: ["at", "next", "upcoming", "upcoming"], atStopIndex: 0, nextStopIndex: 1,
    });
  });

  it("marks B the moment the bus arrives at B, with C next", () => {
    expect(stopProgress(4, { currentStopIndex: 2, atStopIndex: 1 })).toEqual({
      states: ["passed", "at", "next", "upcoming"], atStopIndex: 1, nextStopIndex: 2,
    });
  });

  it("keeps B passed after the bus leaves it", () => {
    expect(stopProgress(4, { currentStopIndex: 2 })?.states).toEqual(["passed", "passed", "next", "upcoming"]);
  });

  it("shows a stop passed without being observed differently from an arrival", () => {
    const progress = stopProgress(5, { currentStopIndex: 3, atStopIndex: 2, unobservedStopIndices: [1] });
    expect(progress?.states).toEqual(["passed", "unobserved", "at", "next", "upcoming"]);
    expect(stopVisitLabel("unobserved")).toBe("Passed · not confirmed");
    expect(stopVisitLabel("passed")).toBe("Passed");
    expect(isBehindBus("unobserved")).toBe(true);
    expect(isBehindBus("at")).toBe(false);
  });

  it("shows the terminal as reached while its completion is still being confirmed", () => {
    expect(stopProgress(3, { currentStopIndex: 2, atStopIndex: 2 })).toEqual({
      states: ["passed", "passed", "at"], atStopIndex: 2,
    });
  });

  it("ignores stale, malformed or out-of-range evidence instead of inventing progress", () => {
    expect(stopProgress(4, undefined)).toBeUndefined();
    expect(stopProgress(4, { currentStopIndex: 7 })).toBeUndefined();
    expect(stopProgress(4, { currentStopIndex: 1.5 })).toBeUndefined();
    // An "at" more than one stop behind, or at an intermediate next stop, is stale.
    expect(stopProgress(5, { currentStopIndex: 3, atStopIndex: 1 })?.atStopIndex).toBeUndefined();
    expect(stopProgress(5, { currentStopIndex: 2, atStopIndex: 2 })?.atStopIndex).toBeUndefined();
    expect(stopProgress(4, { currentStopIndex: 2, unobservedStopIndices: [5, -1, 2, "1", 1] })?.states)
      .toEqual(["passed", "unobserved", "next", "upcoming"]);
    expect(stopProgress(4, { currentStopIndex: 2, unobservedStopIndices: { 0: 1 } })?.states)
      .toEqual(["passed", "passed", "next", "upcoming"]);
  });
});
