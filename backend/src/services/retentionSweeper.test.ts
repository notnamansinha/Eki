import { describe, expect, it } from "vitest";
import { isRetentionSweeperEnabled } from "./retentionSweeper";

describe("retention sweeper safety", () => {
  it("keeps development and tests non-destructive unless explicitly enabled", () => {
    expect(isRetentionSweeperEnabled(undefined, "test")).toBe(false);
    expect(isRetentionSweeperEnabled("", "development")).toBe(false);
    expect(isRetentionSweeperEnabled("false", "test")).toBe(false);
    expect(isRetentionSweeperEnabled("tru", "development")).toBe(false);
    expect(isRetentionSweeperEnabled(" TRUE ", "test")).toBe(true);
  });

  it("refuses to start production without enforced retention", () => {
    expect(() => isRetentionSweeperEnabled(undefined, "production")).toThrow(
      "RETENTION_SWEEPER_ENABLED=true is required in production",
    );
    expect(() => isRetentionSweeperEnabled("false", "production")).toThrow(
      "RETENTION_SWEEPER_ENABLED=true is required in production",
    );
    expect(isRetentionSweeperEnabled("true", "production")).toBe(true);
  });
});
