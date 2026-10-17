import { Firestore } from "firebase-admin/firestore";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getDatabase, type Database } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePolyline } from "./lib/polylineUtils";
const state = vi.hoisted(() => ({ firestore: null as Firestore | null, realtime: null as Database | null, reads: 0, snapshots: 0, version: 0, paused: false, failAck: false, pending: [] as Array<() => void>, compute: vi.fn() }));
vi.mock("./lib/firebaseAdmin", () => ({ db: { collection: (name: string) => {
  const collection = state.firestore!.collection(name);
  return { doc: (id: string) => { const ref = collection.doc(id); if (name === "routes") { const get = ref.get.bind(ref); ref.get = async () => { state.reads++; return get(); }; } return ref; },
    onSnapshot: (next: any, fail: any) => collection.onSnapshot(snapshot => { const deliver = () => { next(snapshot); state.snapshots++; state.version = snapshot.docs[0]?.data().geometryVersion ?? 0; }; if (state.paused) state.pending.push(deliver); else deliver(); }, fail) };
}, runTransaction: async (work: any) => { const loseAck = state.failAck; state.failAck = false; const result = await state.firestore!.runTransaction(work); if (loseAck) throw Error("Synthetic lost acknowledgement after actual commit"); return result; } }, rtdb: { ref: (path: string) => state.realtime!.ref(path) } }));
vi.mock("./lib/googleMaps", () => ({ computeRouteGeometry: state.compute, LIVE_REROUTE_TIMEOUT_MS: 3500 }));
import { startTelemetryRouteWatcher, scheduleTelemetryRouteProcessing, drainTelemetryRouteProcessing } from "./services/telemetryRouteService";
import { readRouteGeometryDocument, invalidateRouteGeometryRead } from "./services/routeGeometryReads";
const integration = process.env.FIREBASE_RULES_TEST === "1" ? describe : describe.skip;
integration("versioned telemetry catalog against actual Firebase emulators", () => {
  let app: App, stop: (() => void) | undefined;
  beforeAll(async () => {
    for (const host of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_DATABASE_EMULATOR_HOST]) if (!host || !/^(127\.0\.0\.1|\[::1\]):\d+$/.test(host)) throw Error("Both loopback emulators required");
    app = initializeApp({ projectId: "demo-eki-catalog-test", databaseURL: "http://127.0.0.1:9005/?ns=demo-eki-catalog-test-default-rtdb", credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) } }, "catalog-integration");
    state.firestore = new Firestore({ projectId: "demo-eki-catalog-test", host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false }); state.realtime = getDatabase(app);
  });
  beforeEach(async () => {
    // This suite measures catalog reads/invalidation without provider work.
    // Departure refresh is tested separately with the feature enabled.
    vi.stubEnv("LIVE_DEPARTURE_ROUTES_ENABLED", "false");
    invalidateRouteGeometryRead();
    state.reads = 0; state.snapshots = 0; state.version = 0; state.paused = false; state.pending = []; state.failAck = false; state.compute.mockReset();
    for (const name of ["routes", "ride_sessions", "_active_bus_locks"]) {
      const docs = await state.firestore!.collection(name).get(); const batch = state.firestore!.batch(); docs.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit();
    }
    await state.realtime!.ref().set(null);
  });
  afterEach(async () => { stop?.(); stop = undefined; await drainTelemetryRouteProcessing(); vi.unstubAllEnvs(); });
  afterAll(async () => { await state.firestore?.terminate(); if (app) await deleteApp(app); });
  it("coalesces passenger document reads and invalidates them on actual streamed edits/deletions", async () => {
    const ref = state.firestore!.collection("routes").doc("route"); await ref.set({ geometryVersion: 1 });
    stop = startTelemetryRouteWatcher(); await vi.waitFor(() => expect(state.version).toBe(1));
    const reads = await Promise.all(Array.from({ length: 32 }, () => readRouteGeometryDocument("route")));
    expect(reads.every(row => row.data?.geometryVersion === 1)).toBe(true); expect(state.reads).toBe(1);
    await ref.set({ geometryVersion: 2 }); await vi.waitFor(() => expect(state.version).toBe(2));
    expect((await readRouteGeometryDocument("route")).data?.geometryVersion).toBe(2); expect(state.reads).toBe(2);
    await ref.delete(); await vi.waitFor(() => expect(state.version).toBe(0));
    expect((await readRouteGeometryDocument("route")).exists).toBe(false); expect(state.reads).toBe(3);
    expect(state.compute).not.toHaveBeenCalled();
  }, 30000);
  it("uses streamed route data for sixty pending fixes, then observes edited/deleted endpoints without Google", async () => {
    const id = "route", ref = state.firestore!.collection("routes").doc(id);
    const stops = [{ id: "A", lat: 23, lng: 72 }, { id: "B", lat: 23.1, lng: 72.1 }];
    const route = (points: typeof stops, version: number) => ({ stops: points, forwardPolyline: encodePolyline(points), reversePolyline: encodePolyline([...points].reverse()), version, geometryVersion: version });
    await ref.set(route(stops, 1)); stop = startTelemetryRouteWatcher(); await vi.waitFor(() => expect(state.version).toBe(1));
    const publish = async (seq: number, position = { lat: 24, lng: 73 }, extra: Record<string, unknown> = {}) => {
      const sample = { ...position, speed: 0, heading: 0, motionState: "stopped" as const, gpsHdop: 1, seq, timestamp: Date.now(), deviceSentAt: Date.now() };
      await state.realtime!.ref("activeBuses/bus_route").set({ busId: "bus", routeId: id, direction: null, directionState: "pending", ...sample, ...extra });
      scheduleTelemetryRouteProcessing({ busId: "bus", routeId: id }, sample); await drainTelemetryRouteProcessing();
    };
    for (let seq = 1; seq <= 60; seq++) await publish(seq);
    expect(state.reads).toBe(0); expect(state.compute).not.toHaveBeenCalled();
    const changed = [{ id: "C", lat: 24, lng: 73 }, { id: "D", lat: 24.1, lng: 73.1 }];
    await ref.set(route(changed, 2)); await vi.waitFor(() => expect(state.version).toBe(2)); await publish(61, changed[0]);
    expect((await state.realtime!.ref("activeBuses/bus_route").get()).val()).toMatchObject({ direction: "forward", originStopId: "C", destinationStopId: "D" });
    await state.firestore!.collection("ride_sessions").doc("session").set({ busId: "bus", routeId: id, driverId: "driver", status: "armed", direction: null });
    await state.firestore!.collection("_active_bus_locks").doc("bus").set({ sessionId: "session", direction: null });
    await publish(62, changed[0], { sessionId: "session", driverId: "driver", status: "active", tripState: "pre_departure", directionFirestoreSynced: false });
    expect((await state.firestore!.collection("ride_sessions").doc("session").get()).data()).toMatchObject({ status: "armed", direction: "forward", originStopId: "C", destinationStopId: "D" });
    expect((await state.realtime!.ref("activeBuses/bus_route").get()).val()).toMatchObject({ sessionId: "session", direction: "forward", directionFirestoreSynced: true });
    await ref.delete(); await vi.waitFor(() => expect(state.version).toBe(0)); await publish(63, changed[0]);
    expect((await state.realtime!.ref("activeBuses/bus_route").get()).val().direction).toBeUndefined(); expect(state.reads).toBe(0); expect(state.compute).not.toHaveBeenCalled();
  }, 30000);
  it("refuses obsolete durable direction while watcher delivery is delayed", async () => {
    const id = "route", ref = state.firestore!.collection("routes").doc(id);
    const old = [{ id: "A", lat: 23, lng: 72 }, { id: "B", lat: 23.1, lng: 72.1 }];
    const changed = [{ id: "C", lat: 24, lng: 73 }, { id: "D", lat: 24.1, lng: 73.1 }];
    await ref.set({ stops: old, forwardPolyline: encodePolyline(old), reversePolyline: encodePolyline([...old].reverse()), version: 3, geometryVersion: 3 });
    stop = startTelemetryRouteWatcher(); await vi.waitFor(() => expect(state.version).toBe(3));
    await state.firestore!.collection("ride_sessions").doc("old-session").set({ busId: "bus", routeId: id, driverId: "driver", status: "armed", direction: null });
    await state.firestore!.collection("_active_bus_locks").doc("bus").set({ sessionId: "old-session", direction: null });
    state.paused = true;
    try {
      await ref.set({ stops: changed, forwardPolyline: encodePolyline(changed), reversePolyline: encodePolyline([...changed].reverse()), version: 4, geometryVersion: 4 });
      const sample = { ...old[0], speed: 0, heading: 0, motionState: "stopped" as const, gpsHdop: 1, seq: 1, timestamp: Date.now(), deviceSentAt: Date.now() };
      await state.realtime!.ref("activeBuses/bus_route").set({ busId: "bus", routeId: id, sessionId: "old-session", driverId: "driver", status: "active", tripState: "pre_departure", directionState: "pending", directionFirestoreSynced: false, ...sample });
      scheduleTelemetryRouteProcessing({ busId: "bus", routeId: id }, sample); await drainTelemetryRouteProcessing();
      expect((await state.firestore!.collection("ride_sessions").doc("old-session").get()).data()?.direction).toBeNull();
      expect((await state.realtime!.ref("activeBuses/bus_route").get()).val()).toMatchObject({ directionState: "pending", directionFirestoreSynced: false });
      expect((await state.realtime!.ref("activeBuses/bus_route").get()).val().direction).toBeUndefined();
    } finally { state.paused = false; for (const deliver of state.pending.splice(0)) deliver(); }
  }, 30000);
  it("recovers a real durable direction commit with a lost acknowledgement without rolling it back", async () => {
    const points = [{ id: "C", lat: 24, lng: 73 }, { id: "D", lat: 24.1, lng: 73.1 }];
    await state.firestore!.collection("routes").doc("route").set({ stops: points, forwardPolyline: encodePolyline(points), reversePolyline: encodePolyline([...points].reverse()), version: 4, geometryVersion: 4 });
    stop = startTelemetryRouteWatcher(); await vi.waitFor(() => expect(state.version).toBe(4));
    await state.firestore!.collection("ride_sessions").doc("lost-ack").set({ busId: "bus", routeId: "route", driverId: "driver", status: "armed", direction: null });
    await state.firestore!.collection("_active_bus_locks").doc("bus").set({ sessionId: "lost-ack", direction: null });
    const sample = (seq: number) => ({ ...points[0], speed: 0, heading: 0, motionState: "stopped" as const, gpsHdop: 1, seq, timestamp: Date.now(), deviceSentAt: Date.now() });
    let fix = sample(1); state.failAck = true;
    await state.realtime!.ref("activeBuses/bus_route").set({ busId: "bus", routeId: "route", sessionId: "lost-ack", driverId: "driver", status: "active", tripState: "pre_departure", directionState: "pending", directionFirestoreSynced: false, ...fix });
    scheduleTelemetryRouteProcessing({ busId: "bus", routeId: "route" }, fix); await drainTelemetryRouteProcessing();
    expect((await state.firestore!.collection("ride_sessions").doc("lost-ack").get()).data()).toMatchObject({ direction: "forward", originStopId: "C", destinationStopId: "D" });
    const provisional = (await state.realtime!.ref("activeBuses/bus_route").get()).val();
    expect(provisional).toMatchObject({ direction: "forward", directionFirestoreSynced: false });
    fix = sample(2); await state.realtime!.ref("activeBuses/bus_route").set({ ...provisional, ...fix });
    scheduleTelemetryRouteProcessing({ busId: "bus", routeId: "route" }, fix); await drainTelemetryRouteProcessing();
    expect((await state.realtime!.ref("activeBuses/bus_route").get()).val()).toMatchObject({ sessionId: "lost-ack", direction: "forward", directionFirestoreSynced: true, seq: 2 });
  }, 30000);

});
