import { describe, expect, it } from "vitest";
import {
  evaluateChatRate,
  HOUR_MS,
  MAX_MESSAGES_PER_HOUR,
  MAX_MESSAGES_PER_MINUTE,
  MIN_GAP_MS,
} from "./chatRateLimit";

type StoredWindow = { sentAt?: number[]; lastSentAt?: number };
type Outcome = { n: number; allowed: boolean; reason?: string };

/**
 * Simulate a user sending messages with a fixed spacing, mirroring how
 * sessions.ts persists the window: sentAt = check.nextSentAt and
 * lastSentAt = the server timestamp of the send.
 */
function simulateSend(
  count: number,
  spacingMs: number,
): { outcomes: Outcome[]; existing?: StoredWindow; t0: number } {
  let existing: StoredWindow | undefined;
  const outcomes: Outcome[] = [];
  const t0 = 1_000_000;
  for (let n = 1; n <= count; n++) {
    const now = t0 + (n - 1) * spacingMs;
    const check = evaluateChatRate(existing, now);
    if (!check.allowed) {
      outcomes.push({ n, allowed: false, reason: check.reason });
      break;
    }
    existing = { sentAt: check.nextSentAt, lastSentAt: now };
    outcomes.push({ n, allowed: true });
  }
  return { outcomes, existing, t0 };
}

describe("chat rate limiter burst/hourly edge cases (qa)", () => {
  it("rejects the 11th message inside one minute (burst)", () => {
    const { outcomes } = simulateSend(MAX_MESSAGES_PER_MINUTE + 2, 3_500);
    expect(outcomes.slice(0, MAX_MESSAGES_PER_MINUTE).every((o) => o.allowed)).toBe(
      true,
    );
    const eleventh = outcomes[MAX_MESSAGES_PER_MINUTE];
    expect(eleventh).toMatchObject({
      n: MAX_MESSAGES_PER_MINUTE + 1,
      allowed: false,
      reason: "burst",
    });
  });

  it("rejects the 61st message inside one hour (hourly)", () => {
    // 59 s spacing keeps the 60 s burst window at <= 2 messages while 60
    // messages fit inside the 3600 s hourly window (span 3481 s).
    const { outcomes } = simulateSend(MAX_MESSAGES_PER_HOUR + 2, 59_000);
    expect(outcomes.slice(0, MAX_MESSAGES_PER_HOUR).every((o) => o.allowed)).toBe(
      true,
    );
    const sixtyFirst = outcomes[MAX_MESSAGES_PER_HOUR];
    expect(sixtyFirst).toMatchObject({
      n: MAX_MESSAGES_PER_HOUR + 1,
      allowed: false,
      reason: "hourly",
    });
  });

  it("rejects back-to-back messages inside the cooldown gap", () => {
    const { outcomes } = simulateSend(3, 1_000);
    expect(outcomes[0].allowed).toBe(true);
    expect(outcomes[1]).toMatchObject({ allowed: false, reason: "cooldown" });
  });

  it("allows sending again once the oldest message ages out of the hour", () => {
    const { existing, t0 } = simulateSend(MAX_MESSAGES_PER_HOUR + 2, 59_000);
    expect(existing).toBeDefined();
    // Jump past the hourly window of the oldest retained message.
    const check = evaluateChatRate(existing, t0 + HOUR_MS + 61 * 59_000);
    expect(check.allowed).toBe(true);
  });

  it("burst rejection carries a retry-after within the minute window", () => {
    const { outcomes, t0 } = simulateSend(MAX_MESSAGES_PER_MINUTE + 2, 3_500);
    const rejectedAt = t0 + MAX_MESSAGES_PER_MINUTE * 3_500;
    const check = evaluateChatRate(
      {
        sentAt: outcomes
          .filter((o) => o.allowed)
          .map((o) => t0 + (o.n - 1) * 3_500),
        lastSentAt: rejectedAt - 3_500,
      },
      rejectedAt,
    );
    expect(check.allowed).toBe(false);
    if (!check.allowed) {
      expect(check.reason).toBe("burst");
      expect(check.retryAfterMs).toBeGreaterThan(0);
      expect(check.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("constants match the documented policy", () => {
    expect(MAX_MESSAGES_PER_MINUTE).toBe(10);
    expect(MAX_MESSAGES_PER_HOUR).toBe(60);
    expect(MIN_GAP_MS).toBe(3_000);
    expect(HOUR_MS).toBe(3_600_000);
  });
});
