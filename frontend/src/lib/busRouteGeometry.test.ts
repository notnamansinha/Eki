import { describe, expect, it } from "vitest";
import { busEtaPath, sharedRerouteGeometry } from "./busRouteGeometry";
import type { ActiveBusEntry } from "./activeBusEntries";

describe("fleet reroute isolation", () => {
  const configured = [{ lat: 23, lng: 72 }, { lat: 24, lng: 72 }];
  const path = [{ lat: 23, lng: 72.1 }, { lat: 24, lng: 72.1 }];
  const geometries = new Map([["one", { polyline: "rerouted", path }]]);
  const dynamic: ActiveBusEntry = { busId: "one", direction: "forward", routeDirection: "forward", routeSource: "dynamic-reroute", routeVersion: 2 };
  it("shows one bus's reroute without using it for a configured peer's ETA", () => {
    const buses = new Map<string, ActiveBusEntry>([["one", dynamic], ["two", { ...dynamic, busId: "two", routeSource: "configured" }]]);
    expect(sharedRerouteGeometry(buses, geometries, "forward")).toBeNull();
    expect(busEtaPath("one", geometries, configured)).toBe(path);
    expect(busEtaPath("two", geometries, configured)).toBe(configured);
  });
  it("uses the shared reroute when every displayed bus has it", () => {
    expect(sharedRerouteGeometry(new Map([["one", dynamic]]), geometries, "forward")?.polyline).toBe("rerouted");
    expect(sharedRerouteGeometry(new Map([["one", dynamic]]), geometries, "reverse")).toBeNull();
  });
});
