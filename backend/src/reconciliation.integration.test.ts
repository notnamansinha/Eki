import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { getDatabase, type Database } from "firebase-admin/database";
const state = vi.hoisted(() => ({ firestore: null as Firestore | null, realtime: null as Database | null,
  claims: new Map<string, Record<string, unknown>>(), active: 0, maximum: 0 }));
vi.mock("./lib/firebaseAdmin", () => ({
  db: { collection: (name: string) => state.firestore!.collection(name), runTransaction: (work: any) => state.firestore!.runTransaction(work) },
  rtdb: { ref: (path: string) => state.realtime!.ref(path) },
  // Never make live Auth calls. Firestore and RTDB below are actual loopback SDKs.
  auth: { getUser: async (uid: string) => {
    state.active++; state.maximum = Math.max(state.maximum, state.active);
    try { await new Promise(done => setTimeout(done, 1)); return { customClaims: state.claims.get(uid) ?? {} }; }
    finally { state.active--; }
  }, setCustomUserClaims: async (uid: string, value: Record<string, unknown>) => { state.claims.set(uid, value); }, revokeRefreshTokens: async () => {} },
}));
import { runAbandonedRideReconciliation } from "./services/abandonedRideReconciler";
vi.mock("./middleware/requireAdmin", () => ({ requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next() }));
import fleetRouter, { reconcileFleetAuthorization, drainFleetMutations } from "./routes/fleet";
const integration = process.env.FIREBASE_RULES_TEST === "1" ? describe : describe.skip;
integration("bounded reconciliation against actual Firebase emulators", () => {
  let app: App; let server: Server; let base: string;
  beforeAll(async () => {
    for (const host of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_DATABASE_EMULATOR_HOST]) {
      if (!host || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) throw Error("Both loopback emulators required");
    }
    // Separate namespace avoids interference with rules/fencing/crash suites.
    app = initializeApp({ projectId: "eki-reconciliation-test", databaseURL: "https://eki-reconciliation-test-default-rtdb.firebaseio.com",
      credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) } }, "reconciliation-integration");
    state.firestore = new Firestore({ projectId: "eki-reconciliation-test", host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
    state.realtime = getDatabase(app);
    const http = express(); http.use(express.json()); http.use("/api/fleet", fleetRouter);
    server = await new Promise<Server>(done => { const listener = http.listen(0, "127.0.0.1", () => done(listener)); });
    const address = server.address(); if (!address || typeof address === "string") throw Error("No address");
    base = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(async () => {
    await drainFleetMutations(false);
    for (const name of ["ride_sessions", "active_rides", "_active_bus_locks", "drivers", "buses", "_fleet_reconciliation_locks", "devices", "routes", "_fleet_operations", "bus_locations"]) {
      const docs = await state.firestore!.collection(name).get();
      for (let index = 0; index < docs.size; index += 400) {
        const batch = state.firestore!.batch(); docs.docs.slice(index, index + 400).forEach(doc => batch.delete(doc.ref)); await batch.commit();
      }
    }
    await state.realtime!.ref().set(null); state.claims.clear(); state.maximum = 0;
  });
  afterAll(async () => { await drainFleetMutations(false); await new Promise<void>(done => server.close(() => done())); await state.firestore?.terminate(); if (app) await deleteApp(app); });
  it("interrupts 201 stale sessions through mutating cursors and preserves newer/unknown lifecycles", async () => {
    const now = Date.now(), old = now - 14 * 60 * 60 * 1000;
    const batch = state.firestore!.batch(); const live: Record<string, unknown> = {};
    for (let index = 0; index < 203; index++) {
      const id = `session_${String(index).padStart(4, "0")}`, busId = `bus_${index}`, key = `${busId}_route`;
      batch.set(state.firestore!.collection("ride_sessions").doc(id), { busId, routeId: "route", status: "active", updatedAt: old });
      if (index < 201) {
        batch.set(state.firestore!.collection("active_rides").doc(key), { busId, sessionId: id, updatedAt: old });
        live[key] = { busId, sessionId: id, timestamp: old };
      } else if (index === 201) {
        batch.set(state.firestore!.collection("active_rides").doc(key), { busId, sessionId: id, updatedAt: now });
        live[key] = { busId, sessionId: "newer-session", timestamp: now };
      } else live[key] = { busId, sessionId: id }; // Unknown activity is protected.
    }
    await batch.commit(); await state.realtime!.ref("activeBuses").set(live);
    let cursor: string | undefined; let total = 0; let interrupted = 0;
    do {
      const page = await runAbandonedRideReconciliation({ firestore: state.firestore!, realtimeDatabase: state.realtime!, now, cursor });
      expect(page.scanned).toBeLessThanOrEqual(100); total += page.scanned; interrupted += page.interruptedIds.length; cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(total).toBe(203); expect(interrupted).toBe(201);
    expect((await state.firestore!.collection("active_rides").get()).size).toBe(1);
    expect((await state.firestore!.collection("ride_sessions").doc("session_0200").get()).data()?.status).toBe("interrupted");
    expect((await state.realtime!.ref("activeBuses").get()).val()).toEqual({ bus_201_route: live.bus_201_route, bus_202_route: live.bus_202_route });
    // The checkpoint remains valid after earlier candidates disappear from the query.
    expect((await runAbandonedRideReconciliation({ firestore: state.firestore!, realtimeDatabase: state.realtime!, now, cursor: "session_0199" })).scanned).toBe(2);
  }, 60000);
  it("visits 1001 drivers with bounded real queries and targeted RTDB repair; Auth is synthetic", async () => {
    await state.firestore!.collection("buses").doc("bus").set({ assignedRoutes: ["route"] });
    for (let start = 0; start < 1001; start += 400) {
      const batch = state.firestore!.batch();
      for (let index = start; index < Math.min(start + 400, 1001); index++) batch.set(state.firestore!.collection("drivers").doc(`driver_${String(index).padStart(4, "0")}`), { authUid: `auth_${index}`, assignedBusId: "bus" });
      await batch.commit();
    }
    let cursor: string | undefined; const visited = new Set<string>();
    do {
      const page = await reconcileFleetAuthorization(Date.now() + 30000, null, undefined, cursor);
      expect(page.records.length).toBeLessThanOrEqual(100); expect(page.failed).toBe(0);
      page.records.forEach(record => visited.add(record.driverId)); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(visited.size).toBe(1001); expect(state.maximum).toBeLessThanOrEqual(10);
    expect(Object.keys((await state.realtime!.ref("driverRouteAssignments").get()).val())).toHaveLength(1001);
    expect((await state.firestore!.collection("_fleet_reconciliation_locks").doc("singleton").get()).exists).toBe(false);
  }, 60000);
  it("rejects a conflicting 301st device and deletes all 201 inactive RTDB nodes through real SDK transactions", async () => {
    const bus = state.firestore!.collection("buses").doc("bus");
    await bus.set({ assignedRoutes: ["route", "other"] }); await state.firestore!.collection("routes").doc("route").set({ name: "Route" });
    const batch = state.firestore!.batch();
    for (let index = 0; index < 301; index++) batch.set(state.firestore!.collection("devices").doc(`device_${String(index).padStart(4, "0")}`), { busId: "bus", routeId: index === 300 ? "other" : "route" });
    await batch.commit();
    const response = await fetch(`${base}/api/fleet/buses/bus`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Bus", assignedRoutes: ["route"] }) });
    expect(response.status).toBe(409); await response.json(); await drainFleetMutations(false);
    expect((await bus.get()).data()?.assignedRoutes).toEqual(["route", "other"]);
    const cleanup = state.firestore!.batch(); (await state.firestore!.collection("devices").get()).docs.forEach(doc => cleanup.delete(doc.ref)); await cleanup.commit();
    const nodes = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`old_${String(index).padStart(4, "0")}`, { busId: "bus", timestamp: index }]));
    await state.realtime!.ref("activeBuses").set({ ...nodes, keep: { busId: "another" } });
    const deleted = await fetch(`${base}/api/fleet/buses/bus`, { method: "DELETE" });
    expect(deleted.status).toBe(200); await deleted.json(); await drainFleetMutations(false);
    expect((await state.realtime!.ref("activeBuses").get()).val()).toEqual({ keep: { busId: "another" } });
    expect((await bus.get()).exists).toBe(false);
  }, 60000);

  it("preserves timestamp and nested bus metadata through real merge transforms, including first creation", async () => {
    const bus = state.firestore!.collection("buses").doc("bus");
    const createdAt = Timestamp.fromMillis(123000);
    const metadata = { inspections: { lastAt: Timestamp.fromMillis(456000), passed: true }, tags: ["accessible"] };
    await bus.set({ name: "Before", assignedRouteId: "legacy", createdAt, metadata });
    await state.firestore!.collection("routes").doc("route").set({ name: "Route" });
    const save = (id: string, body: unknown) => fetch(`${base}/api/fleet/buses/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const edited = await save("bus", { name: "After", assignedRoutes: ["route"], metadata: { injected: true }, createdAt: 999 });
    expect(edited.status).toBe(200); expect(await edited.json()).toEqual({ saved: true });
    expect((await bus.get()).data()).toEqual({ id: "bus", name: "After", assignedRoutes: ["route"], createdAt, metadata });
    const created = await save("new_bus", { name: "New", assignedRoutes: [], createdAt: 999 });
    expect(created.status).toBe(200); await created.json();
    expect((await state.firestore!.collection("buses").doc("new_bus").get()).data()).toEqual({ id: "new_bus", name: "New", assignedRoutes: [] });
  });

});
