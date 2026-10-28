import { describe, expect, it } from "vitest";
import { BUS_EXPIRY_MS } from "./liveBusFreshness";
import { filterActiveBusEntries } from "./activeBusEntries";
import {
  millisecondsUntilNextPrune,
  pruneExpiredLiveBuses,
  type LiveBusSnapshot,
} from "./liveBusSnapshot";

describe("live bus snapshot expiry", () => {
  const now = 2_000_000_000_000;
  const recentAgeMs = BUS_EXPIRY_MS / 4;
  const olderFreshAgeMs = BUS_EXPIRY_MS / 2;

  it("preserves a snapshot when every entry is fresh", () => {
    const snapshot: LiveBusSnapshot = {
      fresh: { timestamp: now - recentAgeMs },
    };

    expect(pruneExpiredLiveBuses(snapshot, now)).toBe(snapshot);
  });

  it("removes expired and malformed entries", () => {
    const snapshot: LiveBusSnapshot = {
      fresh: { timestamp: now - recentAgeMs },
      expired: { timestamp: now - BUS_EXPIRY_MS },
      missing: {},
    };

    expect(pruneExpiredLiveBuses(snapshot, now)).toEqual({
      fresh: { timestamp: now - recentAgeMs },
    });
  });

  it("keeps a future-looking entry and schedules no immediate prune for it", () => {
    // A lagging viewer clock makes a fresh server receipt look like the
    // future; the passenger normalizers hide it, but the store must not
    // delete it 1 ms after every delivery.
    const snapshot: LiveBusSnapshot = { future: { timestamp: now + 15_000 } };

    expect(pruneExpiredLiveBuses(snapshot, now)).toBe(snapshot);
    expect(millisecondsUntilNextPrune(snapshot, now)).toBe(15_000 + BUS_EXPIRY_MS);
    expect(pruneExpiredLiveBuses(snapshot, now + 15_000 + BUS_EXPIRY_MS)).toEqual({});
  });

  it("expires a stale active ride with its telemetry, like an offline device", () => {
    const snapshot: LiveBusSnapshot = {
      active: {
        timestamp: now - BUS_EXPIRY_MS,
        status: "active",
        sessionId: "session_1",
        tripState: "in_service",
      },
      staleDeviceOnly: {
        timestamp: now - BUS_EXPIRY_MS,
        status: "offline",
        tripState: "pre_departure",
      },
    };

    expect(pruneExpiredLiveBuses(snapshot, now)).toEqual({});
    expect(millisecondsUntilNextPrune(snapshot, now)).toBe(0);
  });

  it("does not retain a stale active ride without a non-empty session", () => {
    const snapshot: LiveBusSnapshot = {
      emptySession: {
        busId: "bus_1",
        timestamp: now - BUS_EXPIRY_MS,
        status: "active",
        sessionId: "",
        tripState: "in_service",
      },
    };

    expect(pruneExpiredLiveBuses(snapshot, now)).toEqual({});
    expect(millisecondsUntilNextPrune(snapshot, now)).toBe(0);
    expect(filterActiveBusEntries(snapshot, now)).toEqual([]);
  });

  it("removes a completed ride immediately even if its final fix is fresh", () => {
    const snapshot: LiveBusSnapshot = {
      completed: {
        timestamp: now - recentAgeMs,
        status: "active",
        sessionId: "session_1",
        tripState: "completed",
      },
    };

    expect(pruneExpiredLiveBuses(snapshot, now)).toEqual({});
    expect(millisecondsUntilNextPrune(snapshot, now)).toBe(0);
  });

  it("schedules one expiry at the earliest deadline, rides included", () => {
    const snapshot: LiveBusSnapshot = {
      later: { timestamp: now - recentAgeMs },
      earlier: {
        timestamp: now - olderFreshAgeMs,
        status: "active",
        sessionId: "session_1",
        tripState: "in_service",
      },
    };

    expect(millisecondsUntilNextPrune(snapshot, now)).toBe(
      BUS_EXPIRY_MS - olderFreshAgeMs,
    );
    const deadline = now + BUS_EXPIRY_MS - olderFreshAgeMs;
    expect(pruneExpiredLiveBuses(snapshot, deadline - 1)).toBe(snapshot);
    expect(pruneExpiredLiveBuses(snapshot, deadline)).toEqual({ later: snapshot.later });
  });

  it("prunes malformed inactive entries without polling", () => {
    expect(millisecondsUntilNextPrune({ malformed: {} }, now)).toBe(0);
  });
  it("uses accepted server receipt for pruning and its exact expiry deadline", () => {
    const bus = { timestamp: now - BUS_EXPIRY_MS - 1, backendReceivedAt: now - BUS_EXPIRY_MS + 59_999 };
    expect(pruneExpiredLiveBuses({ bus }, now)).toEqual({ bus });
    expect(millisecondsUntilNextPrune({ bus }, now)).toBe(59_999);
    expect(pruneExpiredLiveBuses({ bus }, now + 59_999)).toEqual({});
  });
});
