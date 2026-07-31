import { describe, expect, it } from "vitest";
import {
  ARRIVAL_STOP_UNAVAILABLE,
  RIDE_HISTORY_DELETE_WARNING,
  canDeleteRideHistory,
  dedupeStopRecords,
  destinationReachedAt,
  resolveArrivalStopName,
  rideHistoryDeletionTransition,
  timestampMillis,
  type RideStopRecord,
} from "./rideHistory";

describe("ride history timestamp normalization", () => {
  it("normalizes milliseconds, seconds, Date, and Firestore timestamp values", () => {
    const millis = 1_754_000_123_456;

    expect(timestampMillis(millis)).toBe(millis);
    expect(timestampMillis(millis / 1000)).toBe(millis);
    expect(timestampMillis(new Date(millis))).toBe(millis);
    expect(timestampMillis({ toMillis: () => millis })).toBe(millis);
    expect(timestampMillis({ seconds: 1_754_000_123, nanoseconds: 456_000_000 })).toBe(millis);
  });

  it("rejects missing and invalid timestamps", () => {
    expect(timestampMillis(undefined)).toBeNull();
    expect(timestampMillis(Number.NaN)).toBeNull();
    expect(timestampMillis(new Date("invalid"))).toBeNull();
  });
});

describe("ride history deletion interaction", () => {
  it("offers deletion only for terminal statuses", () => {
    expect(canDeleteRideHistory("completed")).toBe(true);
    expect(canDeleteRideHistory("interrupted")).toBe(true);
    expect(canDeleteRideHistory("failed")).toBe(true);
    expect(canDeleteRideHistory("pending")).toBe(false);
    expect(canDeleteRideHistory("armed")).toBe(false);
    expect(canDeleteRideHistory("active")).toBe(false);
  });

  it("opens and cancels without entering the deleting state", () => {
    const opened = rideHistoryDeletionTransition("idle", "open");
    const cancelled = rideHistoryDeletionTransition(opened, "cancel");

    expect(opened).toBe("confirming");
    expect(cancelled).toBe("idle");
    expect(rideHistoryDeletionTransition("idle", "confirm")).toBe("idle");
  });

  it("enters deleting only from an explicit in-app confirmation", () => {
    expect(rideHistoryDeletionTransition("confirming", "confirm")).toBe("deleting");
    expect(rideHistoryDeletionTransition("deleting", "open")).toBe("deleting");
    expect(RIDE_HISTORY_DELETE_WARNING).toContain("passenger manifest");
    expect(RIDE_HISTORY_DELETE_WARNING).toContain("route log");
    expect(RIDE_HISTORY_DELETE_WARNING).toContain("messages");
  });

  it("returns failures to confirmation and clears successful state", () => {
    expect(rideHistoryDeletionTransition("deleting", "failure")).toBe("confirming");
    expect(rideHistoryDeletionTransition("deleting", "success")).toBe("idle");
  });
});

describe("ride history stop records", () => {
  const stop = (
    stopIndex: number,
    stopId: string,
    timestamp: number,
  ): RideStopRecord => ({ stopIndex, stopId, stopName: stopId, timestamp });

  it("keeps the earliest trustworthy event for each stop index", () => {
    const records = dedupeStopRecords([
      stop(1, "central", 3_000),
      stop(1, "central", 2_000),
      stop(2, "central", 4_000),
      stop(3, "campus", 5_000),
    ]);

    expect(records).toEqual([
      stop(1, "central", 2_000),
      stop(2, "central", 4_000),
      stop(3, "campus", 5_000),
    ]);
  });

  it("uses stop IDs only when malformed legacy records have no valid index", () => {
    const malformed = stop(Number.NaN, "central", 3_000);
    const earlier = stop(Number.NaN, "central", 2_000);

    expect(dedupeStopRecords([malformed, earlier])).toEqual([earlier]);
  });

  it("does not report a destination event from before the passenger was recorded", () => {
    const stops = [stop(2, "campus", 10_000)];

    expect(destinationReachedAt("campus", 9_000, stops)).toBe(10_000_000);
    expect(destinationReachedAt("campus", 11_000, stops)).toBeNull();
    expect(destinationReachedAt(null, 9_000, stops)).toBeNull();
  });

  it("prefers the historical arrival-stop name over the current route catalog", () => {
    const historical = [{
      ...stop(2, "campus", 1_000),
      stopName: "Old Campus Gate",
    }];

    expect(resolveArrivalStopName(
      "campus",
      historical,
      [{ id: "campus", name: "Renamed Campus Gate" }],
    )).toBe("Old Campus Gate");
  });

  it("falls back to the current route catalog when history has no name", () => {
    expect(resolveArrivalStopName(
      "campus",
      [],
      [{ id: "campus", name: "Campus Gate" }],
    )).toBe("Campus Gate");
  });

  it("never exposes an unresolved arrival stop ID", () => {
    expect(resolveArrivalStopName("internal-stop-42", [], []))
      .toBe(ARRIVAL_STOP_UNAVAILABLE);
    expect(resolveArrivalStopName(null, [], []))
      .toBe(ARRIVAL_STOP_UNAVAILABLE);
  });
});
