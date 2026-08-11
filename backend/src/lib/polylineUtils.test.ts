import { describe, expect, it } from "vitest";
import { decodePolyline } from "./polylineUtils";

function encodeCoordinate(value: number): string {
  let encoded = value < 0 ? ~(value << 1) : value << 1;
  let result = "";

  while (encoded >= 0x20) {
    result += String.fromCharCode((0x20 | (encoded & 0x1f)) + 63);
    encoded >>= 5;
  }
  return result + String.fromCharCode(encoded + 63);
}

describe("decodePolyline", () => {
  it("decodes the documented Google polyline example", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it("returns no points for an empty polyline", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("rejects malformed, truncated, and overlong coordinates", () => {
    expect(() => decodePolyline("<")).toThrow("Invalid encoded polyline");
    expect(() => decodePolyline("_p~iF")).toThrow("Truncated encoded polyline");
    expect(() => decodePolyline("~~~~~~~~")).toThrow("Invalid encoded polyline");
  });

  it("rejects points outside valid latitude and longitude ranges", () => {
    const outOfRangeLatitude = `${encodeCoordinate(9_100_000)}${encodeCoordinate(0)}`;

    expect(() => decodePolyline(outOfRangeLatitude)).toThrow(
      "Encoded polyline contains invalid coordinates",
    );
  });
});
