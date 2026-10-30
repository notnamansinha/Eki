import { contractFetch } from "../../test-support/openapi";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  routes: {} as Record<string, Record<string, unknown>>,
  writes: [] as Array<{ collection: string; id: string; value: Record<string, unknown>; merge: boolean }>,
  getAllCalls: 0,
  failWrite: false,
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (req: { user?: Record<string, unknown> }, _res: unknown, next: () => void) => {
    req.user = { uid: "admin_1", role: "admin", admin: true };
    next();
  },
}));

vi.mock("../lib/firebaseAdmin", () => {
  const ref = (collection: string, id: string) => ({
    collection,
    id,
    set: async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
      if (harness.failWrite) throw new Error("synthetic Firestore outage");
      harness.writes.push({ collection, id, value, merge: Boolean(options?.merge) });
    },
  });
  return {
    db: {
      collection: (collection: string) => ({ doc: (id: string) => ref(collection, id) }),
      getAll: async (...refs: Array<{ collection: string; id: string }>) => {
        harness.getAllCalls += 1;
        return refs.map(({ collection, id }) => {
          const data = collection === "routes" ? harness.routes[id] : undefined;
          return { id, exists: Boolean(data), data: () => data };
        });
      },
    },
  };
});

import { passengerRoutesSettingsRouter } from "./settings";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v2/settings/passenger-routes", passengerRoutesSettingsRouter);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => {
  harness.routes = {
    route_a: {
      id: "route_a",
      name: "North Loop",
      stops: [
        { id: "stop-gate", name: "Main Gate", shortName: "Gate", lat: 23, lng: 72 },
        { id: "stop-library", name: "Library", shortName: "Lib", lat: 23.1, lng: 72.1 },
      ],
    },
    route_b: {
      id: "route_b",
      name: "South Loop",
      stops: [{ id: "stop-hostel", name: "Hostel", shortName: "Hostel", lat: 23.2, lng: 72.2 }],
    },
    route_empty: { id: "route_empty", name: "Draft Route", stops: [] },
  };
  harness.writes = [];
  harness.getAllCalls = 0;
  harness.failWrite = false;
});

