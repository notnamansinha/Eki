import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePolyline } from "../lib/polylineUtils";

// In-memory adapters for the real ingestion, trip engine, recovery, projection
// and routing modules. Transactions serialize commits; no provider/network IO.
const state = vi.hoisted(() => ({
  docs: new Map<string, any>(), nodes: new Map<string, any>(),
  listeners: new Map<string, Set<(snapshot: any) => void>>(),
  tail: Promise.resolve() as Promise<unknown>, id: 0, compute: vi.fn(),
  reads: [] as string[],
}));
vi.mock("../lib/firebaseAdmin", () => {
  const snapshot = (path: string) => ({ key: path.split("/").at(-1), ref: ref(path),
    exists: () => state.nodes.has(path), val: () => state.nodes.get(path) ?? null });
  function publish(path: string, value: any) {
    const old = state.nodes.get(path);
    if (value === null) state.nodes.delete(path); else state.nodes.set(path, value);
    if (!path.startsWith("activeBuses/")) return;
    if (JSON.stringify(old) === JSON.stringify(value)) return;
    const event = value === null ? "child_removed" : old ? "child_changed" : "child_added";
    const snap = value === null ? { ...snapshot(path), val: () => old } : snapshot(path);
    queueMicrotask(() => state.listeners.get(event)?.forEach(fn => fn(snap)));
  }
  function ref(path: string): any {
    const query: any = { once: async () => ({ forEach: () => undefined }) };
    for (const method of ["startAt", "startAfter", "endAt", "limitToFirst"]) query[method] = () => query;
    return { path, key: path.split("/").at(-1),
      once: async () => snapshot(path), set: async (value: any) => publish(path, value),
      transaction: async (update: (value: any) => any) => {
        const value = update(state.nodes.get(path) ?? null);
        if (value !== undefined) publish(path, value);
        return { committed: value !== undefined, snapshot: snapshot(path) };
      },
      on: (event: string, fn: (snap: any) => void) => {
        if (!state.listeners.has(event)) state.listeners.set(event, new Set());
        state.listeners.get(event)!.add(fn);
      },
      off: (event: string, fn: (snap: any) => void) => state.listeners.get(event)?.delete(fn),
      orderByKey: () => query, orderByChild: () => query,
    };
  }
  const doc = (path: string) => ({ path, id: path.split("/").at(-1), get: async () => ({
    exists: (state.reads.push(path), state.docs.has(path)), data: () => state.docs.get(path),
  }) });
  const merge = (a: any, b: any): any => {
    const result = { ...a };
    for (const [key, value] of Object.entries(b)) {
      result[key] = value && Object.getPrototypeOf(value) === Object.prototype
        ? merge(a?.[key], value) : value;
    }
    return result;
  };
  return { rtdb: { ref }, db: {
    collection: (name: string) => ({
      doc: (id = `generated_${++state.id}`) => doc(`${name}/${id}`),
      where: () => {
        const page: any = { get: async () => {
          const docs = [...state.docs].filter(([path, value]) => path.startsWith(`${name}/`) && ["pending", "armed", "active"].includes(value.status))
            .map(([path, value]) => ({ id: path.split("/").at(-1), ref: doc(path), data: () => value }));
          return { docs, size: docs.length };
        } };
        for (const method of ["orderBy", "limit", "startAfter"]) page[method] = () => page;
        return page;
      },
      orderBy: () => ({ startAfter: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
        limit: () => ({ get: async () => ({ docs: [] }) }) }),
      onSnapshot: (next: (snapshot: any) => void) => {
        next({ docChanges: () => name === "routes" ? [...state.docs].flatMap(([path, data]) =>
          path.startsWith("routes/") ? [{ type: "added", doc: { id: path.slice(7), data: () => data } }] : []) : [] });
        return () => undefined;
      },
    }),
    runTransaction: (work: (tx: any) => Promise<any>) => {
      const run = state.tail.then(async () => {
        const writes: Array<() => void> = [];
        const tx = {
          get: (reference: any) => reference.get(),
          set: (reference: any, data: any, options?: any) => writes.push(() => state.docs.set(reference.path,
            options?.merge ? merge(state.docs.get(reference.path), data) : data)),
          create: (reference: any, data: any) => writes.push(() => {
            if (state.docs.has(reference.path)) throw new Error("Duplicate document");
            state.docs.set(reference.path, data);
          }),
          delete: (reference: any) => writes.push(() => state.docs.delete(reference.path)),
        };
        const result = await work(tx); writes.forEach(write => write()); return result;
      });
      state.tail = run.catch(() => undefined); return run;
    },
  } };
});
vi.mock("../lib/googleMaps", () => ({ LIVE_REROUTE_TIMEOUT_MS: 3500,
  computeRouteGeometry: (...args: unknown[]) => state.compute(...args) }));

