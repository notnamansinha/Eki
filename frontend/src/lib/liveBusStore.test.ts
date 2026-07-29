import { describe, expect, it } from "vitest";
import { BUS_EXPIRY_MS } from "./liveBusFreshness";
import {
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
});
