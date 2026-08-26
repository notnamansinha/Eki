import { describe, expect, it } from "vitest";
import {
  evaluateChatRate,
  censorText,
  MAX_MESSAGES_PER_HOUR,
  MAX_MESSAGES_PER_MINUTE,
  MIN_GAP_MS,
  HOUR_MS,
  MINUTE_MS,
  moderateChatText,
  normalizeChatText,
} from "./chatRateLimit";

describe("evaluateChatRate", () => {
  const now = 1_000_000;

  it("allows a first message with no stored window", () => {
    expect(evaluateChatRate(undefined, now)).toEqual({
      allowed: true,
      nextSentAt: [],
    });
  });

  it("enforces the three-second cooldown between messages", () => {
    const existing = { sentAt: [now - 10_000], lastSentAt: now - 1_000 };
    expect(evaluateChatRate(existing, now)).toEqual({
      allowed: false,
      reason: "cooldown",
      retryAfterMs: MIN_GAP_MS - 1_000,
    });
  });

  it("appends to the rolling window when under the hourly cap", () => {
    const existing = { sentAt: [now - 20_000], lastSentAt: now - 10_000 };
    expect(evaluateChatRate(existing, now)).toEqual({
      allowed: true,
      nextSentAt: [now - 20_000, now - 10_000],
    });
  });

  it("rejects when the hourly window is full and has not rolled over", () => {
    const sentAt = Array.from({ length: MAX_MESSAGES_PER_HOUR - 1 }, (_, i) => now - 100_000 - i * 10_000);
    const existing = { sentAt, lastSentAt: now - 5_000 };
    const result = evaluateChatRate(existing, now);
    expect(result).toEqual({
      allowed: false,
      reason: "hourly",
      retryAfterMs: expect.any(Number),
    });
  });

  it("does not reset an exactly-full persisted window", () => {
    const sentAt = Array.from(
      { length: MAX_MESSAGES_PER_HOUR },
      (_, i) => now - 120_000 + i * 1_000,
    );
    expect(evaluateChatRate({ sentAt, lastSentAt: now - 5_000 }, now)).toEqual({
      allowed: false,
      reason: "hourly",
      retryAfterMs: expect.any(Number),
    });
  });

  it("preserves and enforces a window whose separate last timestamp is missing", () => {
    const sentAt = [now - 20_000, now - 1_000];
    expect(evaluateChatRate({ sentAt }, now)).toEqual({
      allowed: false,
      reason: "cooldown",
      retryAfterMs: MIN_GAP_MS - 1_000,
    });
  });

  it("sorts persisted timestamps before applying the rolling window", () => {
    const sentAt = [now - 1_000, now - 20_000];
    expect(evaluateChatRate({ sentAt }, now)).toEqual({
      allowed: false,
      reason: "cooldown",
      retryAfterMs: MIN_GAP_MS - 1_000,
    });
  });

  it("drops the oldest entry once the window rolls past an hour", () => {
    const sentAt = Array.from({ length: MAX_MESSAGES_PER_HOUR - 1 }, (_, i) => now - HOUR_MS - 60_000 - i * 10_000);
    const existing = { sentAt, lastSentAt: now - 5_000 };
    const result = evaluateChatRate(existing, now);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.nextSentAt).toEqual([now - 5_000]);
    }
  });

  it("enforces a short rolling burst cap in addition to the hourly limit", () => {
    const existing = {
      sentAt: Array.from(
        { length: MAX_MESSAGES_PER_MINUTE - 1 },
        (_, index) => now - MINUTE_MS + 5_000 + index * 4_000,
      ),
      lastSentAt: now - 4_000,
    };

    expect(evaluateChatRate(existing, now)).toEqual({
      allowed: false,
      reason: "burst",
      retryAfterMs: expect.any(Number),
    });
  });

  it("migrates a legacy windowStartedAt/count doc inline", () => {
    const existing = { windowStartedAt: now - 10 * 60_000, lastSentAt: now - 60_000, count: 5 };
    const result = evaluateChatRate(existing, now);
    expect(result).toEqual({
      allowed: true,
      nextSentAt: [now - 10 * 60_000, now - 10 * 60_000, now - 10 * 60_000, now - 10 * 60_000, now - 60_000],
    });
  });

  it("ignores a legacy doc whose window already expired", () => {
    const existing = { windowStartedAt: now - 2 * HOUR_MS, lastSentAt: now - 90 * 60_000, count: 60 };
    const result = evaluateChatRate(existing, now);
    expect(result).toEqual({ allowed: true, nextSentAt: [] });
  });
});

describe("censorText", () => {
  it("censors English and Hindi/Hinglish profanities", () => {
    expect(censorText("this is shit and bc")).toBe("this is *** and ***");
  });

  it("leaves clean text untouched", () => {
    expect(censorText("Great ride, driver was kind")).toBe("Great ride, driver was kind");
  });

  it("censors separator, repeated-letter, leetspeak, and Unicode evasions", () => {
    expect(censorText("f.u.c.k sh1t fuuuck चूतिया")).toBe("*** *** *** ***");
    expect(censorText("Class assignment")).toBe("Class assignment");
  });
});

describe("moderateChatText", () => {
  it("normalizes formatting controls and reports server-side censorship", () => {
    expect(normalizeChatText("  hello\u202E\u200B   rider  ")).toBe("hello rider");
    expect(moderateChatText("  sh1t\u200B message ")).toEqual({
      text: "*** message",
      normalized: "sh1t message",
      censored: true,
    });
  });

  it("rejects empty and over-limit normalized content", () => {
    expect(moderateChatText("\u200B\u202E")).toBeNull();
    expect(moderateChatText("a".repeat(501))).toBeNull();
  });
});
