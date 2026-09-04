import { describe, expect, it } from "vitest";
import { liveBusMarkerPosition } from "./liveBusMarkerPosition";

describe("live bus marker position", () => {
  it("preserves the exact RTDB coordinates", () => {
    expect(liveBusMarkerPosition(23.012441, 72.458011)).toEqual({
      point: { lat: 23.012441, lng: 72.458011 },
      segmentIndex: null,
      snapped: false,
    });
  });

  it("uses each new telemetry fix without retaining the previous position", () => {
    const first = liveBusMarkerPosition(23.012441, 72.458011);
    const next = liveBusMarkerPosition(23.012991, 72.458731);

    expect(next?.point).toEqual({ lat: 23.012991, lng: 72.458731 });
    expect(next).not.toEqual(first);
  });

  it("snaps a good-quality fix to the directed road path", () => {
    const result = liveBusMarkerPosition(23.0001, 72.5, {
      path: [{ lat: 23, lng: 72.49 }, { lat: 23, lng: 72.51 }],
      heading: 90,
      hdop: 1.2,
    });
    expect(result?.snapped).toBe(true);
    expect(result?.point.lat).toBeCloseTo(23, 5);
  });

  it("keeps raw coordinates when GNSS quality is poor", () => {
    const result = liveBusMarkerPosition(23.0001, 72.5, {
      path: [{ lat: 23, lng: 72.49 }, { lat: 23, lng: 72.51 }],
      hdop: 8,
    });
    expect(result?.snapped).toBe(false);
    expect(result?.point.lat).toBe(23.0001);
  });

  it.each([
    [undefined, 72.5],
    [23, undefined],
    [91, 72.5],
    [23, 181],
  ])("rejects an invalid position (%p, %p)", (lat, lng) => {
    expect(liveBusMarkerPosition(lat, lng)).toBeNull();
  });
});
