/**
 * Route edit vs manual ride start.
 *
 * startAssignedService() derives direction/origin/destination from a route
 * read outside any transaction and writes `active_rides` last. The bus-lock
 * transaction now re-reads the route and refuses a changed version, and
 * saveRoute() refuses edits while a session owns a bus lock on the route, so
 * an active ride always keeps the route version it started with.
 */
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  docs: new Map<string, Map<string, Row>>(),
  live: new Map<string, Row | null>(),
  onRouteRead: null as null | (() => Promise<void>),
  onLiveClaim: null as null | (() => Promise<void>),
  nextId: 0,
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (req: object, _res: unknown, next: () => void) => { Object.assign(req, { user: { uid: "admin" } }); next(); },
}));
vi.mock("../middleware/requireAuth", () => ({ requireAuth: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("./telemetryRouteService", () => ({ invalidateTelemetryRoute: vi.fn() }));
vi.mock("../routes/plan", () => ({ invalidatePlanRoute: vi.fn() }));
vi.mock("./routeGeometryReads", () => ({ invalidateRouteGeometryRead: vi.fn(), readRouteGeometryDocument: vi.fn() }));

vi.mock("../lib/firebaseAdmin", () => {
  const store = (c: string) => { if (!h.docs.has(c)) h.docs.set(c, new Map()); return h.docs.get(c)!; };
  const snap = (c: string, id: string) => {
    // Mirrors Firestore: __.*__ document IDs are rejected server-side with
    // INVALID_ARGUMENT (see deviceTelemetryService.ts RESERVED_DOCUMENT_ID).
    if (/^__.*__$/.test(id)) throw Object.assign(new Error(`3 INVALID_ARGUMENT: Resource id "${id}" is invalid because it is reserved.`), { code: 3 });
    const v = store(c).get(id);
    return { id, exists: v !== undefined, data: () => (v === undefined ? undefined : structuredClone(v)) };
  };
  const write = (c: string, id: string, data: Row, merge?: boolean) => {
    store(c).set(id, merge ? { ...(store(c).get(id) ?? {}), ...data } : { ...data });
  };
  const query = (c: string, field: string, value: unknown) => ({
    kind: "query" as const, c, field, value,
    limit() { return this; },
    get: async () => {
      const docs = [...store(c).entries()].filter(([, v]) => v[field] === value).map(([id]) => snap(c, id));
      return { empty: docs.length === 0, docs, size: docs.length };
    },
  });
  const ref = (c: string, id: string) => ({
    kind: "doc" as const, c, id,
    get: async () => {
      if (c === "routes" && h.onRouteRead) { const hook = h.onRouteRead; h.onRouteRead = null; const s = snap(c, id); await hook(); return s; }
      return snap(c, id);
    },
    set: async (d: Row, o?: { merge?: boolean }) => write(c, id, d, o?.merge),
    create: async (d: Row) => { if (store(c).has(id)) throw new Error("ALREADY_EXISTS"); write(c, id, d); },
    delete: async () => { store(c).delete(id); },
  });
  type Ref = ReturnType<typeof ref> | ReturnType<typeof query>;
  let tail: Promise<unknown> = Promise.resolve();
  const db = {
    collection: (c: string) => ({
      doc: (id?: string) => ref(c, id ?? `auto${++h.nextId}`),
      where: (field: string, _op: string, value: unknown) => query(c, field, value),
    }),
    runTransaction: <T>(work: (t: unknown) => Promise<T>) => {
      const run = tail.then(async () => {
        const writes: Array<() => void> = [];
        const result = await work({
          get: async (r: Ref) => r.kind === "doc" ? snap(r.c, r.id) : r.get(),
          set: (r: { c: string; id: string }, d: Row, o?: { merge?: boolean }) => writes.push(() => write(r.c, r.id, d, o?.merge)),
          create: (r: { c: string; id: string }, d: Row) => writes.push(() => { if (store(r.c).has(r.id)) throw new Error("ALREADY_EXISTS"); write(r.c, r.id, d); }),
          delete: (r: { c: string; id: string }) => writes.push(() => { store(r.c).delete(r.id); }),
        });
        writes.forEach(w => w());
        return result;
      });
      tail = run.catch(() => undefined);
      return run;
    },
    batch: () => {
      const writes: Array<() => void> = [];
      return {
        set: (r: { c: string; id: string }, d: Row, o?: { merge?: boolean }) => { writes.push(() => write(r.c, r.id, d, o?.merge)); },
        commit: async () => { writes.forEach(w => w()); },
      };
    },
  };
  const rtdb = {
    ref: (path: string) => {
      const key = path.replace("activeBuses/", "");
      return {
        once: async () => ({ val: () => structuredClone(h.live.get(key) ?? null) }),
        transaction: async (update: (v: unknown) => unknown) => {
          if (h.onLiveClaim) { const hook = h.onLiveClaim; h.onLiveClaim = null; await hook(); }
          const next = update(structuredClone(h.live.get(key) ?? null));
          if (next !== undefined) h.live.set(key, next as Row);
          return { committed: next !== undefined, snapshot: { val: () => structuredClone(h.live.get(key) ?? null) } };
        },
      };
    },
  };
  return { db, rtdb, auth: {} };
});

import polylineRouter from "../routes/polyline";
import { RideSessionStartError, startAssignedService } from "./rideSessionStart";

const realFetch = globalThis.fetch;
let server: Server;
let base = "";

const v1Stops = [
  { id: "a", name: "Gate A", shortName: "A", lat: 23.0, lng: 72.5 },
  { id: "b", name: "Hostel B", shortName: "B", lat: 23.1, lng: 72.6 },
];
const v2Stops = [
  { id: "c", name: "Library C", shortName: "C", lat: 23.2, lng: 72.7 },
  { id: "d", name: "Canteen D", shortName: "D", lat: 23.3, lng: 72.8 },
];

beforeAll(async () => {
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (new URL(url).hostname === "routes.googleapis.com") {
      return new Response(JSON.stringify({ routes: [{ polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }, distanceMeters: 1000, duration: "100s" }] }), { status: 200 });
    }
    return realFetch(input as string, init);
  });
  const app = express();
  app.use(express.json());
  app.use("/api/routes", polylineRouter);
  server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no bind");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { vi.unstubAllGlobals(); await new Promise<void>(r => server.close(() => r())); });

beforeEach(() => {
  h.docs = new Map();
  h.live = new Map();
  h.nextId = 0;
  h.onRouteRead = null;
  h.onLiveClaim = null;
  h.docs.set("routes", new Map([["route1", { id: "route1", name: "Loop", color: "#3B82F6", stops: v1Stops, configVersion: 1, geometryVersion: 1 }]]));
  h.live.set("bus1_route1", {
    busId: "bus1", routeId: "route1", status: "offline", lat: 23.0, lng: 72.5,
    timestamp: Date.now(), motionState: "stopped", gpsHdop: 1,
  });
});

const edit = (stops: Row[], expectedVersion: number, saveId: string) => fetch(`${base}/api/routes/route1`, {
  method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "edit", name: "Loop", color: "#3B82F6", stops, expectedVersion, saveId }),
});

