import express from "express";
import type { Server } from "node:http";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { getDatabase, type Database } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emulatorDatabaseUrl } from "./test-support/emulatorIsolation";
const state = vi.hoisted(() => ({ firestore: null as Firestore | null, realtime: null as Database | null }));
vi.mock("./lib/firebaseAdmin", () => ({
  db: { collection: (name: string) => state.firestore!.collection(name),
    runTransaction: (work: any, options: any) => state.firestore!.runTransaction(work, options),
    batch: () => state.firestore!.batch() },
  rtdb: { ref: (path: string) => state.realtime!.ref(path) }, auth: {},
}));
vi.mock("./lib/googleMaps", () => ({ computeRouteGeometry: () => { throw new Error("QA provider call forbidden"); }, LIVE_REROUTE_TIMEOUT_MS: 3500 }));
import devicesRouter from "./routes/devices";
import { hashDeviceSecret, invalidateDeviceCredentialCache } from "./services/deviceTelemetryService";
import { startTelemetryRouteWatcher, drainTelemetryRouteProcessing } from "./services/telemetryRouteService";
import { startTripStateEngine } from "./services/tripStateEngine";
import { startLiveBusProjection } from "./services/liveBusProjection";
import { createStaleBusSweeper } from "./services/staleBusSweeper";
import { WorkerFence, WORKER_LEASE_ID } from "./lib/workerFence";
import { encodePolyline } from "./lib/polylineUtils";

const integration = process.env.FIREBASE_RULES_TEST === "1" ? describe : describe.skip;
const device = "qa_device", bus = "qa_bus", route = "qa_route", session = "qa_session";
const secret = "synthetic-device-credential-only";
const node = `activeBuses/${bus}_${route}`;
const publicNode = `publicRouteBuses/route:${route}/buses/node:${bus}_${route}`;
const stops = [{ id: "origin", name: "Synthetic origin", lat: 23, lng: 72 },
  { id: "middle", name: "Synthetic middle", lat: 23.0018, lng: 72 },
  { id: "end", name: "Synthetic end", lat: 23.0036, lng: 72 }];

