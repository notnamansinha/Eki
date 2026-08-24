import { describe, expect, it } from "vitest";
import { liveBusMarkerPosition } from "./liveBusMarkerPosition";

describe("live bus marker position", () => {
  it("preserves the exact RTDB coordinates", () => {
    expect(liveBusMarkerPosition(23.012441, 72.458011)).toEqual({
      lat: 23.012441,
      lng: 72.458011,
    });
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
