import { describe, expect, it } from "vitest";
import {
  selectCurrentRouteGeometries,
  type VersionedRouteGeometry,
} from "./useDynamicRouteGeometries";
import type { ActiveBusEntry } from "../lib/activeBusEntries";
import type { ActiveRouteGeometry } from "../lib/activeRouteGeometry";

const g1: ActiveRouteGeometry = {
  polyline: "p1",
  path: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
};
const g2: ActiveRouteGeometry = {
  polyline: "p2",
  path: [{ lat: 0, lng: 0 }, { lat: 2, lng: 2 }],
};

function dynamicBus(
  routeVersion: number,
  routeSource: ActiveBusEntry["routeSource"] = "dynamic-reroute",
): ActiveBusEntry {
  return {
    busId: "b1",
    routeId: "route_1",
    routeSource,
    routeVersion,
  };
}

describe("selectCurrentRouteGeometries", () => {
  it("does not expose obsolete v1 geometry while a bus is at v2", () => {
    const buses = new Map<string, ActiveBusEntry>([
      ["b1", dynamicBus(2)],
    ]);
    const versioned = new Map<string, VersionedRouteGeometry>([
      ["b1", { version: 1, geometry: g1 }], // stale — bus is now on v2
      ["b2", { version: 2, geometry: g2 }], // another bus entirely
    ]);
    const selected = selectCurrentRouteGeometries(buses, versioned);
    // b1's v1 geometry must NOT be used for its v2 ride.
    expect(selected.has("b1")).toBe(false);
  });

  it("exposes geometry once its version matches the bus's current version", () => {
    const buses = new Map<string, ActiveBusEntry>([
      ["b1", dynamicBus(2)],
    ]);
    const versioned = new Map<string, VersionedRouteGeometry>([
      ["b1", { version: 2, geometry: g2 }],
    ]);
    const selected = selectCurrentRouteGeometries(buses, versioned);
    expect(selected.get("b1")).toBe(g2);
  });

  it("never exposes geometry for a bus that is no longer on a dynamic reroute", () => {
    const buses = new Map<string, ActiveBusEntry>([
      ["b1", dynamicBus(2, "configured")],
    ]);
    const versioned = new Map<string, VersionedRouteGeometry>([
      ["b1", { version: 2, geometry: g2 }],
    ]);
    const selected = selectCurrentRouteGeometries(buses, versioned);
    expect(selected.has("b1")).toBe(false);
  });
});