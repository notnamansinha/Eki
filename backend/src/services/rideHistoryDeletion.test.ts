import { describe, expect, it } from "vitest";
import {
  dedupeDocumentReferences,
  isTerminalRideStatus,
} from "./rideHistoryDeletion";

describe("ride history deletion rules", () => {
  it("allows only terminal ride statuses", () => {
    expect(isTerminalRideStatus("completed")).toBe(true);
    expect(isTerminalRideStatus("interrupted")).toBe(true);
    expect(isTerminalRideStatus("failed")).toBe(true);
    expect(isTerminalRideStatus("pending")).toBe(false);
    expect(isTerminalRideStatus("armed")).toBe(false);
    expect(isTerminalRideStatus("active")).toBe(false);
    expect(isTerminalRideStatus(undefined)).toBe(false);
  });

  it("deduplicates same-ID and session-query projections by path", () => {
    const sameId = { path: "completed_trips/session-a", source: "same-id" };
    const queriedDuplicate = { path: "completed_trips/session-a", source: "query" };
    const legacyProjection = { path: "completed_trips/legacy-a", source: "query" };

    expect(dedupeDocumentReferences([
      sameId,
      queriedDuplicate,
      legacyProjection,
    ])).toEqual([queriedDuplicate, legacyProjection]);
  });
});