async function save(body: unknown) {
  return contractFetch(`${baseUrl}/api/v2/settings/passenger-routes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectRejected(body: unknown, message: RegExp) {
  const response = await save(body);
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(((await response.json()) as { error: string }).error).toMatch(message);
  expect(harness.writes).toEqual([]);
}

const northLoop = { routeId: "route_a", stopTimes: { "stop-gate": "07:30", "stop-library": "07:45" } };
const southLoop = { routeId: "route_b", stopTimes: { "stop-hostel": "18:05" } };

describe("PUT /api/v2/settings/passenger-routes", () => {
  it("fully replaces settings/passengerRoutes with validated data in display order", async () => {
    const response = await save({ routes: [southLoop, northLoop] });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ saved: true });
    expect(harness.getAllCalls).toBe(1);
    expect(harness.writes).toHaveLength(1);
    const [write] = harness.writes;
    expect(write.collection).toBe("settings");
    expect(write.id).toBe("passengerRoutes");
    expect(write.merge).toBe(false);
    expect(Object.keys(write.value).sort()).toEqual(["routes", "updatedAt", "updatedBy"]);
    expect(write.value.routes).toEqual([southLoop, northLoop]);
    expect(write.value.updatedBy).toBe("admin_1");
    expect(write.value.updatedAt).toBeDefined();
  });

  it("stores stop times in the route's own stop order, not the request key order", async () => {
    const response = await save({ routes: [{ routeId: "route_a", stopTimes: { "stop-library": "07:45", "stop-gate": "07:30" } }] });
    expect(response.status).toBe(200);
    const routes = harness.writes[0].value.routes as Array<{ stopTimes: Record<string, string> }>;
    expect(Object.keys(routes[0].stopTimes)).toEqual(["stop-gate", "stop-library"]);
  });

  it("accepts an empty list to unpublish every route without reading route documents", async () => {
    const response = await save({ routes: [] });
    expect(response.status).toBe(200);
    expect(harness.getAllCalls).toBe(0);
    expect(harness.writes[0].value.routes).toEqual([]);
    expect(harness.writes[0].merge).toBe(false);
  });

  it("accepts a route that has no stops with an empty stopTimes object", async () => {
    const response = await save({ routes: [{ routeId: "route_empty", stopTimes: {} }] });
    expect(response.status).toBe(200);
    expect(harness.writes[0].value.routes).toEqual([{ routeId: "route_empty", stopTimes: {} }]);
  });

  it("rejects a route that no longer exists", async () => {
    await expectRejected({ routes: [northLoop, { routeId: "route_gone", stopTimes: {} }] }, /Route route_gone no longer exists/);
  });

  it("rejects a stop that is not on the route", async () => {
    await expectRejected(
      { routes: [{ routeId: "route_a", stopTimes: { ...northLoop.stopTimes, "stop-removed": "08:00" } }] },
      /Route North Loop has no stop stop-removed/,
    );
  });

  it("rejects a missing stop time, naming the stop and route", async () => {
    await expectRejected(
      { routes: [{ routeId: "route_a", stopTimes: { "stop-gate": "07:30" } }] },
      /Missing time for stop Library on route North Loop/,
    );
  });

  it.each(["7:30", "24:00", "07:60", "07:30:00", "", " 07:30", "0730", "ab:cd"])("rejects invalid time %j", async (time) => {
    await expectRejected(
      { routes: [{ routeId: "route_a", stopTimes: { "stop-gate": "07:30", "stop-library": time } }] },
      /Invalid time for stop Library on route North Loop/,
    );
  });

  it.each([null, 730, true, { at: "07:30" }])("rejects a non-text time %j", async (time) => {
    await expectRejected(
      { routes: [{ routeId: "route_a", stopTimes: { "stop-gate": "07:30", "stop-library": time } }] },
      /non-text time for stop stop-library/,
    );
  });

  it("rejects duplicate routes", async () => {
    await expectRejected({ routes: [northLoop, southLoop, northLoop] }, /Route route_a is listed more than once/);
  });

  it("rejects more than 50 routes before reading Firestore", async () => {
    const routes = Array.from({ length: 51 }, (_, index) => ({ routeId: `route_${index}`, stopTimes: {} }));
    await expectRejected({ routes }, /At most 50 routes/);
    expect(harness.getAllCalls).toBe(0);
  });

  it("accepts exactly 50 routes", async () => {
    const routes = Array.from({ length: 50 }, (_, index) => ({ routeId: `r${index}`, stopTimes: {} }));
    for (const { routeId } of routes) harness.routes[routeId] = { name: routeId, stops: [] };
    expect((await save({ routes })).status).toBe(200);
    expect(harness.writes[0].value.routes).toHaveLength(50);
  });

  it.each([
    [{}, /exactly \{ routes/],
    [{ routes: [], extra: true }, /exactly \{ routes/],
    [{ routes: {} }, /exactly \{ routes/],
    [[], /exactly \{ routes/],
    [{ routes: [{ routeId: "route_a" }] }, /exactly routeId and stopTimes/],
    [{ routes: [{ ...northLoop, name: "Injected" }] }, /exactly routeId and stopTimes/],
    [{ routes: ["route_a"] }, /exactly routeId and stopTimes/],
    [{ routes: [{ routeId: "bad id!", stopTimes: {} }] }, /invalid route ID/],
    [{ routes: [{ routeId: "__reserved__", stopTimes: {} }] }, /invalid route ID/],
    [{ routes: [{ routeId: "x".repeat(129), stopTimes: {} }] }, /invalid route ID/],
    [{ routes: [{ routeId: 7, stopTimes: {} }] }, /invalid route ID/],
    [{ routes: [{ routeId: "route_a", stopTimes: [] }] }, /stopTimes must be an object/],
    [{ routes: [{ routeId: "route_a", stopTimes: null }] }, /stopTimes must be an object/],
  ])("rejects malformed payload %j", async (body, message) => {
    await expectRejected(body, message);
  });

  it("rejects prototype-polluting stop keys as unknown stops", async () => {
    const response = await contractFetch(`${baseUrl}/api/v2/settings/passenger-routes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: '{"routes":[{"routeId":"route_b","stopTimes":{"stop-hostel":"18:05","__proto__":"07:00"}}]}',
    });
    expect(response.status).toBe(400);
    expect(harness.writes).toEqual([]);
    expect(({} as Record<string, unknown>)["stop-hostel"]).toBeUndefined();
  });

  it("returns a redacted 500 when persistence fails", async () => {
    harness.failWrite = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await save({ routes: [northLoop] });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to save passenger routes." });
    consoleError.mockRestore();
  });
});
