import { contractFetch } from "../../test-support/openapi";
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
  previews: new Map<string, Row>(),
  admin: true,
  activeRides: new Map<string, Row>(),
  failNextCommit: false,
  transactionTail: Promise.resolve() as Promise<unknown>,
  routeReads: 0,
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (_req: unknown, res: { status: (code: number) => { json: (data: unknown) => void } }, next: () => void) => {
    if (!harness.admin) { res.status(403).json({ error: "Admin required." }); return; }
    Object.assign(_req as object, { user: { uid: "admin" } }); next();
  },
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
      : collection === "_route_geometry_previews" ? harness.previews : harness.activeRides;
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
      get: async () => { if (collection === "routes") harness.routeReads++; return snapshot(store(collection).get(id)); },
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
            ["_route_geometry_previews", new Map(harness.previews)],
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
          harness.previews = copiedStore("_route_geometry_previews");
          harness.activeRides = copiedStore("active_rides");
          return result;
        });
        harness.transactionTail = run.catch(() => undefined);
        return run;
      },
    },
  };
});

import { invalidateRouteGeometryRead } from "../services/routeGeometryReads";
import polylineRouter, { routeSaveResourcesRouter, routeGeometryPreviewsRouter } from "./polyline";

let server: Server;
let baseUrl = "";
let v2 = false;
const networkFetch = contractFetch;
const encodedPolyline = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
const stops = [
  { id: "a", name: "A", shortName: "A", lat: 23, lng: 72 },
  { id: "b", name: "B", shortName: "B", lat: 23.1, lng: 72.1 },
];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/routes", polylineRouter);
  app.use("/api/v2/routes", routeSaveResourcesRouter);
  app.use("/api/v2/route-geometry-previews", routeGeometryPreviewsRouter);
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
  invalidateRouteGeometryRead();
  harness.routes = new Map();
  harness.operations = new Map();
  harness.previews = new Map();
  harness.admin = true;
  harness.activeRides = new Map();
  harness.failNextCommit = false;
  harness.transactionTail = Promise.resolve();
  harness.routeReads = 0;
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
    stops,
    expectedVersion: 1,
    saveId: "save-1",
    ...overrides,
  };
}

