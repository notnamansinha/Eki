import { describe, expect, it } from "vitest";
import {
  boardingCodesMatch,
  generateBoardingCode,
  normalizeBoardingCode,
  validateLiveBoardingProjection,
  validatePassengerPosition,
  validateStopSelection,
} from "./boardingPolicy";

describe("boarding policy", () => {
  it("generates an unbiased, human-readable 40-bit code", () => {
    expect(generateBoardingCode(Buffer.from([0, 1, 23, 24, 25, 30, 31, 7]))).toBe("ABZ2389H");
    expect(() => generateBoardingCode(Buffer.alloc(7))).toThrow("Insufficient randomness");
  });

  it("normalizes display separators and compares only valid codes", () => {
    expect(normalizeBoardingCode("abz2-349h")).toBe("ABZ2349H");
    expect(boardingCodesMatch("ABZ2349H", "abz2 349h")).toBe(true);
    expect(boardingCodesMatch("ABZ2349H", "ABZ2349I")).toBe(false);
    expect(boardingCodesMatch("short", "short")).toBe(false);
  });

  it("requires route-owned stops in forward order", () => {
    const stops = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
    expect(validateStopSelection(stops, "s1", "s3")).toEqual({
      boardingStopId: "s1",
      alightingStopId: "s3",
    });
    expect(validateStopSelection(stops, "s2", null)).toEqual({
      boardingStopId: "s2",
      alightingStopId: null,
    });
    expect(validateStopSelection(stops, "missing", null)).toBeNull();
    expect(validateStopSelection(stops, "s2", "s2")).toBeNull();
    expect(validateStopSelection(stops, "s3", "s1")).toBeNull();
  });

  it("binds a fresh trusted projection to the exact live session", () => {
    const now = 1_800_000_000_000;
    const expected = { sessionId: "session_1", busId: "bus_1", routeId: "route_1" };
    const live = {
      ...expected,
      status: "active",
      deviceState: "online",
      motionState: "stopped",
      lat: 23,
      lng: 72.5,
      timestamp: now - 30_000,
    };
    expect(validateLiveBoardingProjection(live, expected, now)).toEqual({ lat: 23, lng: 72.5 });
    expect(validateLiveBoardingProjection({ ...live, sessionId: "other" }, expected, now)).toBeNull();
    expect(validateLiveBoardingProjection({ ...live, timestamp: now - 60_001 }, expected, now)).toBeNull();
    expect(validateLiveBoardingProjection({ ...live, timestamp: now + 10_001 }, expected, now)).toBeNull();
    expect(validateLiveBoardingProjection({ ...live, motionState: "uncertain" }, expected, now)).toBeNull();
  });

  it("rejects low-quality or malformed passenger coordinates", () => {
    expect(validatePassengerPosition(23, 72.5, 25)).toEqual({ lat: 23, lng: 72.5, accuracy: 25 });
    expect(validatePassengerPosition(91, 72.5, 25)).toBeNull();
    expect(validatePassengerPosition(23, 72.5, 101)).toBeNull();
    expect(validatePassengerPosition("23", 72.5, 25)).toBeNull();
  });
});
