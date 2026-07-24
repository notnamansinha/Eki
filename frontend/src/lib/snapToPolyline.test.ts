import { describe, expect, it } from "vitest";
import { decodePolyline } from "./polyline";
import { snapToPolyline } from "./snapToPolyline";

describe("decodePolyline", () => {
  it("decodes the documented Google polyline example", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it("rejects truncated geometry", () => {
    expect(() => decodePolyline("_p~iF")).toThrow();
  });
});

describe("snapToPolyline", () => {
  it("projects onto horizontal, vertical, and diagonal segments", () => {
    const horizontal = snapToPolyline(
      { lat: 23.0001, lng: 72.0005 },
      [{ lat: 23, lng: 72 }, { lat: 23, lng: 72.001 }],
    );
    const vertical = snapToPolyline(
      { lat: 23.0005, lng: 72.0001 },
      [{ lat: 23, lng: 72 }, { lat: 23.001, lng: 72 }],
    );
    const diagonal = snapToPolyline(
      { lat: 23.0005, lng: 72.0006 },
      [{ lat: 23, lng: 72 }, { lat: 23.001, lng: 72.001 }],
    );

    expect(horizontal.point.lat).toBeCloseTo(23, 6);
    expect(vertical.point.lng).toBeCloseTo(72, 6);
    expect(diagonal.snapped).toBe(true);
  });

  it("computes metre distance at Ahmedabad latitude", () => {
    const result = snapToPolyline(
      { lat: 23.0001, lng: 72.0005 },
      [{ lat: 23, lng: 72 }, { lat: 23, lng: 72.001 }],
    );

    expect(result.distanceM).toBeGreaterThan(10);
    expect(result.distanceM).toBeLessThan(12.5);
  });

  it("clamps projection to a segment endpoint", () => {
    const result = snapToPolyline(
      { lat: 23, lng: 72.002 },
      [{ lat: 23, lng: 72 }, { lat: 23, lng: 72.001 }],
      { maxDistanceM: 200 },
    );

    expect(result.segmentFraction).toBe(1);
    expect(result.point.lng).toBeCloseTo(72.001, 6);
  });

  it("keeps a raw point beyond the off-route threshold", () => {
    const raw = { lat: 23.001, lng: 72.0005 };
    const result = snapToPolyline(
      raw,
      [{ lat: 23, lng: 72 }, { lat: 23, lng: 72.001 }],
    );

    expect(result.snapped).toBe(false);
    expect(result.point).toBe(raw);
  });

  it("uses continuity to avoid jumping at crossing segments", () => {
    const path = [
      { lat: 23, lng: 72 },
      { lat: 23.001, lng: 72.001 },
      { lat: 23.002, lng: 72.002 },
      { lat: 23.002, lng: 72 },
      { lat: 23.001, lng: 72.001 },
      { lat: 23, lng: 72.002 },
    ];
    const result = snapToPolyline(
      { lat: 23.001, lng: 72.001 },
      path,
      { preferredSegmentIndex: 3, maxSegmentJump: 1, headingDegrees: 225 },
    );

    expect(result.segmentIndex).toBeGreaterThanOrEqual(3);
  });
});
