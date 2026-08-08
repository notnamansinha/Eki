import { describe, expect, it } from "vitest";
import {
  drainDynamicPromises,
  normalizeIdentifier,
  normalizeLiveBusData,
} from "./tripStateLifecycle";

describe("trip-state lifecycle helpers", () => {
  it("normalizes payload IDs without guessing from ambiguous node keys", () => {
    expect(normalizeIdentifier("  bus_1  ")).toBe("bus_1");
    expect(normalizeIdentifier("   ")).toBeNull();
    expect(normalizeIdentifier("../bus_1")).toBeNull();
    expect(normalizeLiveBusData({ busId: " bus_1 ", routeId: " route_2 ", speed: 32 }))
      .toEqual({ busId: "bus_1", routeId: "route_2", speed: 32 });
    expect(normalizeLiveBusData({ busId: "bus_1" }, "bus_1_route_2"))
      .toEqual({ busId: "bus_1", routeId: "route_2" });
    expect(normalizeLiveBusData({ routeId: "route_2" }, "bus_1_route_2"))
      .toEqual({ busId: "bus_1", routeId: "route_2" });
    expect(normalizeLiveBusData({}, "bus_1_route_2")).toBeNull();
    expect(normalizeLiveBusData({ busId: "other" }, "bus_1_route_2")).toBeNull();
  });

  it("drains work enqueued by a task that resumes during shutdown", async () => {
    const queues = new Map<string, Promise<void>>();
    let releaseFirst!: () => void;
    let secondFinished = false;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }).then(async () => {
      const second = Promise.resolve().then(() => {
        secondFinished = true;
      });
      queues.set("second", second);
      await second;
      queues.delete("second");
    });
    queues.set("first", first);
    void first.finally(() => {
      if (queues.get("first") === first) queues.delete("first");
    });

    const draining = drainDynamicPromises(
      () => queues.values(),
      Date.now() + 1_000,
    );
    releaseFirst();

    await expect(draining).resolves.toBe(true);
    expect(secondFinished).toBe(true);
    expect(queues.size).toBe(0);
  });

  it("returns false when work cannot finish before the deadline", async () => {
    const neverSettles = new Promise<void>(() => undefined);
    await expect(drainDynamicPromises(
      () => [neverSettles],
      Date.now() + 10,
    )).resolves.toBe(false);
  });
});
