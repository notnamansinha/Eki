import { describe, expect, it } from "vitest";
import { geometryIsUnchanged, routeGeometrySignature } from "./routeGeometry";

const A = { id: "a", lat: 23, lng: 72 };
const Z = { id: "z", lat: 23.01, lng: 72.01 };

describe("routeGeometrySignature (#149 p8)", () => {
  it("signature ignores metadata (name) and only depends on id + coordinates + order", () => {
    const stopA = { ...A, name: "Alpha" } as const;
    const stopZ = { ...Z, name: "Zulu" } as const;
    expect(routeGeometrySignature([stopA, stopZ])).toBe(routeGeometrySignature([A, Z]));
  });

  it("detects reorder, add/remove, and coordinate change", () => {
    expect(geometryIsUnchanged([A, Z], [A, Z])).toBe(true);
    expect(geometryIsUnchanged([Z, A], [A, Z])).toBe(false); // reorder / swap
    expect(geometryIsUnchanged([A], [A, Z])).toBe(false);    // remove
    expect(geometryIsUnchanged([A, Z, { id: "m", lat: 23.02, lng: 72.02 }], [A, Z])).toBe(false); // add
    expect(geometryIsUnchanged([{ id: "a", lat: 23.0001, lng: 72 }, Z], [A, Z])).toBe(false);    // move
    expect(geometryIsUnchanged(undefined, [A, Z])).toBe(false);
  });

  it("is robust to small float noise at quantization", () => {
    expect(geometryIsUnchanged(
      [{ id: "a", lat: 23.0000001, lng: 72.0000001 }, Z],
      [A, Z],
    )).toBe(true);
  });
});
