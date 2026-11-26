// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { hasSeenTour, isFirstSignIn, markTourSeen, shouldAutoStartTour } from "./firstRunTour";

const NOW = Date.parse("2026-11-25T10:00:00Z");
const at = (offsetMs: number) => new Date(NOW + offsetMs).toUTCString();

afterEach(() => localStorage.clear());

describe("isFirstSignIn", () => {
  it("is true while the last sign-in is the account's creation", () => {
    expect(isFirstSignIn({ creationTime: at(-5_000), lastSignInTime: at(-5_000) }, NOW)).toBe(true);
    expect(isFirstSignIn({ creationTime: at(-5_000), lastSignInTime: at(-4_000) }, NOW)).toBe(true);
  });

  it("is false after a later sign-in", () => {
    expect(isFirstSignIn({ creationTime: at(-86_400_000), lastSignInTime: at(-1_000) }, NOW)).toBe(false);
  });

  it("is false for an old account still on its first session", () => {
    expect(isFirstSignIn({ creationTime: at(-30 * 86_400_000), lastSignInTime: at(-30 * 86_400_000) }, NOW)).toBe(false);
  });

  it("is false without sign-in metadata", () => {
    expect(isFirstSignIn(undefined, NOW)).toBe(false);
    expect(isFirstSignIn({ creationTime: "not a date", lastSignInTime: at(0) }, NOW)).toBe(false);
  });
});

describe("tour flag", () => {
  it("is kept per account in this browser", () => {
    expect(hasSeenTour("a")).toBe(false);
    markTourSeen("a");
    expect(hasSeenTour("a")).toBe(true);
    expect(hasSeenTour("b")).toBe(false);
  });

  it("stops the tour starting by itself once seen", () => {
    const metadata = { creationTime: at(0), lastSignInTime: at(0) };
    expect(shouldAutoStartTour("a", metadata, NOW)).toBe(true);
    markTourSeen("a");
    expect(shouldAutoStartTour("a", metadata, NOW)).toBe(false);
  });
});
