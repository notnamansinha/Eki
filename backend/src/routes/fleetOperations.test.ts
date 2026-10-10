import type { Server } from "node:http";
import type { Request, Response, NextFunction } from "express";
import express from "express";
import { FieldValue } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { contractFetch } from "../../test-support/openapi";

const state = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  mirrors: {} as Record<string, unknown>,
  claims: {} as Record<string, unknown>, userClaims: new Map<string, Record<string, unknown>>(), liveNodes: {} as Record<string, any>, activeAuth: 0, maxAuth: 0, mirrorRoots: 0,
  admin: true, writes: 0, revocations: 0, sequence: 0,
  gate: null as Promise<void> | null,
  tail: Promise.resolve() as Promise<unknown>,
  failFinalWrite: false,
  admissionGate: null as Promise<void> | null,
  admissionStarted: false,
  rejectClaims: false,
  claimsRejected: false,
  revokeGate: null as Promise<void> | null,
}));
vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!state.admin) { res.status(403).json({ error: "Admin required." }); return; }
    Object.assign(req, { user: { uid: "admin", admin: true } }); next();
  },
}));
vi.mock("../lib/firebaseAdmin", () => {
  type Ref = ReturnType<typeof document>;
  const snapshot = (path: string) => ({ exists: state.docs.has(path), data: () => state.docs.get(path),
    id: path.split("/").at(-1)!, ref: document(path) });
  function document(path: string) {
    return { path, id: path.split("/").at(-1)!,
      get: async () => snapshot(path),
      delete: async () => { state.docs.delete(path); },
      set: async (data: Record<string, unknown>, options?: { merge: boolean }) => {
        if (state.failFinalWrite && path.startsWith("_fleet_reconciliation_jobs/") && (data.status === "failed" || data.status === "succeeded")) {
          state.failFinalWrite = false; throw new Error("ambiguous outcome write");
        }
        const next = options?.merge ? { ...state.docs.get(path), ...data } : { ...data };
        for (const [field, value] of Object.entries(next)) {
          if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete next[field];
        }
        state.docs.set(path, next);
      },
    };
  }
  return {
    auth: {
      getUser: async (uid: string) => { state.activeAuth++; state.maxAuth = Math.max(state.maxAuth, state.activeAuth); try { if (state.gate) await state.gate; return { customClaims: state.userClaims.get(uid) ?? state.claims }; } finally { state.activeAuth--; } },
      setCustomUserClaims: async (_uid: string, claims: Record<string, unknown>) => {
        if (state.rejectClaims) { state.claimsRejected = true; throw new Error("private upstream failure"); }
        state.userClaims.set(_uid, claims); state.writes++;
      },
      revokeRefreshTokens: async () => { if (state.revokeGate) await state.revokeGate; state.revocations++; },
    },
    db: {
      collection: (name: string) => {
        const query = (field?: string, value?: unknown, cursor = "", cap = Infinity): any => ({
          doc: (id = `audit_${++state.sequence}`) => document(`${name}/${id}`),
          where: (nextField: string, _op: string, nextValue: unknown) => query(nextField, nextValue, cursor, cap),
          orderBy: () => query(field, value, cursor, cap),
          limit: (count: number) => query(field, value, cursor, count),
          startAfter: (id: string) => query(field, value, id, cap),
          get: async () => {
            const docs = [...state.docs.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && path.split("/").at(-1)! > cursor && (!field || data[field] === value)).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).slice(0, cap).map(([path]) => snapshot(path));
            return { docs, size: docs.length, empty: !docs.length };
          },
        });
        return query();
      },
      runTransaction: (callback: (transaction: { get: (ref: Ref) => Promise<ReturnType<typeof snapshot>>;
        create: (ref: Ref, data: Record<string, unknown>) => void; set: (ref: Ref, data: Record<string, unknown>, options?: { merge: boolean }) => void; delete: (ref: Ref) => void }) => Promise<unknown>) => {
        const operation = state.tail.then(async () => {
          if (state.admissionGate) { state.admissionStarted = true; await state.admissionGate; state.admissionGate = null; }
          const writes: (() => void)[] = [];
          const result = await callback({ get: async (ref: any) => ref.path ? snapshot(ref.path) : ref.get(),
            create: (ref, data) => { if (state.docs.has(ref.path)) throw new Error("Already exists"); writes.push(() => state.docs.set(ref.path, data)); },
            set: (ref, data, options) => {
              if (state.failFinalWrite && ref.path.startsWith("_fleet_reconciliation_jobs/") && (data.status === "failed" || data.status === "succeeded")) {
                state.failFinalWrite = false; throw new Error("ambiguous outcome write");
              }
              writes.push(() => state.docs.set(ref.path, options?.merge ? { ...state.docs.get(ref.path), ...data } : data));
            },
            delete: ref => { writes.push(() => state.docs.delete(ref.path)); } });
          writes.forEach(write => write()); return result;
        });
        state.tail = operation.catch(() => {}); return operation;
      },
    },
    rtdb: { ref: (path: string) => {
      const ref: any = {
        once: async () => {
          if (path === "driverRouteAssignments") state.mirrorRoots++;
          return { val: () => path === "driverRouteAssignments" ? state.mirrors : path === "activeBuses" ? state.liveNodes : state.mirrors[path.split("/").at(-1)!] ?? null };
        },
        set: async (value: unknown) => { state.mirrors[path.split("/").at(-1)!] = value; },
        remove: async () => { delete state.mirrors[path.split("/").at(-1)!]; },
        transaction: async (work: any) => { const key = path.split("/").at(-1)!; const value = work(state.liveNodes[key] ?? null); if (value !== undefined) { if (value === null) delete state.liveNodes[key]; else state.liveNodes[key] = value; } return { committed: value !== undefined }; },
        orderByKey: () => {
          const query = (cap = Infinity, cursor = ""): any => ({ limitToFirst: (count: number) => query(count, cursor), startAfter: (id: string) => query(cap, id), once: async () => {
            const entries = Object.entries(state.liveNodes).filter(([key]) => key > cursor).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, cap);
            return { val: () => Object.fromEntries(entries), forEach: (callback: any) => { entries.forEach(([key, value]) => callback({ key, val: () => value })); } };
          } }); return query();
        },
      }; return ref;
    } },
  };
});

