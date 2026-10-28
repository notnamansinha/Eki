import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SERVER_TIME_OFFSET_MS,
  serverNow,
  serverTimeOffsetMs,
  setServerTimeOffset,
} from "./serverClock";

afterEach(() => { setServerTimeOffset(0); vi.useRealTimers(); });

describe("server clock", () => {
  it("is the device clock until an offset arrives, then corrects it", () => {
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
    expect(serverNow()).toBe(1_800_000_000_000);
    expect(setServerTimeOffset(15_000)).toBe(true);
    expect(serverNow()).toBe(1_800_000_015_000);
    expect(setServerTimeOffset(-360_000)).toBe(true);
    expect(serverNow()).toBe(1_799_999_640_000);
  });

  it.each([null, "15000", Number.NaN, Number.POSITIVE_INFINITY, MAX_SERVER_TIME_OFFSET_MS + 1, -MAX_SERVER_TIME_OFFSET_MS - 1])(
    "keeps the last good offset when given %s", (value) => {
      setServerTimeOffset(2_500);
      expect(setServerTimeOffset(value)).toBe(false);
      expect(serverTimeOffsetMs()).toBe(2_500);
    });
});
