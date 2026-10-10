import { describe, expect, it } from "vitest";
import { haversineMeters } from "./geo";

describe("haversineMeters", () => {
  it("rejects malformed coordinates without returning NaN", () => {
    const origin = { lat: 23, lng: 72 };
    for (const bad of [
      { lat: Number.NaN, lng: 72 },
      { lat: 91, lng: 72 },
      { lat: 23, lng: Number.POSITIVE_INFINITY },
      { lat: 23, lng: 181 },
    ]) expect(haversineMeters(origin, bad)).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps valid distances finite, including antipodal coordinates", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }))
      .toBeCloseTo(Math.PI * 6_371_000, 4);
  });
});