/** No active ride may point at a stop its route no longer has. */
function expectRideMatchesRoute() {
  const route = h.docs.get("routes")!.get("route1")!;
  const routeStopIds = (route.stops as Row[]).map(s => s.id);
  for (const ride of h.docs.get("active_rides")?.values() ?? []) {
    expect(routeStopIds).toContain(ride.originStopId);
    expect(routeStopIds).toContain(ride.destinationStopId);
  }
}

describe("route edit vs manual ride start (TOCTOU)", () => {
  it("fails the start when an edit commits after the ride read the route but before it claimed the bus", async () => {
    let editStatus = 0;
    // The admin save lands after the ride start read the route but before its
    // bus-lock transaction; no lock or active ride exists yet, so it commits.
    h.onRouteRead = async () => { editStatus = (await edit(v2Stops, 1, "race-edit-1")).status; };

    const start = startAssignedService({ driverId: "driver1", busId: "bus1", routeId: "route1" }, { principalScope: "driver:driver1" });
    await expect(start).rejects.toBeInstanceOf(RideSessionStartError);
    await expect(start).rejects.toMatchObject({ statusCode: 409 });

    expect(editStatus).toBe(200);
    const route = h.docs.get("routes")!.get("route1")!;
    expect(route.configVersion).toBe(2);
    expect((route.stops as Row[]).map(s => s.id)).toEqual(["c", "d"]);
    // Nothing was claimed for the stale route snapshot.
    expect(h.docs.get("active_rides")?.size ?? 0).toBe(0);
    expect(h.docs.get("_active_bus_locks")?.size ?? 0).toBe(0);
    expect(h.docs.get("ride_sessions")?.size ?? 0).toBe(0);
    expect(h.live.get("bus1_route1")).toMatchObject({ status: "offline" });
    expect(h.live.get("bus1_route1")?.sessionId).toBeUndefined();
    // The route is not pinned by a phantom ride: a corrective edit still works.
    expect((await edit(v1Stops, 2, "race-edit-2")).status).toBe(200);
  });

  it("refuses an edit that lands after the bus lock is claimed but before active_rides is written", async () => {
    let editResponse: Response | null = null;
    h.onLiveClaim = async () => { editResponse = await edit(v2Stops, 1, "race-edit-3"); };

    const started = await startAssignedService({ driverId: "driver1", busId: "bus1", routeId: "route1" }, { principalScope: "driver:driver1" });

    expect(editResponse!.status).toBe(409);
    expect((await editResponse!.json()).code).toBe("ACTIVE_RIDE_ROUTE_EDIT");
    const route = h.docs.get("routes")!.get("route1")!;
    expect(route.configVersion).toBe(1);
    expect(h.docs.get("active_rides")!.get("bus1_route1")).toMatchObject({
      sessionId: started.sessionId, tripState: "in_service", originStopId: "a", destinationStopId: "b",
    });
    expectRideMatchesRoute();
  });

  it("control: an edit after the ride start completes is refused", async () => {
    await startAssignedService({ driverId: "driver1", busId: "bus1", routeId: "route1" }, { principalScope: "driver:driver1" });
    const res = await edit(v2Stops, 1, "after-edit");
    expect(res.status).toBe(409);
    expectRideMatchesRoute();
  });
});

describe("reserved Firestore document IDs on admin route save", () => {
  it("returns 400 INVALID_ROUTE_DATA instead of a retryable unknown outcome for a __reserved__ route ID", async () => {
    const res = await fetch(`${base}/api/routes/__main__`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "create", name: "Main", color: "#3B82F6", stops: v1Stops, expectedVersion: 0, saveId: "reserved-1" }),
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ code: "INVALID_ROUTE_DATA", phase: "validation" });
    expect(body.outcomeUnknown).toBeUndefined();
    expect(res.headers.get("retry-after")).toBeNull();
  });
});
