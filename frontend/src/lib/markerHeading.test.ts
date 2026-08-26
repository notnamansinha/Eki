import { describe, expect, it } from "vitest";
import { normalizeHeading, unwrapHeading } from "./markerHeading";

describe("marker heading", () => {
  it("normalizes invalid and wrapped values", () => {
    expect(normalizeHeading(undefined)).toBe(0);
    expect(normalizeHeading(Number.NaN)).toBe(0);
    expect(normalizeHeading(-10)).toBe(350);
    expect(normalizeHeading(370)).toBe(10);
  });

  it("crosses north using the shortest visual rotation", () => {
    expect(unwrapHeading(1, 359)).toBe(361);
    expect(unwrapHeading(359, 1)).toBe(-1);
  });

  it("preserves accumulated rotations while following new readings", () => {
    expect(unwrapHeading(20, 370)).toBe(380);
  });
});
