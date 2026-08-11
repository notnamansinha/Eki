import { describe, expect, it } from "vitest";
import { liveBusRetryDelayMs } from "./liveBusRetry";

describe("liveBusRetryDelayMs", () => {
  it("backs off from one second and caps at thirty seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(liveBusRetryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });

  it("normalizes invalid attempts to a safe first retry", () => {
    expect(liveBusRetryDelayMs(-1)).toBe(1_000);
    expect(liveBusRetryDelayMs(1.9)).toBe(2_000);
    expect(liveBusRetryDelayMs(Number.NaN)).toBe(1_000);
    expect(liveBusRetryDelayMs(Number.POSITIVE_INFINITY)).toBe(1_000);
  });
});
