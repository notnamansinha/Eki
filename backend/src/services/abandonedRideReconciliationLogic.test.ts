import { describe, expect, it } from "vitest";
import {
  latestSessionActivity,
  reconciliationDecision,
  timestampMillis,
} from "./abandonedRideReconciliationLogic";

describe("abandoned ride reconciliation logic", () => {
  const cutoff = 1_800_000_000_000;

  it("normalizes legacy and Firestore timestamps", () => {
    expect(timestampMillis(1_750_000_000)).toBe(1_750_000_000_000);
    expect(timestampMillis({ seconds: 1_750_000_000, nanoseconds: 500_000_000 }))
      .toBe(1_750_000_000_500);
    expect(timestampMillis({ toMillis: () => 1_750_000_000_123 }))
      .toBe(1_750_000_000_123);
  });

  it("uses the latest session event as the interruption time", () => {
    expect(latestSessionActivity({
      status: "active",
      startTime: 1_700_000_000_000,
      stopsReached: {
        0: { timestamp: 1_710_000_000_000 },
        1: { timestamp: { toMillis: () => 1_720_000_000_000 } },
      },
      passengers: { user: { joinedAt: 1_715_000_000_000 } },
    })).toBe(1_720_000_000_000);
  });

  it("reconciles a stale session and matching stale lifecycle records", () => {
    expect(reconciliationDecision(
      "session-a",
      { status: "active", startTime: cutoff - 20_000 },
      { sessionId: "session-a", updatedAt: cutoff - 10_000 },
      { sessionId: "session-a", timestamp: cutoff - 5_000 },
      cutoff,
    )).toEqual({ stale: true, lastActivity: cutoff - 5_000, reason: "stale" });
  });

  it("protects sessions with recent canonical or live activity", () => {
    expect(reconciliationDecision(
      "session-a",
      { status: "armed", armedAt: cutoff - 20_000 },
      { sessionId: "session-a", updatedAt: cutoff + 1 },
      null,
      cutoff,
    ).reason).toBe("recent");
    expect(reconciliationDecision(
      "session-a",
      { status: "active", startTime: cutoff - 20_000 },
      null,
      { sessionId: "session-a", timestamp: cutoff + 1 },
      cutoff,
    ).reason).toBe("recent");
  });

  it("fails closed for matching lifecycle records with unknown activity", () => {
    expect(reconciliationDecision(
      "session-a",
      { status: "active", startTime: cutoff - 20_000 },
      { sessionId: "session-a" },
      null,
      cutoff,
    ).reason).toBe("unknown_activity");
  });

  it("ignores lifecycle records belonging to a newer session", () => {
    expect(reconciliationDecision(
      "session-a",
      { status: "active", startTime: cutoff - 20_000 },
      { sessionId: "session-b", updatedAt: cutoff + 1 },
      { sessionId: "session-b", timestamp: cutoff + 1 },
      cutoff,
    ).stale).toBe(true);
  });
});
