import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import type { Server } from "node:http";
import { Firestore } from "@google-cloud/firestore";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getDatabase, type Database } from "firebase-admin/database";
import { contractFetch } from "../test-support/openapi";
const state = vi.hoisted(() => ({ firestore: null as Firestore | null, realtime: null as Database | null, aggregateCalls: 0, readTimes: [] as string[] }));
vi.mock("./lib/firebaseAdmin", () => ({ db: {
  collection: (name: string) => state.firestore!.collection(name),
  runTransaction: (work: any, options: any) => state.firestore!.runTransaction(async transaction => work({
    get: (query: any) => { state.aggregateCalls++; return transaction.get(query).then(result => { const time = result.readTime; state.readTimes.push(`${time.seconds}:${time.nanoseconds}`); return result; }); },
  }), options),
}, rtdb: { ref: (path: string) => state.realtime!.ref(path) } }));
vi.mock("./middleware/requireAdmin", () => ({ requireAdmin: (req: any, res: any, next: any) => {
  if (req.get("Authorization") === "Bearer admin") next(); else res.status(403).json({ error: "Admin required" });
} }));
vi.mock("./middleware/requireAuth", () => ({ requireAuth: (req: any, res: any, next: any) => {
  if (req.get("Authorization") === "Bearer reader") next(); else res.status(401).json({ error: "Authentication required" });
} }));
import analytics, { analyticsCache } from "./routes/analytics";
import catalog, { routesCollectionRoutes } from "./routes/routesList";
import buses from "./routes/buses";
import { routeListCache } from "./services/apiReadCache";
const integration = process.env.FIREBASE_RULES_TEST === "1" ? describe : describe.skip;
integration("R20 API reads against actual loopback Firebase", () => {
  let app: App; let server: Server; let base = "";
  beforeAll(async () => {
    for (const host of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_DATABASE_EMULATOR_HOST]) {
      if (!host || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) throw Error("Both loopback emulators required");
    }
    app = initializeApp({ projectId: "eki-r20-test", databaseURL: "https://eki-r20-test-default-rtdb.firebaseio.com",
      credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) } }, "r20-integration");
    state.firestore = new Firestore({ projectId: "eki-r20-test", host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
    state.realtime = getDatabase(app);
    const rules = await fetch(`http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}/.settings/rules.json?ns=eki-r20-test-default-rtdb`, {
      method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: readFileSync(resolve(__dirname, "../../database.rules.json"), "utf8"),
    });
    if (!rules.ok) throw Error(`Failed to install isolated loopback RTDB indexes: ${rules.status}`);
    const web = express(); web.use("/api/analytics", analytics); web.use("/api/routes-list", catalog);
    web.use("/api/v2/routes", routesCollectionRoutes); web.use("/api/buses", buses);
    server = await new Promise<Server>(resolve => { const listener = web.listen(0, "127.0.0.1", () => resolve(listener)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    // Only this disposable project is touched, never a configured application.
    if (state.firestore) { for (const collection of ["bus_locations", "completed_trips", "routes"]) await state.firestore.recursiveDelete(state.firestore.collection(collection)); await state.firestore.terminate(); }
    if (state.realtime) await state.realtime.ref("activeBuses").set(null);
    if (app) await deleteApp(app);
  });
  const read = (path: string, token = "admin") => contractFetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  it("uses six consistent aggregates, deduplicates repeat writes and preserves sample labels", async () => {
    for (let offset = 0; offset < 1200; offset += 400) {
      const batch = state.firestore!.batch();
      for (let i = offset; i < offset + 400; i++) batch.set(state.firestore!.collection("completed_trips").doc(`trip_${String(i).padStart(4, "0")}`),
        { ...(i % 3 === 2 ? {} : { direction: i % 3 === 0 ? "forward" : "reverse" }), secretPayload: "x".repeat(1000) });
      await batch.commit();
    }
    const fleet = state.firestore!.batch();
    for (let i = 0; i < 10; i++) fleet.set(state.firestore!.collection("bus_locations").doc(`bus_${i}`), {
      status: i < 7 ? "active" : "offline", deviceState: i < 3 ? "offline" : "online", motionState: i < 4 ? "uncertain" : "moving",
    });
    await fleet.commit();
    const original = await Promise.all([state.firestore!.collection("bus_locations").limit(1000).get(), state.firestore!.collection("completed_trips").limit(1000).get()]);
    const baselineRows = original.reduce((sum, result) => sum + result.size, 0);
    const baselineBytes = Buffer.byteLength(JSON.stringify(original.flatMap(result => result.docs.map(doc => doc.data()))));
    analyticsCache.invalidate(); state.aggregateCalls = 0; state.readTimes = [];
    const responses = await Promise.all(Array.from({ length: 32 }, () => read("/api/analytics/fleet?scope=all")));
    for (const response of responses) expect(await response.json()).toMatchObject({ totalBuses: 10, activeBuses: 7, idleBuses: 3,
      signalLostBuses: 4, completedTripsByDirection: { forward: 400, reverse: 400, unresolved: 400, total: 1200, sampleLimit: null }, statistics: { sampled: false } });
    expect(state.aggregateCalls).toBe(6); expect(new Set(state.readTimes).size).toBe(1); const burstQueries = state.aggregateCalls;
    expect((await read("/api/analytics/fleet?scope=all", "reader")).status).toBe(403);
    const sample = await read("/api/analytics/fleet"); expect(await sample.json()).toMatchObject({ completedTripsByDirection: { total: 1000, sampleLimit: 1000 }, statistics: { sampled: true } });
    const trip = state.firestore!.collection("completed_trips").doc("trip_0000");
    await trip.set({ direction: "forward" }); await trip.set({ direction: "forward" });
    analyticsCache.invalidate(); expect((await (await read("/api/analytics/fleet?scope=all")).json()).completedTripsByDirection.total).toBe(1200);
    await trip.delete(); analyticsCache.invalidate();
    expect((await (await read("/api/analytics/fleet?scope=all")).json()).completedTripsByDirection).toMatchObject({ total: 1199, forward: 399 });
    process.stdout.write(`R20_READ_MEASUREMENT ${JSON.stringify({ concurrentRequests: 32, baselineDocumentRowsPerRequest: baselineRows, baselineSnapshotJsonBytes: baselineBytes, aggregateQueriesForBurst: burstQueries, fullTripCount: 1200 })}\n`);
  }, 30000);
  it("pages compact catalogs across aliases and observes explicit invalidation on edit/deletion", async () => {
    const batch = state.firestore!.batch();
    for (let i = 0; i < 260; i++) batch.set(state.firestore!.collection("routes").doc(`route_${String(i).padStart(3, "0")}`), { name: `Route ${i}`, color: "blue", stops: [], polyline: "secret-geometry" });
    await batch.commit(); routeListCache.invalidate();
    const first = await read("/api/v2/routes?limit=250", "reader"); const body = await first.json();
    expect(body.routes).toHaveLength(250); expect(body.nextCursor).toBe("route_249");
    expect(JSON.stringify(body)).not.toContain("secret-geometry");
    expect(await (await read("/api/routes-list?limit=250", "reader")).json()).toEqual(body);
    expect((await (await read(`/api/v2/routes?limit=250&after=${body.nextCursor}`, "reader")).json()).routes).toHaveLength(10);
    expect((await read("/api/v2/routes?limit=250")).status).toBe(401);
    const ref = state.firestore!.collection("routes").doc("route_000"); await ref.update({ name: "Edited" }); routeListCache.invalidate();
    expect((await (await read("/api/v2/routes?limit=1", "reader")).json()).routes[0].name).toBe("Edited");
    await ref.delete(); routeListCache.invalidate();
    expect((await (await read("/api/v2/routes?limit=1", "reader")).json()).routes[0].id).toBe("route_001");
    expect((await read("/api/v2/routes?limit=251", "reader")).status).toBe(400);
  }, 30000);
  it("uses route-local live pages and bounded indexed point lookups without omitting compatibility fleet results", async () => {
    const rows: Record<string, unknown> = {};
    for (let i = 0; i < 260; i++) rows[`bus_${String(i).padStart(3, "0")}_route`] = { busId: `bus_${i}`, routeId: i < 255 ? "route_a" : "route_b", lat: 23, lng: 72 };
    await state.realtime!.ref("activeBuses").set(rows);
    const first = await (await read("/api/buses?routeId=route_a&limit=250", "reader")).json();
    expect(first.buses).toHaveLength(250); expect(first.buses.every((bus: any) => bus.routeId === "route_a")).toBe(true);
    const rest = await (await read(`/api/buses?routeId=route_a&limit=250&after=${first.nextCursor}`, "reader")).json();
    expect(rest.buses).toHaveLength(5); expect(rest.nextCursor).toBeNull();
    expect((await (await read("/api/buses", "reader")).json()).buses).toHaveLength(260);
    expect(await (await read("/api/buses/bus_0", "reader")).json()).toMatchObject({ busId: "bus_0" });
    await state.realtime!.ref("activeBuses/bus_000_route").remove();
    expect((await read("/api/buses/bus_0", "reader")).status).toBe(404);
    expect((await read("/api/buses?routeId=route_a")).status).toBe(401);
  }, 30000);
});
