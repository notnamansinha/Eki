import { describe, expect, it } from "vitest";
import {
  SIGNAL_LOST_MS,
  isLiveBusSignalLost,
  isLiveBusTimestamp,
} from "./liveBusFreshness";

describe("live bus freshness", () => {
  const now = 1_800_000_000_000;

  it("uses the shared signal-loss threshold", () => {
    expect(isLiveBusSignalLost(now - SIGNAL_LOST_MS, now)).toBe(false);
    expect(isLiveBusSignalLost(now - SIGNAL_LOST_MS - 1, now)).toBe(true);
  });

  it("treats missing, invalid, and excessive future timestamps as lost", () => {
    expect(isLiveBusSignalLost(undefined, now)).toBe(true);
    expect(isLiveBusSignalLost(Number.NaN, now)).toBe(true);
    expect(isLiveBusSignalLost(now + 10_001, now)).toBe(true);
  });

  it("keeps the allowed clock-skew window live", () => {
    expect(isLiveBusTimestamp(now + 10_000, now)).toBe(true);
    expect(isLiveBusSignalLost(now + 10_000, now)).toBe(false);
  });
});