async function save(body: Row) {
  return networkFetch(`${baseUrl}${v2 ? "/api/v2/routes" : "/api/routes"}/route-1`, {
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

describe("read-only passenger geometry", () => {
  it("does not repair legacy geometry or call Google when a passenger enumerates routes", async () => {
    harness.admin = false;
    const upstream = mockRoutesApi();
    for (let index = 0; index < 12; index++) harness.routes.set(`legacy-${index}`, storedRoute({ reversePolyline: null }));
    const before = JSON.stringify([...harness.routes]);
    for (let index = 0; index < 12; index++) {
      const response = await networkFetch(`${baseUrl}/api/routes/legacy-${index}/geometry`);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "GEOMETRY_REPAIR_REQUIRED" });
    }
    expect(upstream).not.toHaveBeenCalled(); expect(JSON.stringify([...harness.routes])).toBe(before);
  });
  it("reuses unchanged stored geometry for sixty reads without upstream work", async () => {
    harness.routes.set("route-1", storedRoute()); const upstream = mockRoutesApi();
    for (let index = 0; index < 60; index++) expect((await networkFetch(`${baseUrl}/api/routes/route-1/geometry`)).status).toBe(200);
    expect(harness.routeReads).toBe(1); expect(upstream).not.toHaveBeenCalled();
  });
  it("keeps an admin geometry GET read-only too", async () => {
    harness.routes.set("route-1", storedRoute({ reversePolyline: null })); const upstream = mockRoutesApi();
    const response = await networkFetch(`${baseUrl}/api/routes/route-1/geometry`);
    expect(response.status).toBe(409); expect(upstream).not.toHaveBeenCalled();
    expect(harness.routes.get("route-1")?.reversePolyline).toBeNull();
  });
  it("repairs legacy geometry only through an authorized versioned save and refreshes cached reads", async () => {
    harness.routes.set("route-1", storedRoute({ reversePolyline: null })); const upstream = mockRoutesApi(); v2 = true;
    expect((await networkFetch(`${baseUrl}/api/routes/route-1/geometry`)).status).toBe(409);
    harness.admin = false; expect((await save(routeBody())).status).toBe(403); expect(upstream).not.toHaveBeenCalled();
    harness.admin = true; expect((await save(routeBody())).status).toBe(200); expect(upstream).toHaveBeenCalledTimes(2);
    const response = await networkFetch(`${baseUrl}/api/routes/route-1/geometry`);
    expect(response.status).toBe(200); await expect(response.json()).resolves.toMatchObject({ configVersion: 2, geometryVersion: 2, cached: true });
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});

it("bounds all admin geometry computation to two raw pipelines and eight waiting, retaining stalled permits", async () => {
  let release!: () => void; const gate = new Promise<void>(done => { release = done; }); const upstream = mockRoutesApi(gate);
  const compute = () => networkFetch(`${baseUrl}/api/routes/compute-polyline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waypoints: stops }) });
  const requests = [compute(), compute()];
  try {
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(2));
    requests.push(...Array.from({ length: 10 }, compute));
    // The last ten never dispatch: two refuse capacity and eight age out.
    const refused = await Promise.all(requests.slice(2));
    expect(refused.every(response => response.status === 503 && response.headers.get("retry-after") === "1")).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(2);
    const later = compute(); await new Promise<void>(done => setTimeout(done, 30)); expect(upstream).toHaveBeenCalledTimes(2);
    release(); expect((await later).status).toBe(200); expect(upstream).toHaveBeenCalledTimes(3);
  } finally { release(); await Promise.allSettled(requests); }
}, 10000);

describe.each([false, true])("transactional route saves v2=%s", mode => {
  beforeEach(() => { v2 = mode; });
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
    expect(harness.routes.get("route-1")).not.toHaveProperty("type");
  });

  it("ignores obsolete route type input and does not persist it", async () => {
    harness.routes.set("route-1", storedRoute());
    mockRoutesApi();

    const response = await save(routeBody({ type: "legacy-client-value" }));

    expect(response.status).toBe(200);
    expect(harness.routes.get("route-1")).not.toHaveProperty("type");
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
    expect(duplicate.headers.get("location")).toBe(`${v2 ? "/api/v2/routes" : "/api/routes"}/route-1/save-operations/save-1`);
    expect(duplicate.headers.get("retry-after")).toBe("1");
    const status = await networkFetch(`${baseUrl}/api/v2/routes/route-1/save-operations/save-1`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ status: "processing", operationId: "save-1", routeId: "route-1" });
    release();
    expect((await first).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    const replay = await save(routeBody());
    const snapshot = await (await networkFetch(`${baseUrl}/api/v2/routes/route-1/save-operations/save-1`)).json();
    expect(snapshot).toMatchObject({ status: "succeeded", result: { saved: true, saveId: "save-1" } });
    expect(snapshot).not.toHaveProperty("leaseOwner");
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

it("saves 100 ordered stops with independently computed return geometry", async () => {
  harness.routes.set("route-1", storedRoute());
  const upstream = mockRoutesApi();
  const longStops = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, name: `Stop ${i}`, shortName: `S${i}`, lat: 23 + i * 0.001, lng: 72 }));
  const response = await save(routeBody({ stops: longStops }));
  expect(response.status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(8);
  expect(harness.routes.get("route-1")?.stops).toEqual(longStops);
});


describe("durable geometry preview resources", () => {
  it("abandons expired preview ownership without repeating billable calls", async () => {
    const id = "recovery_preview_1";
    harness.previews.set(id, { status: "processing", deadlineAt: Date.now() - 1, executorId: "stopped-preview", generation: 1 });
    const request = (body: unknown) => networkFetch(`${baseUrl}/api/v2/route-geometry-previews/${id}/recovery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const body = { expectedExecutorId: "stopped-preview", expectedGeneration: 1, executorStopped: true };
    expect((await request({ ...body, inject: true })).status).toBe(400);
    const reply = await request(body); expect(reply.status).toBe(200); expect(reply.headers.get("cache-control")).toBe("no-store");
    expect(await reply.json()).toMatchObject({ status: "failed", error: { outcomeUnknown: true } });
    expect((await request(body)).status).toBe(409);
    harness.admin = false; expect((await request(body)).status).toBe(403);
  });
  const key = "preview_key_00001";
  const points = [{ lat: 23, lng: 72 }, { lat: 23.1, lng: 72.1 }];
  const post = (waypoints = points, id = key) => networkFetch(`${baseUrl}/api/v2/route-geometry-previews`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": id },
    body: JSON.stringify({ waypoints }),
  });
  const poll = () => networkFetch(`${baseUrl}/api/v2/route-geometry-previews/${key}`);
  it("protects submission and status from non-admins", async () => {
    harness.admin = false;
    expect((await post()).status).toBe(403); expect((await poll()).status).toBe(403);
    expect(harness.previews.size).toBe(0);
  });
  it("coalesces submissions, polls without computation, and replays results", async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const upstream = mockRoutesApi(gate);
    const first = await post(); expect(first.status).toBe(202);
    expect(first.headers.get("location")).toBe(`/api/v2/route-geometry-previews/${key}`);
    expect(first.headers.get("retry-after")).toBe("1");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect((await post()).status).toBe(202); expect((await poll()).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect((await post([...points].reverse())).status).toBe(409);
    release(); await vi.waitFor(() => expect(harness.previews.get(key)?.status).toBe("succeeded"));
    const result = await (await poll()).json(); expect(result).not.toHaveProperty("payloadHash");
    expect(await (await post()).json()).toEqual(result); expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("bounds 100-stop preview to four upstream calls with masks and abort signals", async () => {
    const upstream = mockRoutesApi();
    const waypoints = Array.from({ length: 100 }, (_, index) => ({ lat: 23 + index / 1000, lng: 72 }));
    expect((await post(waypoints)).status).toBe(202);
    await vi.waitFor(() => expect(harness.previews.get(key)?.status).toBe("succeeded"));
    expect(upstream).toHaveBeenCalledTimes(4);
    for (const [url, options] of vi.mocked(globalThis.fetch).mock.calls) if (new URL(String(url)).origin === "https://routes.googleapis.com") {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options?.headers).toMatchObject({ "X-Goog-FieldMask": "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration" });
    }
  });
  it("stores redacted failures and never repeats failed billable calls", async () => {
    const upstream = vi.fn(async () => new Response("sensitive upstream response", { status: 500 }));
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) =>
      String(input).startsWith(baseUrl) ? networkFetch(input, init) : upstream()));
    await post(); await vi.waitFor(() => expect(harness.previews.get(key)?.status).toBe("failed"));
    expect(JSON.stringify(await (await poll()).json())).not.toContain("sensitive");
    expect((await post()).status).toBe(200); expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("exposes unresolved deadlines without launching another computation", async () => {
    const upstream = mockRoutesApi();
    harness.previews.set(key, { status: "processing", deadlineAt: Date.now() - 1, payloadHash: "private" });
    expect(await (await poll()).json()).toMatchObject({ status: "processing", outcomeUnknown: true });
    expect(upstream).not.toHaveBeenCalled();
  });
  it("bounds a 100-stop directional save to eight calls and keeps status errors private", async () => {
    const upstream = mockRoutesApi();
    const ordered = Array.from({ length: 100 }, (_, index) => ({
      id: `stop_${index}`, name: `Stop ${index}`, shortName: `S${index}`, lat: 23 + index / 1000, lng: 72,
    }));
    const response = await networkFetch(`${baseUrl}/api/v2/routes/route-1`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(routeBody({ mode: "create", expectedVersion: 0, stops: ordered })),
    });
    expect(response.status).toBe(200); expect(upstream).toHaveBeenCalledTimes(8);
    harness.operations.set("save-1", { routeId: "route-1", status: "failed",
      error: { code: "ROUTE_PERSISTENCE_FAILED", error: "sensitive internal exception" } });
    const statusUrl = `${baseUrl}/api/v2/routes/route-1/save-operations/save-1`;
    const snapshot = await (await networkFetch(statusUrl)).json();
    expect(snapshot).toMatchObject({ status: "failed", error: { code: "ROUTE_PERSISTENCE_FAILED" } });
    expect(JSON.stringify(snapshot)).not.toContain("sensitive");
    harness.admin = false; expect((await networkFetch(statusUrl)).status).toBe(403);
  });
});
