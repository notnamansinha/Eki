import type { Server } from "node:http";
import type { Request, Response, NextFunction } from "express";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { contractFetch } from "../../test-support/openapi";

const state = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  live: {} as Record<string, unknown>,
  user: {} as Record<string, unknown> | null,
  sequence: 0,
  transactionTail: Promise.resolve() as Promise<unknown>,
  beforeLiveWrite: null as (() => void) | null,
  beforeTransactionRead: null as (() => void) | null,
  afterLiveWrite: null as (() => void) | null,
  failProjectionOnce: false,
  batchSizes: [] as number[],
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!state.user) { res.status(401).json({ error: "Authentication required." }); return; }
    Object.assign(req, { user: state.user }); next();
  },
}));
vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!state.user) { res.status(401).json({ error: "Authentication required." }); return; }
    if (!state.user.admin) { res.status(403).json({ error: "Admin required." }); return; }
    Object.assign(req, { user: state.user }); next();
  },
}));

vi.mock("../lib/firebaseAdmin", () => {
  const snapshot = (path: string) => ({
    exists: state.docs.has(path),
    data: () => state.docs.get(path),
    ref: ref(path),
  });
  type Ref = { path: string; id: string; get: () => Promise<ReturnType<typeof snapshot>>;
    delete: () => Promise<void>;
    set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void>;
    collection: (name: string) => ReturnType<typeof collection> };
  function ref(path: string): Ref {
    return { path, id: path.split("/").at(-1)!, get: async () => snapshot(path),
      delete: async () => { state.docs.delete(path); },
      set: async (data, options) => { state.docs.set(path, options?.merge ? { ...state.docs.get(path), ...data } : data); },
      collection: name => collection(`${path}/${name}`) };
  }
  function collection(path: string) {
    const query = (limit = Infinity, predicate: (data: Record<string, unknown>) => boolean = () => true) => ({
      get: async () => {
        const docs = [...state.docs].filter(([key, data]) => key.startsWith(`${path}/`) &&
          !key.slice(path.length + 1).includes("/") && predicate(data)).slice(0, limit).map(([key]) => snapshot(key));
        return { docs, empty: !docs.length, size: docs.length };
      },
    });
    return { doc: (id = `session_${++state.sequence}`) => ref(`${path}/${id}`),
      limit: (count: number) => query(count),
      where: (field: string, _op: string, value: unknown) => query(Infinity, data => data[field] === value) };
  }
  function writer() {
    const pending: (() => void)[] = [];
    const set = (document: Ref, data: Record<string, unknown>, options?: { merge?: boolean }) => {
      pending.push(() => state.docs.set(document.path, options?.merge ? { ...state.docs.get(document.path), ...data } : data));
    };
    return { get: async (document: Ref) => {
      state.beforeTransactionRead?.(); state.beforeTransactionRead = null;
      return snapshot(document.path);
    },
      set, update: (document: Ref, data: Record<string, unknown>) => set(document, data, { merge: true }),
      create: (document: Ref, data: Record<string, unknown>) => {
        if (state.docs.has(document.path)) throw new Error("Already exists");
        set(document, data);
      },
      delete: (document: Ref) => { pending.push(() => state.docs.delete(document.path)); },
      commit: async () => { pending.forEach(write => write()); state.batchSizes.push(pending.length); } };
  }
  return { db: { collection, batch: writer,
    recursiveDelete: async (document: Ref) => {
      for (const key of state.docs.keys()) if (key === document.path || key.startsWith(`${document.path}/`)) state.docs.delete(key);
    },
    runTransaction: (callback: (transaction: ReturnType<typeof writer>) => Promise<unknown>) => {
      const execution = state.transactionTail.then(async () => {
        const transaction = writer();
        const result = await callback(transaction);
        if (state.failProjectionOnce && state.live.status === "active" &&
            state.docs.get(`ride_sessions/${state.live.sessionId}`)?.status === "pending") {
          state.failProjectionOnce = false;
          throw new Error("Lost projection commit");
        }
        await transaction.commit(); return result;
      });
      state.transactionTail = execution.catch(() => {}); return execution;
    } },
    rtdb: { ref: () => ({ once: async () => ({ val: () => ({ ...state.live }) }),
      transaction: async (callback: (value: Record<string, unknown>) => unknown) => {
        state.beforeLiveWrite?.(); state.beforeLiveWrite = null;
        const result = callback(state.live);
        if (result === undefined) return { committed: false, snapshot: { val: () => state.live } };
        state.live = result as Record<string, unknown>;
        state.afterLiveWrite?.(); state.afterLiveWrite = null;
        return { committed: true, snapshot: { val: () => state.live } };
      } }) } };
});

