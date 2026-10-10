import { describe, expect, it } from "vitest";
import { BUS_EXPIRY_MS } from "./liveBusFreshness";
import {
  ACTIVE_RIDE_RETENTION_MS,
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

  it("removes expired, malformed, and far-future entries", () => {
    const snapshot: LiveBusSnapshot = {
      fresh: { timestamp: now - recentAgeMs },
      expired: { timestamp: now - BUS_EXPIRY_MS },
      missing: {},
      future: { timestamp: now + 10_001 },
    };

    expect(pruneExpiredLiveBuses(snapshot, now)).toEqual({
      fresh: { timestamp: now - recentAgeMs },
    });
  });

  it("retains a stale active ride so signal loss does not end it", () => {
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

    expect(pruneExpiredLiveBuses(snapshot, now)).toEqual({
      active: snapshot.active,
    });
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

  it("schedules one expiry at the earliest inactive deadline", () => {
    const snapshot: LiveBusSnapshot = {
      later: { timestamp: now - recentAgeMs },
      earlier: { timestamp: now - olderFreshAgeMs },
      active: {
        timestamp: now - BUS_EXPIRY_MS,
        status: "active",
        sessionId: "session_1",
        tripState: "in_service",
      },
    };

    expect(millisecondsUntilNextPrune(snapshot, now)).toBe(
      BUS_EXPIRY_MS - olderFreshAgeMs,
    );
    expect(millisecondsUntilNextPrune({ active: snapshot.active }, now)).toBe(
      ACTIVE_RIDE_RETENTION_MS - BUS_EXPIRY_MS,
    );
  });

  it("expires an orphaned active ride at its bounded retention deadline", () => {
    const active = {
      timestamp: now - BUS_EXPIRY_MS,
      status: "active",
      sessionId: "session_1",
      tripState: "in_service",
    };
    const deadline = now + ACTIVE_RIDE_RETENTION_MS - BUS_EXPIRY_MS;
    expect(pruneExpiredLiveBuses({ active }, deadline - 1)).toEqual({ active });
    expect(millisecondsUntilNextPrune({ active }, deadline - 1)).toBe(1);
    expect(pruneExpiredLiveBuses({ active }, deadline)).toEqual({});
    expect(millisecondsUntilNextPrune({ active }, deadline)).toBe(0);
    expect(pruneExpiredLiveBuses({ active: { ...active, timestamp: undefined } }, now)).toEqual({});
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
