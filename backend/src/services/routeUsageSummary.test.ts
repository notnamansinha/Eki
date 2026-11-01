import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

vi.mock("../lib/firebaseAdmin", () => ({ db: {} }));
const metrics = vi.hoisted(() => ({ runs: [] as string[] }));
vi.mock("../lib/metrics", () => ({ recordWorkerRun: (worker: string, outcome: string) => { metrics.runs.push(`${worker}:${outcome}`); } }));

import { computeRouteUsage, publishRouteUsage, ROUTE_USAGE_INTERVAL_MS, ROUTE_USAGE_MAX_ROUTES, startRouteUsageSummary } from "./routeUsageSummary";

/** Minimal Firestore double: route IDs, trips by route and the settings writes. */
function fakeStore(routeIds: string[], trips: Record<string, number>, options: { failCounts?: boolean } = {}) {
  const writes: { path: string; data: unknown; options: unknown }[] = [];
  const countQueries: string[] = [];
  const store = {
    collection(name: string) {
      if (name === "routes") {
        const query = {
          select: () => query, orderBy: () => query,
          limit: (count: number) => ({ get: async () => ({ docs: [...routeIds].sort().slice(0, count).map(id => ({ id })) }) }),
        };
        return query;
      }
      if (name === "completed_trips") {
        return { where: (field: string, op: string, value: string) => {
          expect([field, op]).toEqual(["routeId", "=="]);
          return { count: () => ({ get: async () => {
            countQueries.push(value);
            if (options.failCounts) throw new Error("FAILED_PRECONDITION");
            return { data: () => ({ count: trips[value] ?? 0 }) };
          } }) };
        } };
      }
      if (name === "settings") {
        return { doc: (id: string) => ({ set: async (data: unknown, setOptions: unknown) => { writes.push({ path: `settings/${id}`, data, options: setOptions }); } }) };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  };
  return { store: store as unknown as Firestore, writes, countQueries };
}

afterEach(() => { vi.useRealTimers(); metrics.runs = []; });

describe("route usage summary", () => {
  it("counts completed trips for every existing route, including routes never ridden", async () => {
    const { store } = fakeStore(["loop", "express", "night"], { loop: 42, express: 7, deleted: 99 });
    const summary = await computeRouteUsage(store, () => Date.UTC(2026, 10, 1, 12));
    expect(summary).toEqual({
      completedRides: { express: 7, loop: 42, night: 0 },
      generatedAt: "2026-11-01T12:00:00.000Z",
      truncated: false,
    });
  });

  it("replaces the published document so deleted routes drop out", async () => {
    const { store, writes } = fakeStore(["loop"], { loop: 3 });
    await publishRouteUsage(store, () => 0);
    expect(writes).toEqual([{
      path: "settings/routeUsage",
      data: { completedRides: { loop: 3 }, generatedAt: "1970-01-01T00:00:00.000Z", truncated: false },
      options: {},
    }]);
  });

  it("bounds the number of routes it counts", async () => {
    const ids = Array.from({ length: ROUTE_USAGE_MAX_ROUTES + 5 }, (_, index) => `route-${String(index).padStart(3, "0")}`);
    const { store, countQueries } = fakeStore(ids, {});
    const summary = await computeRouteUsage(store);
    expect(summary.truncated).toBe(true);
    expect(Object.keys(summary.completedRides)).toHaveLength(ROUTE_USAGE_MAX_ROUTES);
    expect(countQueries).toHaveLength(ROUTE_USAGE_MAX_ROUTES);
  });

  it("runs at start and hourly, and keeps the previous counts when a run fails", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const healthy = fakeStore(["loop"], { loop: 1 });
    const stop = startRouteUsageSummary(healthy.store);
    await vi.advanceTimersByTimeAsync(0);
    expect(healthy.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(ROUTE_USAGE_INTERVAL_MS);
    expect(healthy.writes).toHaveLength(2);
    stop();
    await vi.advanceTimersByTimeAsync(ROUTE_USAGE_INTERVAL_MS * 2);
    expect(healthy.writes).toHaveLength(2);

    const failing = fakeStore(["loop"], {}, { failCounts: true });
    const stopFailing = startRouteUsageSummary(failing.store);
    await vi.advanceTimersByTimeAsync(0);
    expect(failing.writes).toHaveLength(0);
    expect(metrics.runs).toEqual(["route_usage:success", "route_usage:success", "route_usage:failure"]);
    stopFailing();
    warn.mockRestore();
  });
});
