import { describe, expect, it } from "vitest";
import { routeDisplayPath } from "./routeDisplayPath";

const stops = [
  { lat: 38.5, lng: -120.2 },
  { lat: 43.252, lng: -126.453 },
];

describe("route display path", () => {
  it("decodes valid Routes API road geometry", () => {
    expect(routeDisplayPath("_p~iF~ps|U_ulLnnqC_mqNvxq`@", stops, true)).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it("does not draw displacement lines on live maps", () => {
    expect(routeDisplayPath(undefined, stops, true)).toEqual([]);
    expect(routeDisplayPath("invalid", stops, true)).toEqual([]);
  });

  it("keeps straight segments available for unsaved route drafts", () => {
    expect(routeDisplayPath(undefined, stops, false)).toEqual(stops);
  });
});
