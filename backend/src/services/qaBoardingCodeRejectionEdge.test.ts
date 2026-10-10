import { describe, expect, it } from "vitest";
import {
  boardingCodesMatch,
  generateBoardingCode,
  normalizeBoardingCode,
} from "./boardingPolicy";

describe("boarding code wrong-code rejection edge cases (qa)", () => {
  it("rejects a wrong code that is otherwise well-formed (HTTP 403 precondition)", () => {
    // sessions.ts throws BoardingPolicyError(403, "The boarding code is invalid.")
    // exactly when boardingCodesMatch returns false.
    expect(boardingCodesMatch("ABZ2349H", "ABZ2349X")).toBe(false);
    expect(boardingCodesMatch("ABZ2349H", "ZZZ9999Z")).toBe(false);
  });

  it("rejects codes containing ambiguous characters outside the alphabet", () => {
    // The boarding alphabet excludes I, O, 0 and 1 to avoid misreads.
    expect(normalizeBoardingCode("ABZ2349I")).toBeNull();
    expect(normalizeBoardingCode("ABO2349H")).toBeNull();
    expect(normalizeBoardingCode("AB02349H")).toBeNull();
    expect(normalizeBoardingCode("AB12349H")).toBeNull();
    expect(boardingCodesMatch("ABZ2349H", "ABZ2349I")).toBe(false);
    // Two invalid codes never match, even when identical.
    expect(boardingCodesMatch("ABZ2349I", "ABZ2349I")).toBe(false);
  });

  it("rejects non-string and malformed candidates", () => {
    expect(boardingCodesMatch("ABZ2349H", undefined)).toBe(false);
    expect(boardingCodesMatch("ABZ2349H", null)).toBe(false);
    expect(boardingCodesMatch("ABZ2349H", 12345678)).toBe(false);
    expect(boardingCodesMatch("ABZ2349H", "")).toBe(false);
    expect(boardingCodesMatch("ABZ2349H", "SHORT")).toBe(false);
    expect(boardingCodesMatch("ABZ2349H", "TOOLONGCODE")).toBe(false);
    expect(boardingCodesMatch(undefined, "ABZ2349H")).toBe(false);
    expect(boardingCodesMatch(null, null)).toBe(false);
  });

  it("still accepts case-folded and separator-stripped matches", () => {
    expect(boardingCodesMatch("ABZ2349H", "abz2-349h")).toBe(true);
    expect(boardingCodesMatch("ABZ2349H", "ABZ2 349H")).toBe(true);
  });

  it("generated codes never contain ambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateBoardingCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(code).not.toMatch(/[IO01]/);
    }
  });
});
