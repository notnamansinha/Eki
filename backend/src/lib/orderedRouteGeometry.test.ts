import { describe, expect, it, vi } from "vitest";
import { computeOrderedRouteGeometry } from "./orderedRouteGeometry";
import { decodePolyline, encodePolyline, type LatLng } from "./polylineUtils";

describe("long ordered route geometry", () => {
  it.each([27, 28, 53, 100, 101])("preserves all %i points across request boundaries", async (count) => {
    const points = Array.from({ length: count }, (_, i) => ({ lat: 23 + i / 1000, lng: 72 }));
    const compute = vi.fn(async (chunk: LatLng[]) => ({
      polyline: encodePolyline(chunk), distanceMeters: (chunk.length - 1) * 100,
      duration: `${(chunk.length - 1) * 10}s`,
    }));
    const geometry = await computeOrderedRouteGeometry(points, compute);
    expect(decodePolyline(geometry.polyline)).toEqual(points.map(p => ({ ...p, lat: Math.round(p.lat * 1e5) / 1e5 })));
    expect(geometry.distanceMeters).toBe((count - 1) * 100);
    expect(geometry.duration).toBe(`${(count - 1) * 10}s`);
    expect(compute.mock.calls.every(([chunk]) => chunk.length <= 27)).toBe(true);
    const reverse = await computeOrderedRouteGeometry([...points].reverse(), compute);
    expect(decodePolyline(reverse.polyline)).toEqual([...decodePolyline(geometry.polyline)].reverse());
  });

  it("does not publish partial geometry when a chunk fails", async () => {
    const points = Array.from({ length: 30 }, (_, lat) => ({ lat, lng: 72 }));
    await expect(computeOrderedRouteGeometry(points, async chunk => {
      if (chunk[0].lat > 0) throw new Error("upstream timeout");
      return { polyline: encodePolyline(chunk), distanceMeters: 100, duration: "10s" };
    })).rejects.toThrow("upstream timeout");
  });
});
