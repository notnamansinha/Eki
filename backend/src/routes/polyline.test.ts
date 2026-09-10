import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { routeGeometrySignature } from "../lib/routeGeometrySignature";

type Row = Record<string, unknown>;
type DocRef = { kind: "doc"; collection: string; id: string };
type QueryRef = { kind: "query"; collection: string; field: string; value: unknown };

const harness = vi.hoisted(() => ({
  routes: new Map<string, Row>(),
  operations: new Map<string, Row>(),
  activeRides: new Map<string, Row>(),
  failNextCommit: false,
  transactionTail: Promise.resolve() as Promise<unknown>,
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/telemetryRouteService", () => ({ invalidateTelemetryRoute: vi.fn() }));
vi.mock("./plan", () => ({ invalidatePlanRoute: vi.fn() }));

vi.mock("../lib/firebaseAdmin", () => {
  const store = (collection: string) => collection === "routes"
    ? harness.routes
    : collection === "_route_save_operations"
      ? harness.operations
      : harness.activeRides;
  const snapshot = (value: Row | undefined) => ({
    exists: Boolean(value),
    data: () => value,
  });
  const querySnapshot = (rows: Map<string, Row>, query: QueryRef) => {
    const docs = [...rows.entries()]
      .filter(([, value]) => value[query.field] === query.value)
      .slice(0, 1)
      .map(([id, value]) => ({ id, ...snapshot(value) }));
    return { empty: docs.length === 0, docs };
  };
  const document = (collection: string, id: string) => {
    const ref: DocRef & {
      get: () => Promise<ReturnType<typeof snapshot>>;
      set: (value: Row, options?: { merge?: boolean }) => Promise<void>;
      create: (value: Row) => Promise<void>;
      delete: () => Promise<void>;
    } = {
      kind: "doc",
      collection,
      id,
      get: async () => snapshot(store(collection).get(id)),
      set: async (value, options) => {
        const current = store(collection).get(id) ?? {};
        store(collection).set(id, options?.merge ? { ...current, ...value } : value);
      },
      create: async (value) => {
        if (store(collection).has(id)) throw new Error("already exists");
        store(collection).set(id, value);
      },
      delete: async () => { store(collection).delete(id); },
    };
    return ref;
  };
  const collection = (name: string) => ({
    doc: (id: string) => document(name, id),
    where: (field: string, _operator: string, value: unknown) => ({
      limit: () => {
        const query: QueryRef & { get: () => Promise<ReturnType<typeof querySnapshot>> } = {
          kind: "query",
          collection: name,
          field,
          value,
          get: async () => querySnapshot(store(name), query),
        };
        return query;
      },
    }),
  });

  return {
    db: {
      collection,
      runTransaction: <T>(callback: (transaction: {
        get: (ref: DocRef | QueryRef) => Promise<unknown>;
        set: (ref: DocRef, value: Row, options?: { merge?: boolean }) => void;
        create: (ref: DocRef, value: Row) => void;
        delete: (ref: DocRef) => void;
      }) => Promise<T>) => {
        const run = harness.transactionTail.then(async () => {
          const copies = new Map<string, Map<string, Row>>([
            ["routes", new Map(harness.routes)],
            ["_route_save_operations", new Map(harness.operations)],
            ["active_rides", new Map(harness.activeRides)],
          ]);
          const copiedStore = (name: string) => copies.get(name)!;
          const result = await callback({
            get: async (ref) => ref.kind === "doc"
              ? snapshot(copiedStore(ref.collection).get(ref.id))
              : querySnapshot(copiedStore(ref.collection), ref),
            set: (ref, value, options) => {
              const current = copiedStore(ref.collection).get(ref.id) ?? {};
              copiedStore(ref.collection).set(
                ref.id,
                options?.merge ? { ...current, ...value } : value,
              );
            },
            create: (ref, value) => {
              if (copiedStore(ref.collection).has(ref.id)) throw new Error("already exists");
              copiedStore(ref.collection).set(ref.id, value);
            },
            delete: (ref) => { copiedStore(ref.collection).delete(ref.id); },
          });
          if (harness.failNextCommit) {
            harness.failNextCommit = false;
            throw new Error("simulated persistence failure");
          }
          harness.routes = copiedStore("routes");
          harness.operations = copiedStore("_route_save_operations");
          harness.activeRides = copiedStore("active_rides");
          return result;
        });
        harness.transactionTail = run.catch(() => undefined);
        return run;
      },
    },
  };
});

import polylineRouter from "./polyline";

let server: Server;
let baseUrl = "";
const networkFetch = globalThis.fetch;
const encodedPolyline = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
const stops = [
  { id: "a", name: "A", shortName: "A", lat: 23, lng: 72 },
  { id: "b", name: "B", shortName: "B", lat: 23.1, lng: 72.1 },
];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/routes", polylineRouter);
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
  harness.routes = new Map();
  harness.operations = new Map();
  harness.activeRides = new Map();
  harness.failNextCommit = false;
  harness.transactionTail = Promise.resolve();
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function storedRoute(overrides: Row = {}): Row {
  return {
    id: "route-1",
    name: "Original",
    color: "#3B82F6",
    type: "up",
    stops,
    waypoints: stops.map(({ lat, lng }) => ({ lat, lng })),
    polyline: encodedPolyline,
    forwardPolyline: encodedPolyline,
    reversePolyline: encodedPolyline,
    distanceMeters: 100,
    forwardDistanceMeters: 100,
    reverseDistanceMeters: 110,
    duration: "10s",
    forwardDuration: "10s",
    reverseDuration: "11s",
    polylineQuality: "HIGH_QUALITY",
    geometrySignature: routeGeometrySignature(stops),
    configVersion: 1,
    geometryVersion: 1,
    ...overrides,
  };
}

function routeBody(overrides: Row = {}): Row {
  return {
    mode: "edit",
    name: "Updated",
    color: "#10B981",
    type: "up",
    stops,
    expectedVersion: 1,
    saveId: "save-1",
    ...overrides,
  };
}

async function save(body: Row) {
  return networkFetch(`${baseUrl}/api/routes/route-1`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockRoutesApi(gate?: Promise<void>) {
  const upstream = vi.fn(async () => {
    if (gate) await gate;
    return new Response(JSON.stringify({
      routes: [{
        polyline: { encodedPolyline },
        distanceMeters: 120,
        duration: "12s",
      }],
    }), { status: 200 });
  });
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith(baseUrl) ? networkFetch(input, init) : upstream()));
  return upstream;
}

describe("transactional route saves", () => {
  it("reuses valid directional geometry for metadata-only edits", async () => {
    harness.routes.set("route-1", storedRoute());
    const upstream = mockRoutesApi();
    const response = await save(routeBody());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configVersion: 2,
      geometryVersion: 1,
      geometryReused: true,
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("recomputes both directions after a coordinate edit", async () => {
    harness.routes.set("route-1", storedRoute());
    const upstream = mockRoutesApi();
    const editedStops = [stops[0], { ...stops[1], lat: 23.100001 }];
    const response = await save(routeBody({ stops: editedStops }));
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(harness.routes.get("route-1")).toMatchObject({
      configVersion: 2,
      geometryVersion: 2,
      stops: editedStops,
    });
  });

  it("coalesces simultaneous duplicates across the durable operation lease", async () => {
    harness.routes.set("route-1", storedRoute({ geometrySignature: "stale" }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const upstream = mockRoutesApi(gate);
    const first = save(routeBody());
    await vi.waitFor(() => expect(upstream).toHaveBeenCalled());
    const duplicate = await save(routeBody());
    expect(duplicate.status).toBe(202);
    release();
    expect((await first).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    const replay = await save(routeBody());
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ configVersion: 2 });
  });

  it("rejects operation-ID reuse, stale editors, and active-ride races", async () => {
    harness.routes.set("route-1", storedRoute());
    mockRoutesApi();
    expect((await save(routeBody())).status).toBe(200);
    expect((await save(routeBody({ name: "Different" }))).status).toBe(409);

    expect((await save(routeBody({ saveId: "save-stale", expectedVersion: 1 }))).status)
      .toBe(409);
    harness.activeRides.set("bus_route", { routeId: "route-1" });
    expect((await save(routeBody({ saveId: "save-active", expectedVersion: 2 }))).status)
      .toBe(409);
  });

  it("does not commit when a ride starts during geometry calculation", async () => {
    harness.routes.set("route-1", storedRoute({ geometrySignature: "stale" }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const upstream = mockRoutesApi(gate);
    const pending = save(routeBody({ saveId: "save-race" }));
    await vi.waitFor(() => expect(upstream).toHaveBeenCalled());
    harness.activeRides.set("bus_route", { routeId: "route-1" });
    release();
    const response = await pending;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "ACTIVE_RIDE_ROUTE_EDIT" });
    expect(harness.routes.get("route-1")?.configVersion).toBe(1);
  });

  it("returns an unknown-outcome persistence error without mutating the route", async () => {
    harness.routes.set("route-1", storedRoute());
    mockRoutesApi();
    harness.failNextCommit = true;
    const response = await save(routeBody());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "ROUTE_PERSISTENCE_FAILED",
      outcomeUnknown: true,
    });
    expect(harness.routes.get("route-1")?.configVersion).toBe(1);
  });
});
