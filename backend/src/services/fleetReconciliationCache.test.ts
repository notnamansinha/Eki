import { describe, expect, it, vi } from "vitest";
import { FleetReconciliationCache } from "./fleetReconciliationCache";

describe("fleet reconciliation cache", () => {
  it("loads a shared bus assignment once for concurrent drivers", async () => {
    const loader = vi.fn(async () => ["route_1", "route_2"]);
    const cache = new FleetReconciliationCache({}, loader);

    const [first, second] = await Promise.all([
      cache.routesForBus("bus_1"),
      cache.routesForBus("bus_1"),
    ]);

    expect(first).toEqual(["route_1", "route_2"]);
    expect(second).toEqual(first);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("serves and updates mirrors from the one root snapshot", () => {
    const cache = new FleetReconciliationCache(
      { driver_1: { bus_1: { route_1: true } } },
      async () => [],
    );
    expect(cache.mirrorFor("driver_1")).toEqual({ bus_1: { route_1: true } });
    expect(cache.mirrorFor("missing")).toBeNull();
    cache.setMirror("driver_1", null);
    expect(cache.mirrorFor("driver_1")).toBeNull();
  });
});