import fleetRouter, { fleetReconciliationJobsRouter, reconcileFleetAuthorization, FleetReconciliationBusy, drainFleetMutations } from "./fleet";
import { drainHttpOperations } from "../services/httpOperations";

let server: Server;
let base = "";
const key = "fleet_job_key_001";
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use("/api/fleet", fleetRouter);
  app.use("/api/v2/fleet-reconciliation-jobs", fleetReconciliationJobsRouter);
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No address");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await drainFleetMutations(false); await drainHttpOperations(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(async () => {
  await drainFleetMutations(false);
  state.docs.clear(); state.mirrors = {}; state.claims = {}; state.userClaims.clear(); state.liveNodes = {}; state.activeAuth = 0; state.maxAuth = 0; state.mirrorRoots = 0; state.admin = true;
  state.writes = 0; state.revocations = 0; state.gate = null; state.tail = Promise.resolve(); state.failFinalWrite = false;
  state.admissionGate = null; state.admissionStarted = false;
  state.rejectClaims = false; state.claimsRejected = false; state.revokeGate = null;
  state.docs.set("drivers/driver_1", { authUid: "auth_uid", assignedBusId: "bus_1" });
  state.docs.set("buses/bus_1", { assignedRoutes: ["route_1"] });
});
const post = (id = key, body: unknown = {}) => contractFetch(`${base}/api/v2/fleet-reconciliation-jobs`, {
  method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": id }, body: JSON.stringify(body),
});
const poll = (id = key) => contractFetch(`${base}/api/v2/fleet-reconciliation-jobs/${id}`);
const waitTerminal = (id = key) => vi.waitFor(() => expect(state.docs.get(`_fleet_reconciliation_jobs/${id}`)?.status).not.toBe("processing"));