import { db, rtdb } from "../lib/firebaseAdmin";
import { startTripStateEngine } from "./tripStateEngine";
import { hashDeviceSecret, ingestDeviceTelemetry } from "./deviceTelemetryService";
import { drainDurableRideRecovery } from "./durableRideRecovery";
import { drainTelemetryRouteProcessing } from "./telemetryRouteService";
import { publicLiveBus } from "./liveBusProjection";
import { runAbandonedRideReconciliation } from "./abandonedRideReconciler";
import type { TelemetryPayload } from "./telemetryPayload";

let stop: (() => Promise<void>) | undefined;
let fixtureId = 0;
const baseTime = Date.parse("2026-10-17T08:00:00Z");
const secret = "offline-fixture-only-device-secret-123456";
async function settle() {
  for (let turn = 0; turn < 150; turn++) await Promise.resolve();
  await drainDurableRideRecovery(); await drainTelemetryRouteProcessing();
  for (let turn = 0; turn < 150; turn++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(baseTime); state.docs.clear(); state.nodes.clear(); state.listeners.clear(); state.tail = Promise.resolve();
  state.reads = [];
  state.compute.mockReset().mockImplementation(async (origin, destination, intermediates) => ({
    encodedPolyline: encodePolyline([origin, ...intermediates, destination]),
    distanceMeters: 500, duration: "100s", polylineQuality: "HIGH_QUALITY",
  }));
});
afterEach(async () => { await settle(); await stop?.(); stop = undefined; vi.useRealTimers(); });

async function fixture(startEngine = true, stopCount = 3) {
  const suffix = ++fixtureId;
  const busId = `loop_bus_${suffix}`, routeId = `loop_route_${suffix}`, driverId = `loop_driver_${suffix}`;
  const deviceId = `loop_device_${suffix}`, sessionId = `outbound_${suffix}`, key = `${busId}_${routeId}`;
  const stops = Array.from({ length: stopCount }, (_, i) => ({ id: `s${i}`, name: `Stop ${i}`, lat: 23 + i * 0.002, lng: 72 }));
  // Independent return carriageway, not a reversed coordinate array.
  const reverse = [...stops].reverse().map(point => ({ ...point, lng: point.lng + 0.00015 }));
  state.docs.set(`routes/${routeId}`, { stops, forwardPolyline: encodePolyline(stops), reversePolyline: encodePolyline(reverse), geometryVersion: 1 });
  state.docs.set(`devices/${deviceId}`, { busId, routeId, enabled: true, secretHash: await hashDeviceSecret(secret) });
  state.docs.set(`buses/${busId}`, { assignedRoutes: [routeId] });
  state.docs.set(`drivers/${driverId}`, { assignedBusId: busId });
  state.docs.set(`ride_sessions/${sessionId}`, { busId, routeId, driverId, status: "active", direction: "forward", stopsReached: {} });
  state.docs.set(`_active_bus_locks/${busId}`, { busId, routeId, driverId, sessionId });
  state.nodes.set(`activeBuses/${key}`, { busId, routeId, driverId, sessionId, status: "active", tripState: "in_service",
    direction: "forward", currentStopIndex: 0, hasDepartedOrigin: false, deviceState: "online" });
  if (startEngine) stop = startTripStateEngine();
  let seq = 0;
  const send = async (lat: number, at: number, motionState: TelemetryPayload["motionState"] = "moving", gpsHdop = 1) => {
    vi.setSystemTime(baseTime + at);
    const now = Date.now();
    const fix = { lat, lng: 72, timestamp: now, deviceSentAt: now, seq: ++seq,
      motionState, speed: motionState === "moving" ? 40 : 0,
      heading: lat < Number(state.nodes.get(`activeBuses/${key}`)?.lat) ? 180 : 0, gpsHdop };
    expect(await ingestDeviceTelemetry(deviceId, secret, fix, now)).toEqual({ ok: true, duplicate: false });
    await settle();
    return fix;
  };
  const live = () => state.nodes.get(`activeBuses/${key}`);
  const arrive = async () => {
    await send(23, 0, "stopped"); await send(23.001, 15_000); await send(23.002, 30_000);
    await send(23.0038, 50_000); await send(23.004, 55_000, "stopped");
    await send(23.004, 56_000, "stopped"); await send(23.004, 57_000, "stopped");
  };
  return { busId, routeId, driverId, sessionId, key, send, arrive, live, stops, rebootDevice: () => { seq = 0; } };
}