import shiftsRouter, { rideSessionsRouter } from "./shifts";
import sessionsRouter, { rideSessionBoardingRouter } from "./sessions";

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use("/api/shifts", shiftsRouter); app.use("/api/sessions", sessionsRouter);
  app.use("/api/v2/ride-sessions", rideSessionsRouter);
  app.use("/api/v2/ride-sessions", rideSessionBoardingRouter);
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  state.docs.clear(); state.sequence = 0; state.transactionTail = Promise.resolve();
  state.beforeLiveWrite = null; state.beforeTransactionRead = null; state.afterLiveWrite = null;
  state.failProjectionOnce = false; state.batchSizes = [];
  state.user = { uid: "driver_uid", role: "driver", driverId: "driver_1", assignedBusId: "bus_1" };
  state.docs.set("drivers/driver_1", { authUid: "driver_uid", assignedBusId: "bus_1" });
  state.docs.set("buses/bus_1", { assignedRoutes: ["route_1", "route_2"] });
  state.docs.set("routes/route_1", { stops: [
    { id: "stop_1", name: "A", lat: 23, lng: 72.5 }, { id: "stop_2", name: "B", lat: 23.2, lng: 72.7 },
  ] });
  state.live = { busId: "bus_1", lat: 23, lng: 72.5, timestamp: Date.now(), motionState: "stopped", gpsHdop: 2 };
});
function request(path = "", method = "POST", body?: unknown, key: string | null = "creation_key_0001") {
  return contractFetch(`${base}/api/v2/ride-sessions${path}`, { method,
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const start = (key: string | null = "creation_key_0001", extra = {}) => request("", "POST", { busId: "bus_1", routeId: "route_1", ...extra }, key);
function end(status = "completed") {
  const id = state.live.sessionId as string;
  state.docs.set(`ride_sessions/${id}`, { ...state.docs.get(`ride_sessions/${id}`), status });
  state.docs.delete("_active_bus_locks/bus_1"); state.docs.delete("active_rides/bus_1_route_1");
  state.live.tripState = "completed";
}

describe("versioned session identity and lifecycle", () => {
  it("cannot start a ride while firmware maintenance holds the bus lock", async () => {
    state.docs.set("_active_bus_locks/bus_1", { kind: "firmware", deviceId: "device_1", routeId: "route_1" });
    expect((await start()).status).toBe(409);
    expect([...state.docs.keys()].filter(key => /^ride_sessions\/[^/]+$/.test(key))).toHaveLength(0);
    state.docs.delete("_active_bus_locks/bus_1");
    expect((await start()).status).toBe(201);
  });
  it("requires authentication and a valid key, and rejects passenger creation", async () => {
    expect((await start(null)).status).toBe(400);
    expect((await start("bad key")).status).toBe(400);
    state.user = null; expect((await start()).status).toBe(401);
    state.user = { uid: "passenger", role: "passenger" }; expect((await start()).status).toBe(403);
  });
  it("preserves assignment and hardware gates", async () => {
    state.live.timestamp = Date.now() - 61_000;
    expect((await start()).status).toBe(409);
    expect(state.docs.has("_active_bus_locks/bus_1")).toBe(false);
    state.user!.assignedBusId = "bus_2"; expect((await start()).status).toBe(403);
  });
  it("creates one session across concurrent retries and different keys", async () => {
    const responses = await Promise.all([start(), start(), start("creation_key_0002")]);
    expect(responses.every(response => [200, 201].includes(response.status))).toBe(true);
    const bodies = await Promise.all(responses.map(response => response.json()));
    expect(new Set(bodies.map(body => body.sessionId)).size).toBe(1);
    expect([...state.docs.keys()].filter(key => /^ride_sessions\/[^/]+$/.test(key))).toHaveLength(1);
    for (const response of responses) {
      expect(response.headers.get("location")).toBe(`/api/v2/ride-sessions/${bodies[0].sessionId}`);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
  it.each(["completed", "interrupted", "failed"])("pins retries after %s while a fresh key creates the next ride", async status => {
    const original = await (await start()).json(); end(status);
    const retry = await start(); expect(retry.status).toBe(200);
    expect((await retry.json()).sessionId).toBe(original.sessionId);
    expect(state.docs.get(`ride_sessions/${original.sessionId}`)?.status).toBe(status);
    const fresh = await start("creation_key_0002"); expect(fresh.status).toBe(201);
    expect((await fresh.json()).sessionId).not.toBe(original.sessionId);
    expect((await (await start()).json()).sessionId).toBe(original.sessionId);
  });
  it("rejects key reuse for a changed assignment", async () => {
    await start(); end(); expect((await start("creation_key_0001", { routeId: "route_2" })).status).toBe(409);
  });
  it("repairs an ambiguous projection failure with the original session", async () => {
    state.failProjectionOnce = true;
    expect((await start()).status).toBe(500);
    const id = state.live.sessionId;
    expect(state.docs.get(`ride_sessions/${id}`)?.status).toBe("pending");
    expect((await start()).status).toBe(200);
    expect(state.docs.get(`ride_sessions/${id}`)?.status).toBe("active");
    expect([...state.docs.keys()].filter(key => /^ride_sessions\/[^/]+$/.test(key))).toHaveLength(1);
  });
  it("preserves a newer delay and telemetry progress during creation projection", async () => {
    state.afterLiveWrite = () => {
      const id = state.live.sessionId as string;
      state.docs.set(`ride_sessions/${id}`, { ...state.docs.get(`ride_sessions/${id}`),
        status: "active", stopsReached: { 0: {}, 1: {} } });
      state.docs.set("active_rides/bus_1_route_1", { sessionId: id, status: "active",
        delayMinutes: 12, delayUpdatedAt: Date.now(), currentStopIndex: 1,
        tripState: "in_service", hasDepartedOrigin: true });
    };
    expect((await start()).status).toBe(201);
    expect(state.docs.get("active_rides/bus_1_route_1")).toMatchObject({
      delayMinutes: 12, currentStopIndex: 1, hasDepartedOrigin: true,
    });
    expect(state.docs.get(`ride_sessions/${state.live.sessionId}`)?.stopsReached).toEqual({ 0: {}, 1: {} });
  });

  it("never overwrites completion racing with creation projection", async () => {
    state.afterLiveWrite = () => end();
    expect((await start()).status).toBe(409);
    expect(state.docs.get(`ride_sessions/${state.live.sessionId}`)?.status).toBe("completed");
    expect((await start()).status).toBe(200);
  });
  it("rejects RTDB completion before the durable completion projection arrives", async () => {
    state.afterLiveWrite = () => { state.live.tripState = "completed"; };
    expect((await start()).status).toBe(409);
    expect(state.docs.get(`ride_sessions/${state.live.sessionId}`)?.status).toBe("pending");
    expect((await start()).status).toBe(409);
    expect((await start("creation_key_0002")).status).toBe(409);
    end();
    expect((await start()).status).toBe(200);
  });
  it("scopes creation keys to the authenticated UID", async () => {
    const original = await (await start()).json(); end();
    state.user = { uid: "admin_uid", role: "admin", admin: true };
    const next = await start("creation_key_0001", { driverId: "driver_1" });
    expect(next.status).toBe(201);
    expect((await next.json()).sessionId).not.toBe(original.sessionId);
    expect([...state.docs.keys()].filter(key => key.startsWith("_ride_session_creation_keys/"))).toHaveLength(2);
  });
  it("returns a minimal protected resource without code or manifest", async () => {
    const { sessionId } = await (await start()).json();
    const data = state.docs.get(`ride_sessions/${sessionId}`)!;
    Object.assign(data, { boardingCode: "SECRET", passengers: { p: { userId: "p" } } });
    const response = await request(`/${sessionId}`, "GET"); expect(response.status).toBe(200);
    const body = await response.json(); expect(body).not.toHaveProperty("boardingCode"); expect(body).not.toHaveProperty("passengers");
    state.user = { uid: "stranger", role: "passenger" }; expect((await request(`/${sessionId}`, "GET")).status).toBe(403);
    state.user = { uid: "p", role: "passenger" }; expect((await request(`/${sessionId}`, "GET")).status).toBe(200);
  });
  it("binds delay to path session and rejects a replacement during RTDB transaction", async () => {
    const { sessionId } = await (await start()).json();
    expect((await request(`/${sessionId}`, "PATCH", { delayMinutes: 5 })).status).toBe(200);
    expect(state.docs.get("active_rides/bus_1_route_1")?.delayMinutes).toBe(5);
    expect((await request(`/${sessionId}`, "PATCH", { delayMinutes: 6, busId: "bus_1" })).status).toBe(400);
    state.beforeLiveWrite = () => { state.live.sessionId = "replacement_session"; };
    expect((await request(`/${sessionId}`, "PATCH", { delayMinutes: 9 })).status).toBe(409);
    expect(state.live.delayMinutes).toBe(5);
    state.user = { uid: "other", role: "driver", driverId: "driver_2", assignedBusId: "bus_1" };
    expect((await request(`/${sessionId}`, "PATCH", { delayMinutes: 9 })).status).toBe(403);
  });
  it.each(["/api/sessions", "/api/v2/ride-sessions"])("protects and reuses the boarding code on %s", async prefix => {
    const { sessionId } = await (await start()).json();
    const code = () => contractFetch(`${base}${prefix}/${sessionId}/boarding-code`, { method: "POST" });
    const first = await code(); expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const body = await first.json(); expect(await (await code()).json()).toEqual(body);
    state.user = { uid: "passenger", role: "passenger" }; expect((await code()).status).toBe(403);
    state.user = { uid: "driver_uid", role: "driver", driverId: "driver_1", assignedBusId: "bus_1" };
    end(); expect((await code()).status).toBe(403);
    expect(state.live).not.toHaveProperty("boardingCode");
  });
  it("rejects a wrong boarding code and a code rotated before the transaction", async () => {
    const { sessionId } = await (await start()).json();
    state.docs.set(`ride_sessions/${sessionId}`, {
      ...state.docs.get(`ride_sessions/${sessionId}`),
      status: "active", direction: "forward", boardingCode: "ABZ2349H",
    });
    state.live = { ...state.live, sessionId, busId: "bus_1", routeId: "route_1",
      status: "active", tripState: "in_service", timestamp: Date.now() };
    state.user = { uid: "passenger", role: "passenger" };
    const body = { boardingCode: "ABZ2349H", lat: 23, lng: 72.5, accuracy: 5,
      boardingStopId: "stop_1", alightingStopId: "stop_2" };
    const board = (override = {}) => contractFetch(`${base}/api/sessions/${sessionId}/join`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...override }),
    });
    expect((await board({ boardingCode: "ABZ2349J" })).status).toBe(403);
    expect(state.docs.get(`ride_sessions/${sessionId}`)?.passengers).toEqual({});
    state.beforeTransactionRead = () => {
      state.docs.set(`ride_sessions/${sessionId}`, {
        ...state.docs.get(`ride_sessions/${sessionId}`), boardingCode: "ABZ2349J",
      });
    };
    expect((await board()).status).toBe(409);
    expect(state.docs.get(`ride_sessions/${sessionId}`)?.passengers).toEqual({});
  });
  it("guards live history, bounds message cleanup and retains key tombstones", async () => {
    const { sessionId } = await (await start()).json();
    expect((await request(`/${sessionId}`, "DELETE")).status).toBe(403);
    state.user = { uid: "admin", role: "admin", admin: true };
    expect((await request(`/${sessionId}`, "DELETE")).status).toBe(409);
    for (let index = 0; index < 805; index++) state.docs.set(`ride_sessions/${sessionId}/messages/m_${index}`, { text: "x" });
    state.batchSizes = [];
    const cleanup = await request(`/${sessionId}/messages`, "DELETE");
    expect((await cleanup.json()).deleted).toBe(805); expect(state.batchSizes).toEqual([400, 400, 5]);
    end(); state.docs.set(`completed_trips/${sessionId}`, { sessionId });
    expect((await request(`/${sessionId}`, "DELETE")).status).toBe(200);
    expect(state.docs.has(`_ride_history_deletion_jobs/${sessionId}`)).toBe(false);
    expect((await request(`/${sessionId}`, "DELETE")).status).toBe(200);
    state.user = { uid: "driver_uid", role: "driver", driverId: "driver_1", assignedBusId: "bus_1" };
    expect((await start()).status).toBe(410);
  });
});
