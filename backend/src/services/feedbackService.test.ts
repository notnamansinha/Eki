import { describe, expect, it } from "vitest";
import {
  evaluateFeedback,
  FEEDBACK_COOLDOWN_MS,
} from "./feedbackService";

const rideOk = {
  isSessionPassenger: true,
  sessionCompleted: true,
  busMatches: true,
  driverMatches: true,
};

describe("evaluateFeedback", () => {
  const now = 1_000_000;

  it("allows a valid ride feedback with a rating", () => {
    expect(evaluateFeedback("ride", "Safe ride", 5, rideOk, undefined, now)).toEqual({
      allowed: true,
    });
  });

  it("allows a valid ride feedback with only a comment", () => {
    expect(evaluateFeedback("ride", "Smooth drive", null, rideOk, undefined, now)).toEqual({
      allowed: true,
    });
  });

  it("rejects a ride feedback from someone not on the session", () => {
    const result = evaluateFeedback("ride", "Nice", 4, { ...rideOk, isSessionPassenger: false }, undefined, now);
    expect(result).toEqual({
      allowed: false,
      reason: "eligibility",
      message: "Only passengers of this ride may review it.",
    });
  });

  it("rejects a ride feedback before the ride is completed", () => {
    const result = evaluateFeedback("ride", "Nice", 4, { ...rideOk, sessionCompleted: false }, undefined, now);
    expect(result).toEqual({
      allowed: false,
      reason: "state",
      message: "Ride feedback is available after the ride ends.",
    });
  });

  it("rejects a ride feedback whose bus does not match the session", () => {
    const result = evaluateFeedback("ride", "Nice", 4, { ...rideOk, busMatches: false }, undefined, now);
    expect(result).toEqual({
      allowed: false,
      reason: "eligibility",
      message: "Ride details do not match the session.",
    });
  });

  it("rejects a rating outside 1..5", () => {
    const result = evaluateFeedback("ride", "", 7, rideOk, undefined, now);
    expect(result).toEqual({
      allowed: false,
      reason: "validation",
      message: "Rating must be an integer from 1 to 5.",
    });
  });

  it("requires rating or comment for a ride", () => {
    const result = evaluateFeedback("ride", "", null, rideOk, undefined, now);
    expect(result.allowed).toBe(false);
  });

  it("enforces the 24h cooldown", () => {
    const result = evaluateFeedback("general", "Hello", null, rideOk, now - 60_000, now);
    expect(result).toEqual({
      allowed: false,
      reason: "cooldown",
      retryAfterMs: FEEDBACK_COOLDOWN_MS - 60_000,
    });
  });

  it("allows general feedback once the cooldown has elapsed", () => {
    expect(
      evaluateFeedback("general", "Hello", null, rideOk, now - FEEDBACK_COOLDOWN_MS - 1, now),
    ).toEqual({ allowed: true });
  });

  it("requires a comment for general feedback", () => {
    const result = evaluateFeedback("general", "", null, rideOk, undefined, now);
    expect(result.allowed).toBe(false);
  });
});
