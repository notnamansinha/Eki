import { describe, expect, it } from "vitest";
import { decodeRoutePathForDisplay } from "./mapRouteGeometry";

function encodeNum(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

function encodePolyline(points: { lat: number; lng: number }[]): string {
  let out = "";
  let plat = 0;
  let plng = 0;
  for (const point of points) {
    const dlat = Math.round(point.lat * 1e5) - plat;
    const dlng = Math.round(point.lng * 1e5) - plng;
    plat = Math.round(point.lat * 1e5);
    plng = Math.round(point.lng * 1e5);
    out += encodeNum(dlat) + encodeNum(dlng);
  }
  return out;
}

const A = { id: "a", name: "Alpha", shortName: "A", lat: 23, lng: 72 };
const Z = { id: "z", name: "Zulu", shortName: "Z", lat: 23.01, lng: 72.01 };
const forwardStr = encodePolyline([A, Z]); // A→Z
const reverseStr = encodePolyline([Z, A]); // Z→A

const ordered = (path: { lat: number; lng: number }[]) =>
  path.map((point) => point.lat.toFixed(4) + "," + point.lng.toFixed(4));

describe("decodeRoutePathForDisplay", () => {
  it("keeps forward geometry in travel order", () => {
    const path = decodeRoutePathForDisplay(
      {
        polyline: forwardStr,
        rideDirection: "forward",
        reversePolyline: undefined,
        stops: [A, Z],
      },
      null,
    );
    expect(ordered(path)).toEqual(["23.0000,72.0000", "23.0100,72.0100"]);
  });

  it("does NOT reverse an already direction-specific reversePolyline", () => {
    // For a reverse ride, stops and reversePolyline already run Z→A. Reversing
    // again would put positionAlongPolyline and ETA out of order with stops.
    const path = decodeRoutePathForDisplay(
      {
        polyline: reverseStr,
        rideDirection: "reverse",
        reversePolyline: reverseStr,
        stops: [Z, A],
      },
      null,
    );
    expect(ordered(path)).toEqual(["23.0100,72.0100", "23.0000,72.0000"]);
  });

  it("reverses only legacy forward-only geometry for a reverse ride", () => {
    const path = decodeRoutePathForDisplay(
      {
        polyline: forwardStr,
        rideDirection: "reverse",
        reversePolyline: undefined,
        stops: [Z, A],
      },
      null,
    );
    expect(ordered(path)).toEqual(["23.0100,72.0100", "23.0000,72.0000"]);
  });

  it("accepts active reroute geometry as travel-ordered", () => {
    const path = decodeRoutePathForDisplay(
      {
        polyline: forwardStr,
        rideDirection: "reverse",
        reversePolyline: reverseStr,
        stops: [Z, A],
      },
      { polyline: forwardStr, version: 7 },
    );
    expect(ordered(path)).toEqual(["23.0000,72.0000", "23.0100,72.0100"]);
  });

  it("falls back to stops when no geometry decodes", () => {
    const path = decodeRoutePathForDisplay(
      {
        polyline: "",
        rideDirection: "reverse",
        reversePolyline: undefined,
        stops: [Z, A],
      },
      null,
    );
    expect(ordered(path)).toEqual(["23.0100,72.0100", "23.0000,72.0000"]);
  });
});