describe("routing lifecycle through actual ingestion and listeners", () => {
  it("withholds intermediate passage for poor-quality fixes and their recovery segment until a reliable arrival", async () => {
    const f = await fixture();
    await f.send(23, 0, "stopped"); await f.send(23.001, 15_000);
    await f.send(f.stops[1].lat, 30_000, "moving", 10);
    expect(f.live().currentStopIndex).toBe(1);
    await f.send(f.stops[1].lat + 0.0001, 35_000);
    expect(f.live().currentStopIndex).toBe(1);
    await f.send(f.stops[1].lat, 40_000);
    expect(f.live().currentStopIndex).toBe(2);
    expect(Object.values(state.docs.get(`ride_sessions/${f.sessionId}`).stopsReached)
      .filter((record: any) => record.stopId === f.stops[1].id)).toHaveLength(1);
  });
  it("recovers an armed pending ride from credible departure fixes and records ordered passage", async () => {
    const f = await fixture();
    Object.assign(state.docs.get(`ride_sessions/${f.sessionId}`), { status: "pending", direction: null, directionState: "pending" });
    Object.assign(f.live(), { direction: null, directionState: "pending", tripState: "pre_departure" });
    await f.send(23.0002, 0);
    await f.send(23.0004, 5_000);
    expect(f.live()).toMatchObject({ direction: null, currentStopIndex: 0 });
    await f.send(23.0006, 10_000);
    expect(f.live()).toMatchObject({ direction: "forward", directionResolutionSource: "departure_trajectory", sessionId: f.sessionId });
    expect(state.docs.get(`ride_sessions/${f.sessionId}`)).toMatchObject({ direction: "forward", directionState: "resolved" });
    await f.send(23.0012, 15_000);
    expect(f.live()).toMatchObject({ tripState: "in_service", currentStopIndex: 1 });
    await f.send(f.stops[1].lat - 2.4 / 6_371_000 * 180 / Math.PI, 25_000);
    expect(f.live()).toMatchObject({ tripState: "in_service", currentStopIndex: 2 });
    expect(Object.values(state.docs.get(`ride_sessions/${f.sessionId}`).stopsReached)
      .filter((record: any) => record.stopId === f.stops[1].id)).toHaveLength(1);
  });
  it("publishes the next stop and its history only after entering the 2.5m arrival circle", async () => {
    const f = await fixture();
    await f.send(23, 0, "stopped");
    await f.send(23.001, 15_000);
    const middle = f.stops[1];
    await f.send(middle.lat - 2.6 / 6_371_000 * 180 / Math.PI, 30_000);
    expect(f.live().currentStopIndex).toBe(1);
    expect(Object.values(state.docs.get(`ride_sessions/${f.sessionId}`).stopsReached)
      .some((record: any) => record.stopId === middle.id)).toBe(false);
    await f.send(middle.lat - 2.4 / 6_371_000 * 180 / Math.PI, 35_000);
    expect(f.live().currentStopIndex).toBe(2);
    const reached = Object.values(state.docs.get(`ride_sessions/${f.sessionId}`).stopsReached);
    expect(reached.filter((record: any) => record.stopId === middle.id)).toHaveLength(1);
    await f.send(middle.lat, 40_000);
    expect(f.live().currentStopIndex).toBe(2);
    expect(Object.values(state.docs.get(`ride_sessions/${f.sessionId}`).stopsReached)
      .filter((record: any) => record.stopId === middle.id)).toHaveLength(1);
    expect(state.docs.get(`ride_sessions/${f.sessionId}`).status).toBe("active");
  });

  it.each([2, 26])("retains all %i ordered stop records, passenger and chat identity across completion and reboot", async count => {
    const f = await fixture(true, count);
    const session = state.docs.get(`ride_sessions/${f.sessionId}`);
    session.passengers = { passenger: { userId: "fixture-passenger", boardingStopId: "s0", alightingStopId: `s${count - 1}` } };
    state.docs.set(`ride_sessions/${f.sessionId}/messages/kept`, { text: "Synthetic retained chat", senderId: "fixture-passenger" });
    await f.send(f.stops[0].lat, 0, "stopped");
    await f.send(23.001, 15_000);
    let now = 15_000;
    for (let i = 1; i < count; i++) {
      now += 30_000;
      await f.send(f.stops[i].lat, now, i === count - 1 ? "stopped" : "moving");
      expect(state.docs.get(`ride_sessions/${f.sessionId}`).status).toBe("active");
      if (i === Math.floor(count / 2) && i < count - 1) {
        // A long traffic pause at an intermediate stop never creates a return.
        for (let n = 0; n < 4; n++) { now += 60_000; await f.send(f.stops[i].lat, now, "stopped"); }
        expect(f.live()).toMatchObject({ direction: "forward", tripState: "in_service", sessionId: f.sessionId });
      }
    }
    const terminal = f.stops.at(-1)!.lat;
    await f.send(terminal, now + 1000, "stopped"); await f.send(terminal, now + 2000, "stopped");
    const completed = state.docs.get(`ride_sessions/${f.sessionId}`);
    expect(completed.status).toBe("completed");
    expect(completed.firstKnownLocation).toMatchObject({ lat: 23, lng: 72, sampledAt: baseTime });
    expect(Object.values(completed.stopsReached).map((record: any) => record.stopId)).toEqual(f.stops.map(stop => stop.id));
    expect(completed.passengers).toEqual(session.passengers);
    expect(completed.lastKnownLocation).toMatchObject({ lat: terminal, lng: 72, sampledAt: baseTime + now + 2000 });
    expect(state.docs.get(`ride_sessions/${f.sessionId}/messages/kept`)).toMatchObject({ text: "Synthetic retained chat" });
    await stop!(); stop = undefined; await rtdb.ref(`activeBuses/${f.key}`).set(null);
    stop = startTripStateEngine();
    f.rebootDevice();
    await f.send(terminal, now + 300_000, "stopped"); await f.send(terminal, now + 301_000, "stopped");
    expect(f.live()).toMatchObject({ direction: "reverse", tripState: "pre_departure", previousSessionId: f.sessionId });
    const returning = state.docs.get(`ride_sessions/${f.live().sessionId}`);
    expect(returning).toMatchObject({ status: "armed", originStopId: f.stops.at(-1)!.id, destinationStopId: "s0", passengers: {} });
    expect(state.docs.get(`completed_trips/${f.sessionId}`).stopCount).toBe(count);
  });
  it("archives the last raw accepted fix on each signal loss without per-fix history writes", async () => {
    const f = await fixture();
    await f.send(23, 0, "stopped"); await f.send(23.001, 15_000);
    expect(state.docs.get(`ride_sessions/${f.sessionId}`).connectionEvents).toBeUndefined();
    await rtdb.ref(`activeBuses/${f.key}`).set({ ...f.live(), deviceState: "offline", signalState: "lost" }); await settle();
    const first = state.docs.get(`ride_sessions/${f.sessionId}`).lastKnownLocation;
    expect(first).toMatchObject({ lat: 23.001, lng: 72, sampledAt: baseTime + 15_000 });
    await f.send(23.002, 30_000);
    await rtdb.ref(`activeBuses/${f.key}`).set(null); await settle();
    const history = state.docs.get(`ride_sessions/${f.sessionId}`);
    expect(history.lastKnownLocation.sampledAt).toBe(baseTime + 30_000);
    expect(Object.values(history.connectionEvents)).toHaveLength(2);
    expect(state.docs.get(`bus_locations/${f.busId}`).lastKnownLocation).toEqual(history.lastKnownLocation);
  });
  it("keeps the final shutdown fix after completed-terminal heartbeats were deduplicated", async () => {
    const f = await fixture(); await f.arrive();
    await f.send(23.004, 60_000, "stopped"); await f.send(23.004, 70_000, "stopped");
    await rtdb.ref(`activeBuses/${f.key}`).set(null); await settle();
    const history = state.docs.get(`ride_sessions/${f.sessionId}`);
    expect(history.lastKnownLocation.sampledAt).toBe(baseTime + 70_000);
    expect(Object.values(history.connectionEvents)).toHaveLength(1);
  });
  it("preserves an already armed return through the real abandoned-session sweep overnight", async () => {
    const f = await fixture(); await f.arrive();
    await f.send(23.004, 87_000, "stopped"); await f.send(23.004, 88_000, "stopped");
    const returnId = f.live().sessionId;
    await stop!(); stop = undefined;
    // Resolve adapter server timestamps to their committed wall-clock values.
    state.docs.get(`active_rides/${f.key}`).updatedAt = baseTime + 88_000;
    state.docs.get(`ride_sessions/${returnId}`).updatedAt = baseTime + 88_000;
    const now = baseTime + 24 * 60 * 60_000;
    const result = await runAbandonedRideReconciliation({ firestore: db, realtimeDatabase: rtdb, now });
    expect(result.protectedIds).toContain(returnId);
    expect(result.interruptedIds).toEqual([]);
    await rtdb.ref(`activeBuses/${f.key}`).set(null);
    stop = startTripStateEngine();
    await f.send(23.004, 24 * 60 * 60_000, "stopped");
    expect(f.live()).toMatchObject({ sessionId: returnId, direction: "reverse", tripState: "pre_departure" });
  });
  it.each([false, true])("retires an unused return and releases its lock after a day (presence removed: %s)", async removed => {
    const f = await fixture(); await f.arrive();
    await f.send(23.004, 87_000, "stopped"); await f.send(23.004, 88_000, "stopped");
    const returnId = f.live().sessionId;
    await stop!(); stop = undefined;
    state.docs.get(`active_rides/${f.key}`).updatedAt = baseTime + 88_000;
    state.docs.get(`ride_sessions/${returnId}`).updatedAt = baseTime + 88_000;
    if (removed) await rtdb.ref(`activeBuses/${f.key}`).set(null);
    const now = baseTime + 88_000 + 24 * 60 * 60_000;
    const result = await runAbandonedRideReconciliation({ firestore: db, realtimeDatabase: rtdb, now });
    expect(result.interruptedIds).toContain(returnId);
    expect(state.docs.get(`ride_sessions/${returnId}`)).toMatchObject({ status: "interrupted", interruptionReason: "abandoned_session_timeout" });
    expect(state.docs.has(`_active_bus_locks/${f.busId}`)).toBe(false);
    expect(state.docs.has(`active_rides/${f.key}`)).toBe(false);
    expect(f.live()).toBeUndefined();
    // Consumed terminal intent must not recreate the expired return at reboot.
    stop = startTripStateEngine();
    await f.send(23, now - baseTime + 1000, "stopped");
    expect(f.live().sessionId).toBeUndefined();
    expect(state.docs.has(`_active_bus_locks/${f.busId}`)).toBe(false);
  });
  it("does not record an engine retirement as signal loss", async () => {
    const f = await fixture(); await f.arrive();
    await rtdb.ref(`activeBuses/${f.key}`).set({ ...f.live(), deviceState: "offline" }); await settle();
    const history = state.docs.get(`ride_sessions/${f.sessionId}`);
    expect(history.status).toBe("completed");
    expect(history.connectionEvents).toBeUndefined();
    expect(history.lastSignalLostAt).toBeUndefined();
  });
  it("does not reread the terminal checkpoint on every completed-node heartbeat", async () => {
    const f = await fixture(); await f.arrive(); state.reads = [];
    for (let i = 58; i < 87; i++) await f.send(23.004, i * 1000, "stopped");
    expect(f.live().tripState).toBe("completed");
    expect(state.reads.filter(path => path === `bus_locations/${f.busId}`)).toHaveLength(0);
    // Credential TTL refreshes are pre-existing reads; lifecycle recovery must
    // retain its miss cache instead of rereading seven terminal documents/sec.
    expect(state.reads.filter(path => path.startsWith("active_rides/"))).toHaveLength(0);
  });
  it("replays three consecutive directional journeys with a mid-journey presence loss", async () => {
    const f = await fixture(); await f.arrive();
    await f.send(23.004, 87_000, "stopped"); await f.send(23.004, 88_000, "stopped");
    const returning = f.live().sessionId;
    await f.send(23.003, 103_000); await f.send(23.002, 120_000);
    await rtdb.ref(`activeBuses/${f.key}`).set(null);
    await f.send(23.0002, 140_000); await f.send(23, 145_000, "stopped");
    await f.send(23, 146_000, "stopped"); await f.send(23, 147_000, "stopped");
    expect(state.docs.get(`ride_sessions/${returning}`)?.status).toBe("completed");
    await f.send(23, 177_000, "stopped"); await f.send(23, 178_000, "stopped");
    expect(f.live()).toMatchObject({ direction: "forward", tripState: "pre_departure" });
    await f.send(23.001, 193_000); await f.send(23.002, 208_000); await f.send(23.0038, 228_000);
    await f.send(23.004, 233_000, "stopped"); await f.send(23.004, 234_000, "stopped"); await f.send(23.004, 235_000, "stopped");
    expect(f.live()).toMatchObject({ direction: "forward", tripState: "completed" });
    expect([...state.docs.keys()].filter(path => path.startsWith("completed_trips/"))).toHaveLength(3);
    // Three journeys plus one fresh computation after deliberate active-node erasure.
    expect(state.compute).toHaveBeenCalledTimes(4);
  });
  it("isolates interleaved buses and routes", async () => {
    const a = await fixture(), b = await fixture(false);
    await a.send(23, 0, "stopped"); await b.send(23, 0, "stopped");
    await a.send(23.001, 15_000); await b.send(23.001, 15_000);
    await a.send(23.002, 30_000); await b.send(23.004, 55_000, "stopped");
    expect(a.live()).toMatchObject({ sessionId: a.sessionId, routeId: a.routeId, currentStopIndex: 2 });
    // b reappears at its terminal after a 40 s gap, so its unobserved middle stop is skipped.
    expect(b.live()).toMatchObject({ sessionId: b.sessionId, routeId: b.routeId, currentStopIndex: 2 });
    expect(a.live().routeSessionId).toBe(a.sessionId);
    expect(b.live().routeSessionId).toBe(b.sessionId);
  });
  it("ends once before dwell, previews a return once, and departs without phantom parked service", async () => {
    const f = await fixture(); await f.arrive();
    expect(f.live()).toMatchObject({ tripState: "completed", direction: "forward" });
    expect([...state.docs.keys()].filter(path => path.startsWith("completed_trips/"))).toHaveLength(1);
    await f.send(23.004, 86_000, "stopped");
    expect(f.live().tripState).toBe("completed");
    await f.send(23.004, 87_000, "stopped"); await f.send(23.004, 88_000, "stopped");
    expect(f.live()).toMatchObject({ tripState: "pre_departure", direction: "reverse" });
    const returnId = f.live().sessionId;
    expect(state.docs.get(`ride_sessions/${returnId}`)?.status).toBe("armed");
    const calls = state.compute.mock.calls.length;
    await f.send(23.003, 103_000); await f.send(23.0028, 108_000);
    expect(f.live()).toMatchObject({ tripState: "in_service", sessionId: returnId, direction: "reverse" });
    expect(state.docs.get(`ride_sessions/${returnId}`)?.status).toBe("active");
    expect(state.compute.mock.calls.length).toBe(calls);
  });
  it("two independent engine module instances cannot double-complete or create two returns", async () => {
    const f = await fixture();
    vi.resetModules();
    const replica = await import("./tripStateEngine");
    const stopReplica = replica.startTripStateEngine();
    try {
      await f.arrive(); await f.send(23.004, 88_000, "stopped"); await f.send(23.004, 89_000, "stopped");
      expect([...state.docs.keys()].filter(path => path.startsWith("completed_trips/"))).toHaveLength(1);
      expect([...state.docs.values()].filter(value => value.id && value.previousSessionId === f.sessionId)).toHaveLength(1);
      expect(f.live()).toMatchObject({ direction: "reverse", tripState: "pre_departure" });
    } finally { await stopReplica(); }
  });
  it("skips a stop missed during a GNSS gap when the bus reappears at the terminal", async () => {
    const f = await fixture();
    await f.send(23, 0, "stopped"); await f.send(23.001, 15_000);
    await f.send(23.004, 55_000, "stopped");
    expect(f.live()).toMatchObject({ currentStopIndex: 2, tripState: "in_service", direction: "forward" });
    expect(f.live().gnssGap).toBeNull();
    const reached = state.docs.get(`ride_sessions/${f.sessionId}`)?.stopsReached;
    expect(reached?.[1]).toMatchObject({ stopIndex: 1, evidence: "skipped_gnss_gap" });
    await f.send(23.004, 58_000, "stopped");
    expect(state.docs.get(`ride_sessions/${f.sessionId}`)?.status).toBe("completed");
  });
  it("recovers an incomplete arrival conservatively after power loss", async () => {
    const f = await fixture();
    await f.send(23, 0, "stopped"); await f.send(23.001, 15_000); await f.send(23.002, 30_000);
    await f.send(23.004, 55_000, "stopped");
    expect(f.live().tripState).toBe("in_service");
    await stop!(); stop = undefined; await rtdb.ref(`activeBuses/${f.key}`).set(null);
    stop = startTripStateEngine();
    await f.send(23.004, 55_000 + 300_000, "stopped");
    expect(f.live()).toMatchObject({ sessionId: f.sessionId, tripState: "in_service", direction: "forward" });
    await f.send(23.004, 57_000 + 300_000, "stopped");
    expect(state.docs.get(`ride_sessions/${f.sessionId}`)?.status).toBe("completed");
  });
  it.each(["driver", "route-edit", "consumed", "deleted-history"])("does not recover invalid terminal intent: %s", async mode => {
    const f = await fixture(); await f.arrive(); await stop!(); stop = undefined;
    await rtdb.ref(`activeBuses/${f.key}`).set(null);
    if (mode === "driver") state.docs.set(`drivers/${f.driverId}`, { assignedBusId: "other_bus" });
    if (mode === "route-edit") state.docs.get(`routes/${f.routeId}`).stops[1].lat += 0.001;
    if (mode === "consumed") state.docs.get(`bus_locations/${f.busId}`).terminalJourney.consumedBy = "another_session";
    if (mode === "deleted-history") state.docs.delete(`ride_sessions/${f.sessionId}`);
    stop = startTripStateEngine();
    await f.send(23.004, 400_000, "stopped");
    expect(f.live().previousSessionId).toBeUndefined();
    expect(f.live().sessionId).toBeUndefined();
  });
  it("refreshes on-route geometry once, without a per-fix provider call", async () => {
    const f = await fixture();
    await f.send(23, 0, "stopped"); await f.send(23.001, 15_000); await f.send(23.002, 30_000);
    expect(state.compute).toHaveBeenCalledTimes(1);
    expect(f.live()).toMatchObject({ routeSource: "dynamic-reroute", routeTrafficState: "current" });
  });
  it.each([30_000, 300_000, 1_800_000, 86_400_000])("restores terminal and arms exactly one return after an offline gap of %s ms", async gap => {
    const f = await fixture(); await f.arrive();
    expect(state.docs.get(`ride_sessions/${f.sessionId}`)?.status).toBe("completed");
    await stop!(); stop = undefined;
    await rtdb.ref(`activeBuses/${f.key}`).set(null); // same removal boundary as stale sweep
    stop = startTripStateEngine();
    f.rebootDevice();
    await f.send(23.004, 57_000 + gap, "stopped"); await f.send(23.004, 58_000 + gap, "stopped");
    expect(f.live()).toMatchObject({ direction: "reverse", tripState: "pre_departure", previousSessionId: f.sessionId });
    const returns = [...state.docs.values()].filter(value => value.previousSessionId === f.sessionId && value.id);
    expect(returns).toHaveLength(1);
    expect(publicLiveBus(f.live())).toMatchObject({ direction: "reverse", tripState: "pre_departure" });
    await f.send(23.004, 57_000 + gap + 45 * 60_000, "stopped");
    expect(f.live().tripState).toBe("pre_departure");
    expect(state.docs.get(`ride_sessions/${returns[0].id}`)?.status).toBe("armed");
  });
});
