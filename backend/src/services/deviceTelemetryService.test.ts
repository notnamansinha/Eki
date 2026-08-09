import { describe, expect, it } from "vitest";
import { freshestDelayMinutes } from "./deviceTelemetryService";

describe("freshestDelayMinutes", () => {
  it("prefers the live value when the durable copy is stale", () => {
    const result = freshestDelayMinutes(
      { delayMinutes: 15, delayUpdatedAt: 2000 },
      { delayMinutes: 10, delayUpdatedAt: 1000 },
    );
    expect(result.delayMinutes).toBe(15);
    expect(result.delayUpdatedAt).toBe(2000);
  });

  it("prefers the durable value when it is newer (reverse partial failure)", () => {
    const result = freshestDelayMinutes(
      { delayMinutes: 10, delayUpdatedAt: 1000 },
      { delayMinutes: 15, delayUpdatedAt: 2000 },
    );
    expect(result.delayMinutes).toBe(15);
    expect(result.delayUpdatedAt).toBe(2000);
  });

  it("keeps the live value on a timestamp tie", () => {
    const result = freshestDelayMinutes(
      { delayMinutes: 12, delayUpdatedAt: 1500 },
      { delayMinutes: 9, delayUpdatedAt: 1500 },
    );
    expect(result.delayMinutes).toBe(12);
  });

  it("fills a missing live value from the durable copy", () => {
    const result = freshestDelayMinutes(
      { delayMinutes: undefined as unknown as number },
      { delayMinutes: 20, delayUpdatedAt: 3000 },
    );
    expect(result.delayMinutes).toBe(20);
  });

  it("keeps the live value when the durable copy is absent", () => {
    const result = freshestDelayMinutes(
      { delayMinutes: 7, delayUpdatedAt: 900 },
      null,
    );
    expect(result.delayMinutes).toBe(7);
  });

  it("falls back to zero when neither store has a delay", () => {
    expect(freshestDelayMinutes(null, null).delayMinutes).toBe(0);
    expect(freshestDelayMinutes({}, {}).delayMinutes).toBe(0);
  });

  it("never lets a legacy untimestamped durable value override a live one", () => {
    // Legacy durable rows have delayUpdatedAt 0; the live value wins.
    const result = freshestDelayMinutes(
      { delayMinutes: 11, delayUpdatedAt: 0 },
      { delayMinutes: 13, delayUpdatedAt: 0 },
    );
    expect(result.delayMinutes).toBe(11);
  });
});