integration("authenticated telemetry to durable lifecycle and public emulator projection", () => {
  let app: App; let server: Server; let base: string; let epoch: number;
  let stopWatcher: (() => void) | undefined, stopEngine: (() => Promise<void>) | undefined, stopProjection: (() => Promise<void>) | undefined;
  const send = (payload: unknown, credential = secret) => fetch(`${base}/api/devices/${device}/telemetry`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Device ${credential}` },
    body: typeof payload === "string" ? payload : JSON.stringify(payload), signal: AbortSignal.timeout(10000), redirect: "error",
  });
  const fix = (seq: number, offset = 0, lat = 23) => ({ lat, lng: 72, speed: 30, heading: 0, gpsHdop: 1,
    motionState: "moving", seq, timestamp: epoch + offset, deviceSentAt: Date.now() });
  beforeAll(async () => {
    app = initializeApp({ projectId: "demo-eki-ingest-test", databaseURL: emulatorDatabaseUrl("demo-eki-ingest-test"),
      credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) } }, "qa-ingest");
    state.firestore = new Firestore({ projectId: "demo-eki-ingest-test", host: "127.0.0.1:8085", ssl: false });
    state.realtime = getDatabase(app);
    const web = express();
    web.use("/api/devices/:deviceId/telemetry", (_req, res, next) => { res.locals.telemetryServerReceivedAt = Date.now(); next(); });
    web.use("/api/devices/:deviceId/telemetry", express.json({ limit: "512b", strict: true }));
    web.use("/api/devices", devicesRouter);
    web.use((error: any, _req: any, res: any, next: any) => { void next; res.status(error.status ?? 500).json({ error: "Synthetic ingress failure" }); });
    server = await new Promise<Server>(resolve => { const listener = web.listen(0, "127.0.0.1", () => resolve(listener)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  beforeEach(async () => {
    epoch = Date.now() - 45000;
    for (const name of ["devices", "buses", "drivers", "routes", "ride_sessions", "active_rides", "completed_trips", "_active_bus_locks", "bus_locations", "_worker_leases"])
      await state.firestore!.recursiveDelete(state.firestore!.collection(name));
    await state.realtime!.ref().set(null); invalidateDeviceCredentialCache(device);
    await state.firestore!.collection("devices").doc(device).set({ busId: bus, routeId: route, enabled: true, secretHash: await hashDeviceSecret(secret) });
    await state.firestore!.collection("buses").doc(bus).set({ assignedRoutes: [route], active: true });
    await state.firestore!.collection("routes").doc(route).set({ stops, geometryVersion: 1, version: 1,
      forwardPolyline: encodePolyline(stops), reversePolyline: encodePolyline([...stops].reverse()) });
    await state.firestore!.collection("_worker_leases").doc(WORKER_LEASE_ID).set({ ownerId: "qa-worker", generation: 41, expiresAt: Timestamp.fromMillis(Date.now() + 300000) });
    const fence = new WorkerFence("qa-worker", 41, performance.now() + 300000);
    stopWatcher = startTelemetryRouteWatcher();
    stopEngine = fence.run(startTripStateEngine); stopProjection = fence.run(startLiveBusProjection);
  }, 30000);
  it("recovers a qualified terminal after actual stale deletion and a leader restart, exactly once", async () => {
    const driverId = "qa_terminal_driver";
    await state.firestore!.collection("drivers").doc(driverId).set({ assignedBusId: bus });
    const lifecycle = { busId: bus, routeId: route, driverId, sessionId: session, status: "active",
      tripState: "in_service", direction: "forward", currentStopIndex: 2, hasDepartedOrigin: true };
    await state.firestore!.collection("_active_bus_locks").doc(bus).set(lifecycle);
    await state.firestore!.collection("active_rides").doc(`${bus}_${route}`).set(lifecycle);
    await state.firestore!.collection("ride_sessions").doc(session).set({ ...lifecycle,
      stopsReached: { origin: "previously-observed", middle: "previously-observed" } });
    await state.realtime!.ref(node).set(lifecycle);
    const stopped = (seq: number) => ({ ...fix(seq, 0, stops[2].lat), motionState: "stopped", speed: 0,
      timestamp: Date.now(), deviceSentAt: Date.now() });
    expect((await send(stopped(1))).status).toBe(202);
    await vi.waitFor(async () => expect((await state.realtime!.ref(node).get()).val()?.terminalArrival).toBeTruthy(), { timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 2100));
    expect((await send(stopped(2))).status).toBe(202);
    await vi.waitFor(async () => expect((await state.firestore!.collection("ride_sessions").doc(session).get()).data()?.status).toBe("completed"), { timeout: 10000 });
    const checkpoint = (await state.firestore!.collection("bus_locations").doc(bus).get()).data()!.terminalJourney;
    expect(checkpoint).toMatchObject({ sessionId: session, direction: "forward", consumedBy: null });
    await stopEngine!(); stopEngine = undefined;
    await state.realtime!.ref(node).update({ timestamp: Date.now() - 301_000 });
    const sweepErrors: unknown[] = [];
    const sweeper = createStaleBusSweeper(state.realtime!.ref("activeBuses"), 300_000, error => sweepErrors.push(error));
    await sweeper.tick(); sweeper.stop();
    expect(sweepErrors).toEqual([]);
    expect((await state.realtime!.ref(node).get()).exists()).toBe(false);
    const remainingWait = checkpoint.turnaroundEligibleAt - Date.now();
    if (remainingWait >= 0) await new Promise(resolve => setTimeout(resolve, remainingWait + 50));
    stopEngine = new WorkerFence("qa-worker", 41, performance.now() + 300000).run(startTripStateEngine);
    expect((await send(stopped(3))).status).toBe(202);
    await vi.waitFor(async () => expect((await state.realtime!.ref(node).get()).val()).toMatchObject({
      direction: "reverse", tripState: "pre_departure", previousSessionId: session,
    }), { timeout: 15000 });
    expect((await send(stopped(4))).status).toBe(202);
    await vi.waitFor(async () => expect((await state.realtime!.ref(publicNode).get()).val()).toMatchObject({
      direction: "reverse", tripState: "pre_departure", previousSessionId: session,
    }), { timeout: 10000 });
    const sessions = await state.firestore!.collection("ride_sessions").get();
    expect(sessions.docs.filter(doc => doc.data().previousSessionId === session)).toHaveLength(1);
    const returnSession = sessions.docs.find(doc => doc.data().previousSessionId === session)!;
    expect(returnSession.data().status).toBe("armed");
    expect((await state.firestore!.collection("bus_locations").doc(bus).get()).data()!.terminalJourney.consumedBy).toBe(returnSession.id);
  }, 75000);
  afterEach(async () => {
    await drainTelemetryRouteProcessing();
    await stopEngine?.(); await stopProjection?.(); stopWatcher?.();
    stopEngine = undefined; stopProjection = undefined; stopWatcher = undefined;
  }, 30000);
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    await state.firestore?.terminate(); if (app) await deleteApp(app);
    const guard = (globalThis as any).__ekiQaNetworkGuard;
    expect(guard.enabled).toBe(true); expect(guard.allowedConnections).toBeGreaterThan(0); expect(guard.deniedConnections).toBe(0);
    console.log("QA_INGEST_TRANSPORT", JSON.stringify(guard));
  });
  it("rejects invalid credentials authority fields and original oversized bytes without a live write", async () => {
    expect((await send(fix(1), "synthetic-wrong-device-credential")).status).toBe(401);
    expect((await send({ ...fix(1), busId: "forged" })).status).toBe(400);
    const body = JSON.stringify(fix(1));
    expect((await send(body + " ".repeat(513 - Buffer.byteLength(body)))).status).toBe(413);
    expect((await state.realtime!.ref(node).get()).exists()).toBe(false);
    expect((await state.firestore!.collection("ride_sessions").get()).empty).toBe(true);
  }, 30000);
  it("publishes valid device presence without fabricating passenger service", async () => {
    const response = await send(fix(1)); expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, duplicate: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Number(response.headers.get("x-eki-server-responded-at"))).toBeGreaterThanOrEqual(Number(response.headers.get("x-eki-server-received-at")));
    await vi.waitFor(async () => expect((await state.realtime!.ref(publicNode).get()).val()).toMatchObject({ busId: bus, routeId: route, deviceState: "online", seq: 1 }), { timeout: 15000 });
    const live = (await state.realtime!.ref(node).get()).val();
    expect(live.status).toBe("offline"); expect(live.sessionId).toBeUndefined();
    expect((await state.firestore!.collection("ride_sessions").get()).empty).toBe(true);
    expect(JSON.stringify((await state.realtime!.ref(publicNode).get()).val())).not.toContain("plausibilityAnchor");
  }, 30000);
  it("preserves durable ride identity through HTTP duplicate and delayed older fixes", async () => {
    const ride = { busId: bus, routeId: route, driverId: "qa_driver", sessionId: session,
      status: "armed", direction: "forward", currentStopIndex: 0 };
    await state.firestore!.collection("ride_sessions").doc(session).set(ride);
    await state.firestore!.collection("_active_bus_locks").doc(bus).set({ sessionId: session, routeId: route, driverId: "qa_driver", direction: "forward" });
    await state.realtime!.ref(node).set({ ...ride, status: "active", tripState: "pre_departure", directionState: "resolved", hasDepartedOrigin: false });
    const first = fix(1); expect((await send(first)).status).toBe(202);
    expect((await send(first)).status).toBe(200);
    const newer = fix(2, 30000, 23.0015); expect((await send(newer)).status).toBe(202);
    const delayed = fix(99, 1000, 23.00001); expect((await send(delayed)).status).toBe(200);
    await vi.waitFor(async () => expect((await state.realtime!.ref(publicNode).get()).val()).toMatchObject({ sessionId: session, seq: 2, timestamp: newer.timestamp }), { timeout: 15000 });
    const current = (await state.realtime!.ref(node).get()).val();
    expect(current).toMatchObject({ sessionId: session, rawLocation: { seq: 2, sampledAt: newer.timestamp }, lat: newer.lat });
    await vi.waitFor(async () => expect((await state.firestore!.collection("ride_sessions").doc(session).get()).data()?.status).toBe("active"), { timeout: 15000 });
    expect((await state.firestore!.collection("_active_bus_locks").doc(bus).get()).data()?.sessionId).toBe(session);
    expect((await state.firestore!.collection("ride_sessions").get()).size).toBe(1);
  }, 30000);
});
