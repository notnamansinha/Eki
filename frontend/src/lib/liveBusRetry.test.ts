import { describe, expect, it } from "vitest";
import { liveBusRetryDelayMs } from "./liveBusRetry";

describe("liveBusRetryDelayMs", () => {
  it("backs off from one second and caps at thirty seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(liveBusRetryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });
});
