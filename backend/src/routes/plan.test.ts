import { contractFetch } from "../../test-support/openapi";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePolyline } from "../lib/polylineUtils";

const harness = vi.hoisted(() => ({
  user: { uid: "passenger_1", name: "Token Name" },
  routes: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (
    req: { user?: Record<string, unknown> },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = harness.user;
    next();
  },
}));

vi.mock("../lib/firebaseAdmin", () => ({
  db: {
    collection: (collection: string) => ({
      select: () => ({ orderBy: () => ({ limit: (count: number) => ({ get: async () => ({ docs: [...harness.routes.entries()].slice(0, count).map(([id, data]) => ({ id, data: () => data })) }) }) }) }),
      limit: (count: number) => ({
        get: async () => ({
          docs: [...harness.routes.entries()].slice(0, count).map(([id, data]) => ({ id, data: () => data })),
        }),
      }),
      doc: (id: string) => ({
        collection,
        id,
        get: async () => {
          const data = harness.routes.get(id);
          return { exists: Boolean(data), data: () => data };
        },
      }),
    }),
  },
}));

import { routeListCache } from "../services/apiReadCache";
import planRouter, { segmentRoutes } from "./plan";
import routesListRouter, { routesCollectionRoutes } from "./routesList";

let server: Server;
let baseUrl = "";

const A = { id: "a", name: "Alpha", shortName: "A", lat: 23, lng: 72 };
const Z = { id: "z", name: "Zulu", shortName: "Z", lat: 23.01, lng: 72.01 };
const forwardPolyline = encodePolyline([A, Z]);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/plan", planRouter);
  app.use("/api/routes-list", routesListRouter);
  app.use("/api/v2/routes", segmentRoutes);
  app.use("/api/v2/routes", routesCollectionRoutes);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  routeListCache.invalidate();
  harness.routes = new Map();
});

async function plan(
  routeId: string,
  startStopId: string,
  endStopId: string,
): Promise<{ status: number; direction?: string; polyline?: string }> {
  const response = await contractFetch(`${baseUrl}/api/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ routeId, startStopId, endStopId }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    direction?: string;
    polyline?: string;
  };
  return { status: response.status, ...body };
}

describe("POST /api/plan directional geometry", () => {
  it("plans both directions for a legacy route with no reversePolyline", async () => {
    harness.routes.set("legacy_route", {
      id: "legacy_route",
      name: "Legacy A-Z",
      color: "#000",
      stops: [A, Z],
      waypoints: [],
      polyline: forwardPolyline,
    });

    const forward = await plan("legacy_route", "a", "z");
    expect(forward.status).toBe(200);
    expect(forward.direction).toBe("forward");
    expect(forward.polyline).toBe(forwardPolyline);

    // No reversePolyline stored → reverse planning must fall back to the
    // reversed forward geometry (Z→A travel order) instead of returning 422
    // or silently returning the unreversed forward geometry.
    const reverse = await plan("legacy_route", "z", "a");
    expect(reverse.status).toBe(200);
    expect(reverse.direction).toBe("reverse");
    expect(reverse.polyline).toBe(encodePolyline([Z, A]));
  });

  it("prefers an independently routed reversePolyline when present", async () => {
    // The stored reverse geometry differs from the plain reversed-forward
    // fallback (it detours through M), so the test fails if the planner ever
    // derives a reverse result by reversing forwardCoords instead of using
    // the independently routed reversePolyline.
    const M = { lat: 23.005, lng: 72.02 };
    const reversePolyline = encodePolyline([Z, M, A]);
    harness.routes.set("directional_route", {
      id: "directional_route",
      name: "Directional A-Z",
      color: "#000",
      stops: [A, Z],
      waypoints: [],
      polyline: forwardPolyline,
      forwardPolyline,
      reversePolyline,
    });

    const reverse = await plan("directional_route", "z", "a");
    expect(reverse.status).toBe(200);
    expect(reverse.direction).toBe("reverse");
    expect(reverse.polyline).toBe(reversePolyline);
  });

  it("still rejects a route with no decodable geometry", async () => {
    harness.routes.set("empty_route", {
      id: "empty_route",
      name: "Empty",
      color: "#000",
      stops: [A, Z],
      waypoints: [],
    });

    const forward = await plan("empty_route", "a", "z");
    expect(forward.status).toBe(422);
  });

  it("returns the same segment and direction through the bounded GET alias", async () => {
    harness.routes.set("legacy_route_v2", {
      id: "legacy_route_v2", name: "Route", color: "#000", stops: [A, Z],
      waypoints: [], polyline: forwardPolyline,
    });
    const legacy = await plan("legacy_route_v2", "z", "a");
    const v2 = await contractFetch(`${baseUrl}/api/v2/routes/legacy_route_v2/segments?from=z&to=a`);
    expect(v2.status).toBe(legacy.status);
    expect(v2.headers.get("cache-control")).toBe("no-store");
    await expect(v2.json()).resolves.toMatchObject({
      direction: legacy.direction, polyline: legacy.polyline,
    });
    expect((await contractFetch(`${baseUrl}/api/v2/routes/legacy_route_v2/segments?from=z&to=a&extra=1`)).status).toBe(400);
    expect((await contractFetch(`${baseUrl}/api/v2/routes/legacy_route_v2/segments?from=z&from=a&to=a`)).status).toBe(400);
  });
});

describe("GET /api/v2/routes projection", () => {
  it("returns the legacy bounded metadata shape without geometry", async () => {
    harness.routes.set("route_1", {
      name: "Route 1", color: "#123456", stops: [A, Z], polyline: forwardPolyline,
    });
    const response = await contractFetch(`${baseUrl}/api/v2/routes`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const legacy = await contractFetch(`${baseUrl}/api/routes-list`);
    expect(await legacy.json()).toEqual(await response.clone().json());
    await expect(response.json()).resolves.toEqual({ routes: [{
      id: "route_1", name: "Route 1", color: "#123456", stops: [A, Z],
    }], nextCursor: null });
  });
});