describe("fleet operation resources", () => {
  it("preserves operator metadata when updating editable driver fields", async () => {
    state.docs.set("drivers/driver_1", { authUid: "auth_uid", assignedBusId: "bus_1", createdAt: 123, badge: { number: "synthetic" } });
    const response = await contractFetch(`${base}/api/fleet/drivers/driver_1`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Driver", authUid: "auth_uid", assignedBusId: "bus_1" }) });
    expect(response.status).toBe(200);
    expect(state.docs.get("drivers/driver_1")).toMatchObject({ name: "Driver", createdAt: 123, badge: { number: "synthetic" } });
  });
  it("preserves existing bus timestamps and nested metadata while explicitly migrating the legacy assignment", async () => {
    state.docs.delete("drivers/driver_1");
    state.docs.set("routes/route_1", { name: "Route" });
    const metadata = { manufacturer: { name: "Example", serial: "synthetic" }, tags: ["accessible"] };
    state.docs.set("buses/bus_1", { id: "bus_1", name: "Before", assignedRouteId: "legacy_route", createdAt: 123, inspectedAt: 456, metadata });
    const response = await contractFetch(`${base}/api/fleet/buses/bus_1`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: " After ", assignedRoutes: ["route_1", "route_1"], createdAt: 999, metadata: { injected: true }, admin: true }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(state.docs.get("buses/bus_1")).toEqual({ id: "bus_1", name: "After", assignedRoutes: ["route_1"], createdAt: 123, inspectedAt: 456, metadata });
  });
  it("creates only allowed bus fields and supports an explicit empty route assignment", async () => {
    state.docs.delete("drivers/driver_1");
    state.docs.delete("buses/bus_1");
    const response = await contractFetch(`${base}/api/fleet/buses/bus_1`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New bus", assignedRoutes: [], createdAt: 999, metadata: { injected: true } }) });
    expect(response.status).toBe(200);
    expect(state.docs.get("buses/bus_1")).toEqual({ id: "bus_1", name: "New bus", assignedRoutes: [] });
  });
  it("keeps all bus fields when a live ride blocks assignment removal", async () => {
    const bus = { id: "bus_1", name: "Before", assignedRoutes: ["route_1"], assignedRouteId: "route_1", createdAt: 123, metadata: { accessible: true } };
    state.docs.set("buses/bus_1", bus);
    state.docs.set("active_rides/ride_1", { busId: "bus_1", routeId: "route_1" });
    const response = await contractFetch(`${base}/api/fleet/buses/bus_1`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "After", assignedRoutes: [] }) });
    expect(response.status).toBe(409);
    expect(state.docs.get("buses/bus_1")).toEqual(bus);
  });
  it("keeps admin authorization and rejects unsupported bodies/keys", async () => {
    expect((await post("bad")).status).toBe(400); expect((await post(key, { authUid: "injected" })).status).toBe(400);
    state.admin = false; expect((await post()).status).toBe(403); expect((await poll()).status).toBe(403);
    expect(state.writes).toBe(0);
  });
  it("replays the same job across concurrent submissions without duplicate effects", async () => {
    let release!: () => void; state.gate = new Promise<void>(resolve => { release = resolve; });
    const first = await post(); expect(first.status).toBe(202);
    expect(first.headers.get("location")).toBe(`/api/v2/fleet-reconciliation-jobs/${key}`);
    expect(first.headers.get("retry-after")).toBe("1");
    expect((await post()).status).toBe(202);
    expect(await (await poll()).json()).toMatchObject({ status: "processing" });
    release(); await waitTerminal();
    const body = await (await poll()).json();
    expect(body).toMatchObject({ status: "succeeded", result: { checked: 1, repaired: 1, failed: 0 } });
    expect(JSON.stringify(body)).not.toContain("auth_uid"); expect(body).not.toHaveProperty("payloadHash");
    expect(body).not.toHaveProperty("adminUid");
    expect(state.docs.get(`_fleet_reconciliation_jobs/${key}`)?.adminUid).toBe("admin");
    expect(await (await post()).json()).toEqual(body);
    expect(state.writes).toBe(1); expect(state.revocations).toBe(1);
    expect(state.docs.has("_fleet_reconciliation_locks/singleton")).toBe(false);
  });
  it("coordinates different keys, legacy reconciliation and periodic worker across the singleton lock", async () => {
    let release!: () => void; state.gate = new Promise<void>(resolve => { release = resolve; });
    await post(); await vi.waitFor(() => expect(state.docs.has("_fleet_reconciliation_locks/singleton")).toBe(true));
    await expect(reconcileFleetAuthorization()).rejects.toBeInstanceOf(FleetReconciliationBusy);
    expect((await contractFetch(`${base}/api/fleet/reconcile`, { method: "POST" })).status).toBe(409);
    const other = "fleet_other_key_01"; expect((await post(other)).status).toBe(202); await waitTerminal(other);
    expect(await (await poll(other)).json()).toMatchObject({ status: "failed", error: { code: "FLEET_RECONCILIATION_BUSY" } });
    release(); await waitTerminal(); expect(state.writes).toBe(1);
  });
  it("retains partial per-record outcomes without exposing internal errors", async () => {
    state.docs.set("drivers/invalid", { authUid: "unsafe/uid" });
    await post(); await waitTerminal();
    const body = await (await poll()).json();
    expect(body).toMatchObject({ status: "failed", result: { checked: 2, repaired: 1, failed: 1,
      records: [{ driverId: "driver_1", outcome: "repaired" }, { driverId: "invalid", outcome: "failed", code: "INVALID_DRIVER_AUTH" }] } });
    expect((await post()).status).toBe(200); expect(state.writes).toBe(1);
  });
  it("stops launching work past its budget and releases ownership safely", async () => {
    const result = await reconcileFleetAuthorization(Date.now() - 1);
    expect(result).toMatchObject({ checked: 0, repaired: 0, failed: 0, records: [], timeBudgetExceeded: true, nextCursor: "" });
    expect(state.writes).toBe(0); expect(state.docs.has("_fleet_reconciliation_locks/singleton")).toBe(false);
  });
  it("preserves an unresolved crash lock instead of retrying side effects", async () => {
    state.docs.set("_fleet_reconciliation_locks/singleton", { owner: "stopped_or_unknown_replica" });
    await post(); await waitTerminal();
    expect(state.writes).toBe(0); expect(state.docs.has("_fleet_reconciliation_locks/singleton")).toBe(true);
  });
  it("keeps legacy result shape", async () => {
    const response = await contractFetch(`${base}/api/fleet/reconcile`, { method: "POST" });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ checked: 1, repaired: 1, failed: 0 });
  });
  it("retains processing after an ambiguous final write and does not rerun", async () => {
    state.failFinalWrite = true; await post(); await vi.waitFor(() => expect(state.writes).toBe(1));
    await vi.waitFor(() => expect(state.failFinalWrite).toBe(false));
    state.docs.get(`_fleet_reconciliation_jobs/${key}`)!.deadlineAt = Date.now() - 1;
    expect(await (await poll()).json()).toMatchObject({ status: "processing", outcomeUnknown: true });
    expect((await post()).status).toBe(202); expect(state.revocations).toBe(1);
  });
  it("holds ownership until all side effects settle even when one write rejects early", async () => {
    state.rejectClaims = true;
    let release!: () => void; state.revokeGate = new Promise<void>(resolve => { release = resolve; });
    await post(); await vi.waitFor(() => expect(state.claimsRejected).toBe(true));
    expect(state.docs.has("_fleet_reconciliation_locks/singleton")).toBe(true);
    expect(await (await poll()).json()).toMatchObject({ status: "processing" });
    await expect(reconcileFleetAuthorization()).rejects.toBeInstanceOf(FleetReconciliationBusy);
    release(); await waitTerminal();
    const body = await (await poll()).json();
    expect(body).toMatchObject({ status: "failed", result: { records: [{ code: "RECONCILIATION_RECORD_FAILED" }] } });
    expect(JSON.stringify(body)).not.toContain("private upstream");
    expect(state.docs.has("_fleet_reconciliation_locks/singleton")).toBe(false);
  });
  it("discovers crashed jobs and requires ordered, audited operation and lock recovery", async () => {
    state.docs.set(`_fleet_reconciliation_jobs/${key}`, { status: "processing", deadlineAt: Date.now() - 1, executorId: "stopped-process", generation: 1, progress: { phase: "authorizing", batchDriverIds: ["driver_1"] } });
    state.docs.set("_fleet_reconciliation_locks/singleton", { owner: "old-owner", operationId: key, executorId: "stopped-process" });
    const recoverLock = (expectedOwner = "old-owner") => contractFetch(`${base}/api/v2/fleet-reconciliation-jobs/lock/recovery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedOwner, executorStopped: true }) });
    const page = await contractFetch(`${base}/api/v2/fleet-reconciliation-jobs/recovery`);
    expect(await page.json()).toMatchObject({ operations: [{ operationId: key, recovery: { required: true } }], nextCursor: null });
    expect(await (await contractFetch(`${base}/api/v2/fleet-reconciliation-jobs/lock`)).json()).toEqual({ owner: "old-owner", executorId: "stopped-process", operationId: key });
    expect((await recoverLock()).status).toBe(409);
    const recovered = await contractFetch(`${base}/api/v2/fleet-reconciliation-jobs/${key}/recovery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedExecutorId: "stopped-process", expectedGeneration: 1, executorStopped: true }) });
    expect(recovered.status).toBe(200); expect(await recovered.json()).toMatchObject({ status: "failed", error: { outcomeUnknown: true } });
    expect((await recoverLock("changed-owner")).status).toBe(409); expect((await recoverLock()).status).toBe(200);
    expect((await contractFetch(`${base}/api/v2/fleet-reconciliation-jobs/lock`)).status).toBe(404);
    expect(state.writes).toBe(0); expect(state.revocations).toBe(0);
    expect([...state.docs.entries()].find(([path]) => path.startsWith("_fleet_lock_recoveries/"))?.[1]).toMatchObject({ recoveredBy: "admin", owner: "old-owner" });
    await post("deliberate_new_key"); await waitTerminal("deliberate_new_key"); expect(state.writes).toBe(1);
  });
  it("rejects unsafe recovery payloads, unauthorized access and live lock takeover", async () => {
    const url = `${base}/api/v2/fleet-reconciliation-jobs/lock/recovery`;
    const request = (body: unknown) => contractFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await request({ expectedOwner: "old", executorStopped: false })).status).toBe(400);
    state.admin = false; expect((await request({ expectedOwner: "old", executorStopped: true })).status).toBe(403);
    expect((await contractFetch(`${base}/api/v2/fleet-reconciliation-jobs/recovery`)).status).toBe(403); state.admin = true;
    let release!: () => void; state.gate = new Promise<void>(done => { release = done; }); await post();
    await vi.waitFor(() => expect(state.docs.has("_fleet_reconciliation_locks/singleton")).toBe(true));
    const owner = state.docs.get("_fleet_reconciliation_locks/singleton")!.owner;
    try { expect((await request({ expectedOwner: owner, executorStopped: true })).status).toBe(409); }
    finally { release(); await waitTerminal(); }
  });
  it("visits drivers beyond the first 500 through bounded continuation pages", async () => {
    state.docs.clear(); state.docs.set("buses/bus_1", { assignedRoutes: ["route_1"] });
    for (let index = 0; index < 1001; index++) state.docs.set(`drivers/driver_${String(index).padStart(4, "0")}`, { authUid: `auth_${index}`, assignedBusId: "bus_1" });
    const visited = new Set<string>(); let cursor: string | undefined;
    do {
      const result = await reconcileFleetAuthorization(Date.now() + 30000, null, undefined, cursor);
      expect(result.records.length).toBeLessThanOrEqual(100);
      for (const record of result.records) visited.add(record.driverId);
      cursor = (result as any).nextCursor ?? undefined;
    } while (cursor);
    expect(visited.size).toBe(1001); expect(state.mirrorRoots).toBe(0); expect(state.maxAuth).toBeLessThanOrEqual(10);
  });
  it("detects a conflicting bound device beyond the previous per-bus 250 cap", async () => {
    state.docs.set("routes/route_1", {});
    for (let index = 0; index < 301; index++) state.docs.set(`devices/device_${String(index).padStart(4, "0")}`, { busId: "bus_1", routeId: index === 300 ? "removed_route" : "route_1" });
    const reply = await contractFetch(`${base}/api/fleet/buses/bus_1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Bus", assignedRoutes: ["route_1"] }) });
    expect(reply.status).toBe(409); expect(state.writes).toBe(0);
  });
  it("repairs every bound driver beyond 250 with at most ten Auth reads", async () => {
    state.docs.set("routes/route_1", {});
    for (let index = 0; index < 301; index++) state.docs.set(`drivers/bound_${String(index).padStart(4, "0")}`, { authUid: `auth_${index}`, assignedBusId: "bus_1" });
    const reply = await contractFetch(`${base}/api/fleet/buses/bus_1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Bus", assignedRoutes: ["route_1"] }) });
    expect(reply.status).toBe(200); expect(Object.keys(state.mirrors)).toHaveLength(302); expect(state.mirrors.bound_0300).toEqual({ bus_1: { route_1: true } });
    expect(state.maxAuth).toBeLessThanOrEqual(10); expect(state.docs.has("_fleet_reconciliation_locks/singleton")).toBe(false);
  });
  it("deletes a bus only after all paged drivers and live nodes are safely cleared", async () => {
    state.docs.delete("drivers/driver_1");
    for (let index = 0; index < 301; index++) {
      const id = `bound_${String(index).padStart(4, "0")}`;
      state.docs.set(`drivers/${id}`, { authUid: `auth_${index}`, assignedBusId: "bus_1" });
      state.userClaims.set(`auth_${index}`, { role: "driver", driverId: id, assignedBusId: "bus_1" }); state.mirrors[id] = { bus_1: { route_1: true } };
      state.liveNodes[`old_${String(index).padStart(4, "0")}`] = { busId: "bus_1", sessionId: `old_${index}`, timestamp: 1 };
    }
    state.liveNodes.keep = { busId: "bus_2", sessionId: "current" };
    const reply = await contractFetch(`${base}/api/fleet/buses/bus_1`, { method: "DELETE" });
    expect(reply.status).toBe(200); expect(state.docs.has("buses/bus_1")).toBe(false);
    expect([...state.docs.entries()].filter(([key]) => key.startsWith("drivers/")).every(([, data]) => data.assignedBusId === null)).toBe(true);
    expect(Object.keys(state.mirrors)).toHaveLength(0); expect(state.liveNodes).toEqual({ keep: { busId: "bus_2", sessionId: "current" } });
    expect(state.revocations).toBe(301); expect(state.maxAuth).toBeLessThanOrEqual(10);
  });
  it("exposes continuation without silently hiding the rest of a legacy reconciliation", async () => {
    for (let index = 0; index < 200; index++) state.docs.set(`drivers/more_${String(index).padStart(4, "0")}`, { authUid: `auth_${index}`, assignedBusId: "bus_1" });
    let cursor = ""; let checked = 0; let complete = false;
    do {
      const reply = await contractFetch(`${base}/api/fleet/reconcile${cursor ? `?cursor=${cursor}` : ""}`, { method: "POST" });
      expect(reply.status).toBe(200); checked += (await reply.json()).checked;
      complete = reply.headers.get("x-reconciliation-complete") === "true"; cursor = reply.headers.get("x-next-cursor") ?? "";
    } while (!complete);
    expect(checked).toBe(201);
  });
  it("blocks admin reassignment while a reconciliation page retains the Auth lock", async () => {
    let release!: () => void; state.gate = new Promise<void>(done => { release = done; });
    await post(); await vi.waitFor(() => expect(state.activeAuth).toBe(1));
    try {
      const blocked = await contractFetch(`${base}/api/fleet/drivers/driver_1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Driver", authUid: "auth_uid", assignedBusId: null }) });
      expect(blocked.status).toBe(409); expect(blocked.headers.get("retry-after")).toBe("1");
      expect(state.docs.get("drivers/driver_1")?.assignedBusId).toBe("bus_1");
    } finally { release(); await waitTerminal(); }
  });
  it("preserves a bus when a device is bound during paginated driver cleanup", async () => {
    let release!: () => void; state.gate = new Promise<void>(done => { release = done; });
    const request = contractFetch(`${base}/api/fleet/buses/bus_1`, { method: "DELETE" });
    await vi.waitFor(() => expect(state.activeAuth).toBe(1));
    state.docs.set("devices/new_install", { busId: "bus_1", routeId: "route_1" });
    release(); expect((await request).status).toBe(500);
    expect(state.docs.has("buses/bus_1")).toBe(true);
  });
  it("drains accepted fleet work while rejecting late mutation admission", async () => {
    let release!: () => void; state.gate = new Promise<void>(done => { release = done; });
    const accepted = contractFetch(`${base}/api/fleet/reconcile`, { method: "POST" });
    await vi.waitFor(() => expect(state.activeAuth).toBe(1));
    const draining = drainFleetMutations();
    try {
      const rejected = await contractFetch(`${base}/api/fleet/drivers/late_driver`, { method: "DELETE" });
      expect(rejected.status).toBe(503); expect(rejected.headers.get("retry-after")).toBe("1");
    } finally { release(); }
    expect((await accepted).status).toBe(200); await draining;
    expect(state.writes).toBe(1); expect(state.docs.has("_fleet_reconciliation_locks/singleton")).toBe(false);
  });
  it("drains accepted work and rejects new admissions during shutdown", async () => {
    let admit!: () => void; state.admissionGate = new Promise<void>(resolve => { admit = resolve; });
    let release!: () => void; state.gate = new Promise<void>(resolve => { release = resolve; });
    const pending = post();
    await vi.waitFor(() => expect(state.admissionStarted).toBe(true));
    let drained = false;
    const shutdown = drainHttpOperations().then(() => { drained = true; });
    expect((await post("shutdown_new_key_1")).status).toBe(503);
    expect(drained).toBe(false);
    admit(); expect((await pending).status).toBe(202);
    expect(drained).toBe(false);
    release(); await shutdown;
    expect(state.docs.get(`_fleet_reconciliation_jobs/${key}`)?.status).toBe("succeeded");
  });
});
