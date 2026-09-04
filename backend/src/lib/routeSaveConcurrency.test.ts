import { describe, expect, it } from "vitest";
import {
  routeRevisionValue,
  routeGenerationValue,
  routeSaveIsConflict,
  validDirectionalMetadata,
  sameFirestoreTimestamp,
} from "./routeSaveConcurrency";

const validGeometry = {
  distanceMeters: 1000,
  forwardDistanceMeters: 1000,
  reverseDistanceMeters: 990,
  duration: "100s",
  forwardDuration: "100s",
  reverseDuration: "95s",
};

describe("route revision / ride-start generation readers", () => {
  it("defaults missing and legacy values to zero", () => {
    expect(routeRevisionValue(undefined)).toBe(0);
    expect(routeRevisionValue({})).toBe(0);
    expect(routeGenerationValue(undefined)).toBe(0);
    expect(routeGenerationValue({ revision: 3 })).toBe(0);
  });

  it("reads monotonic values only as positive safe integers", () => {
    expect(routeRevisionValue({ revision: 7 })).toBe(7);
    expect(routeRevisionValue({ revision: -2 })).toBe(0);
    expect(routeRevisionValue({ revision: "5" })).toBe(0);
    expect(routeGenerationValue({ rideStartGeneration: 4 })).toBe(4);
  });
});

describe("route save conflict detection (findings #1 and #3)", () => {
  const expected = { revision: 5, rideStartGeneration: 2 };

  it("accepts an edit when both snapshots match", () => {
    expect(
      routeSaveIsConflict("edit", { revision: 5, rideStartGeneration: 2 }, expected),
    ).toBe(false);
  });

  it("rejects an edit when a ride started during the save, bumping generation (#1)", () => {
    expect(
      routeSaveIsConflict("edit", { revision: 5, rideStartGeneration: 3 }, expected),
    ).toBe(true);
  });

  it("does not treat a create as a concurrency conflict (presence handled by caller)", () => {
    expect(
      routeSaveIsConflict("create", { revision: 6, rideStartGeneration: 3 }, expected),
    ).toBe(false);
  });
});

describe("full-precision Firestore Timestamp equality (finding #3)", () => {
  it("distinguishes timestamps that differ only in nanoseconds", () => {
    const a = { seconds: 100, nanoseconds: 100_000_000 };
    const b = { seconds: 100, nanoseconds: 100_000_001 };
    // toMillis() would consider these equal; full comparison must not.
    expect(a.seconds * 1_000 + Math.floor(a.nanoseconds / 1_000_000))
      .toBe(b.seconds * 1_000 + Math.floor(b.nanoseconds / 1_000_000));
    expect(sameFirestoreTimestamp(a, b)).toBe(false);
    expect(
      sameFirestoreTimestamp({ seconds: 100, nanoseconds: 100_000_000 }, a),
    ).toBe(true);
  });

  it("treats null/undefined consistently", () => {
    expect(sameFirestoreTimestamp(null, null)).toBe(true);
    expect(sameFirestoreTimestamp(undefined, null)).toBe(false);
  });
});

describe("directional geometry metadata guard (finding #7)", () => {
  it("accepts complete directional distance and duration metadata", () => {
    expect(validDirectionalMetadata(validGeometry)).toBe(true);
  });

  it("rejects when directional distances or durations are malformed", () => {
    expect(validDirectionalMetadata({ ...validGeometry, forwardDistanceMeters: undefined }))
      .toBe(false);
    expect(validDirectionalMetadata({ ...validGeometry, reverseDuration: "" }))
      .toBe(false);
    expect(validDirectionalMetadata({ ...validGeometry, distanceMeters: -5 }))
      .toBe(false);
    expect(validDirectionalMetadata({ ...validGeometry, duration: 42 }))
      .toBe(false);
  });
});