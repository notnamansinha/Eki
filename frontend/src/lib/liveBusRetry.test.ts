import { describe, expect, it } from "vitest";
import { liveBusRetryDelayMs } from "./liveBusRetry";

describe("liveBusRetryDelayMs", () => {
  it("backs off from one second and caps at thirty seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(attempt => liveBusRetryDelayMs(attempt, () => 1))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });

  it("normalizes invalid attempts to a safe first retry", () => {
    expect(liveBusRetryDelayMs(-1, () => 1)).toBe(1_000);
    expect(liveBusRetryDelayMs(1.9, () => 1)).toBe(2_000);
    expect(liveBusRetryDelayMs(Number.NaN, () => 1)).toBe(1_000);
    expect(liveBusRetryDelayMs(Number.POSITIVE_INFINITY, () => 1)).toBe(1_000);
  });
  it("spreads independent clients without a zero-delay retry or exceeding the cap", () => {
    const delays = Array.from({ length: 1000 }, (_, client) => liveBusRetryDelayMs(5, () => client / 999));
    expect(Math.min(...delays)).toBe(15_000); expect(Math.max(...delays)).toBe(30_000);
    expect(new Set(delays).size).toBe(1000);
    expect(liveBusRetryDelayMs(0, () => 0)).toBe(500);
    expect(liveBusRetryDelayMs(0, () => Number.NaN)).toBe(750);
    expect(liveBusRetryDelayMs(0, () => -1)).toBe(500);
    expect(liveBusRetryDelayMs(0, () => 2)).toBe(1000);
  });
});
