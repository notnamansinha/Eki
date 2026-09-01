import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const validPolyline = encodePolyline([
  { lat: 23, lng: 72 },
  { lat: 23.01, lng: 72.01 },
]);

const harness = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  paths: [] as string[],
  rejectPaths: new Set<string>(),
}));

vi.mock("firebase/database", () => ({
  ref: vi.fn((_db: unknown, path: string) => {
    harness.paths.push(path);
    return { path };
  }),
  get: vi.fn(async (refObj: { path: string }) => {
    if (harness.rejectPaths.has(refObj.path)) {
      // Reject once so a recovered read can succeed on a later call.
      harness.rejectPaths.delete(refObj.path);
      throw new Error("network down");
    }
    return { val: () => harness.data.get(refObj.path) ?? null };
  }),
}));

vi.mock("./firebaseDatabase", () => ({
  rtdb: {},
}));

import {
  activeBusNodeKey,
  cachedActiveRouteGeometry,
  fetchActiveRouteGeometry,
  __resetActiveRouteGeometryForTests,
} from "./activeRouteGeometry";

beforeEach(() => {
  __resetActiveRouteGeometryForTests();
  harness.data.clear();
  harness.paths = [];
  harness.rejectPaths.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("activeRouteGeometry", () => {
  it("builds the live-node key for an active bus", () => {
    expect(activeBusNodeKey("bus_01", "route_1")).toBe("bus_01_route_1");
  });

  it("fetches and decodes reroute geometry once per version", async () => {
    const path = `activeRouteGeometry/bus_01_route_1/3`;
    harness.data.set(path, { polyline: validPolyline });

    const geometry = await fetchActiveRouteGeometry("bus_01_route_1", 3);
    expect(geometry?.polyline).toBe(validPolyline);
    expect(geometry?.path).toHaveLength(2);
    // The resolved geometry is cached synchronously and the fetch is not
    // repeated for the same version.
    expect(cachedActiveRouteGeometry("bus_01_route_1", 3)).toEqual(geometry);
    await fetchActiveRouteGeometry("bus_01_route_1", 3);
    expect(harness.paths.filter((p) => p === path)).toHaveLength(1);
  });

  it("returns null (and caches it) when a version's sibling node is missing", async () => {
    expect(await fetchActiveRouteGeometry("bus_01_route_1", 9)).toBeNull();
    expect(cachedActiveRouteGeometry("bus_01_route_1", 9)).toBeNull();
  });

  it("does not cache a rejected read, so the version can recover after reconnection", async () => {
    const path = `activeRouteGeometry/bus_01_route_1/4`;
    harness.data.set(path, { polyline: validPolyline });
    harness.rejectPaths.add(path);

    // First attempt fails at the network layer: nothing is cached.
    expect(await fetchActiveRouteGeometry("bus_01_route_1", 4)).toBeNull();
    expect(cachedActiveRouteGeometry("bus_01_route_1", 4)).toBeUndefined();

    // Connectivity recovers (the one-shot rejection is consumed) → the same
    // version can be fetched and is now cached.
    const geometry = await fetchActiveRouteGeometry("bus_01_route_1", 4);
    expect(geometry?.polyline).toBe(validPolyline);
    expect(cachedActiveRouteGeometry("bus_01_route_1", 4)).toEqual(geometry);
  });
});