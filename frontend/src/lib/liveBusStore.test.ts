import { describe, expect, it } from "vitest";
import { BUS_EXPIRY_MS } from "./liveBusFreshness";
import {
  millisecondsUntilNextPrune,
  pruneExpiredLiveBuses,
  type LiveBusSnapshot,
} from "./liveBusSnapshot";

describe("live bus snapshot expiry", () => {
  const now = 2_000_000_000_000;

  it("preserves a snapshot when every entry is fresh", () => {
    const snapshot: LiveBusSnapshot = {
      fresh: { timestamp: now - 1_000 },
    };

    expect(pruneExpiredLiveBuses(snapshot, now)).toBe(snapshot);
  });

  it("removes expired, malformed, and far-future entries", () => {
    const snapshot: LiveBusSnapshot = {
      fresh: { timestamp: now - 1_000 },
      expired: { timestamp: now - BUS_EXPIRY_MS },
      missing: {},
      future: { timestamp: now + 10_001 },
    };

    expect(pruneExpiredLiveBuses(snapshot, now)).toEqual({
      fresh: { timestamp: now - 1_000 },
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

  it("schedules one expiry at the earliest inactive deadline", () => {
    const snapshot: LiveBusSnapshot = {
      later: { timestamp: now - 1_000 },
      earlier: { timestamp: now - 5_000 },
      active: {
        timestamp: now - BUS_EXPIRY_MS,
        status: "active",
        sessionId: "session_1",
        tripState: "in_service",
      },
    };

    expect(millisecondsUntilNextPrune(snapshot, now)).toBe(
      BUS_EXPIRY_MS - 5_000,
    );
    expect(millisecondsUntilNextPrune({ active: snapshot.active }, now)).toBeNull();
  });

  it("prunes malformed inactive entries without polling", () => {
    expect(millisecondsUntilNextPrune({ malformed: {} }, now)).toBe(0);
  });
});
