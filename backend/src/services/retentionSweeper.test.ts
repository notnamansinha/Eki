import { describe, expect, it } from "vitest";
import { isRetentionSweeperEnabled } from "./retentionSweeper";

describe("retention sweeper safety", () => {
  it("requires an explicit true value before destructive cleanup is enabled", () => {
    expect(isRetentionSweeperEnabled(undefined)).toBe(false);
    expect(isRetentionSweeperEnabled("")).toBe(false);
    expect(isRetentionSweeperEnabled("false")).toBe(false);
    expect(isRetentionSweeperEnabled("tru")).toBe(false);
    expect(isRetentionSweeperEnabled(" TRUE ")).toBe(true);
  });
});
