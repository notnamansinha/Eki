import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  nodes: new Map<string, Record<string, unknown>>(),
  beforePublish: undefined as (() => void) | undefined,
  beforeRead: undefined as (() => Promise<void>) | undefined,
  reads: [] as string[],
  writes: [] as string[],
}));
vi.mock("../lib/firebaseAdmin", () => ({
  db: {
    collection: (collection: string) => ({ doc: (id: string) => ({ path: `${collection}/${id}`, get: async () => {
      const value = store.documents.get(`${collection}/${id}`);
      return { exists: value !== undefined, data: () => value };
    } }) }),
    runTransaction: async (work: (transaction: unknown) => unknown) => work({
      get: async (ref: { path: string }) => {
        if (ref.path.startsWith("active_rides/")) await store.beforeRead?.();
        store.reads.push(ref.path);
        const value = store.documents.get(ref.path);
        return { exists: value !== undefined, data: () => value };
      },
    }),
  },
  rtdb: { ref: (path: string) => ({ on: () => undefined, off: () => undefined, transaction: async (update: (value: unknown) => Record<string, unknown> | undefined) => {
    store.beforePublish?.();
    const value = update(store.nodes.get(path) ?? null);
    if (value !== undefined) { store.nodes.set(path, value); store.writes.push(path); }
    return { committed: value !== undefined, snapshot: { val: () => store.nodes.get(path) ?? null } };
  } }) },
}));
vi.mock("./telemetryRouteService", () => ({ scheduleTelemetryRouteProcessing: () => undefined }));
import { drainDurableRideRecovery, restoreDurableRide } from "./durableRideRecovery";
import { hashDeviceSecret, ingestDeviceTelemetry } from "./deviceTelemetryService";
import type { TelemetryPayload } from "./telemetryPayload";

let sequence = 0;
beforeEach(() => { store.documents.clear(); store.nodes.clear(); store.reads = []; store.writes = []; store.beforePublish = undefined; store.beforeRead = undefined; });
function claimed() {
  const assignment = { busId: `bus_${++sequence}`, routeId: "route" };
  const key = `${assignment.busId}_route`;
  const newSession = `return_${sequence}`;
  const oldSession = `outbound_${sequence}`;
  const driverId = "driver";
  const durable = {
    ...assignment, sessionId: newSession, driverId, status: "active", tripState: "pre_departure",
    direction: "reverse", originStopId: "end", destinationStopId: "start", currentStopIndex: 0,
    hasDepartedOrigin: false, automaticTurnaround: true, previousSessionId: oldSession,
    delayMinutes: 0, delayUpdatedAt: 0, directionState: "resolved", directionEndpointVersion: "v1", directionFirestoreSynced: true,
  };
  store.documents.set(`active_rides/${key}`, durable);
  store.documents.set(`_active_bus_locks/${assignment.busId}`, { ...assignment, sessionId: newSession, driverId });
  store.documents.set(`ride_sessions/${newSession}`, { ...assignment, driverId, status: "armed", stopsReached: {} });
  store.documents.set(`ride_sessions/${oldSession}`, { ...assignment, driverId, status: "completed", stopsReached: { end: "saved" } });
  store.nodes.set(`activeBuses/${key}`, {
    ...assignment, sessionId: oldSession, driverId, status: "active", tripState: "completed",
    direction: "forward", currentStopIndex: 5, timestamp: 10_000, seq: 10, motionState: "stopped", deviceState: "online",
    lat: 23, lng: 72, delayMinutes: 30, delayUpdatedAt: 10_000,
    turnaroundClaimId: newSession, turnaroundClaimedAt: 10_000, turnaroundSampledAt: 10_000,
    activeRouteId: "old-reroute", matchedLocation: { lat: 23, lng: 72 },
  });
  return { assignment, key, newSession, oldSession, durable };
}

describe("durable return-session recovery", () => {
  it("drains more than 16 distinct rides without another telemetry fix", async () => {
    let releaseReads!: () => void;
    const blocked = new Promise<void>(resolve => { releaseReads = resolve; });
    let inFlight = 0;
    let peak = 0;
    store.beforeRead = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await blocked;
      inFlight--;
    };
    const rides = Array.from({ length: 24 }, () => claimed());
    const restores = rides.map(ride => restoreDurableRide(ride.assignment, undefined, ride.newSession));
    expect(restoreDurableRide(rides[23].assignment, undefined, rides[23].newSession)).toBe(restores[23]);
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    expect(peak).toBe(16);
    expect(store.writes).toHaveLength(0);
    const drained = drainDurableRideRecovery();
    releaseReads();
    expect(await Promise.all(restores)).toEqual(Array(24).fill(true));
    await drained;
    expect(store.writes).toHaveLength(24);
    for (const ride of rides) {
      expect(store.nodes.get(`activeBuses/${ride.key}`)?.sessionId).toBe(ride.newSession);
    }
  });
  it("actual telemetry ingestion triggers recovery when the old completed node still says active", async () => {
    const context = claimed();
    const now = Date.now();
    const secret = "test-only-device-secret-with-enough-entropy";
    const deviceId = `device_${sequence}`;
    store.documents.set(`devices/${deviceId}`, { ...context.assignment, enabled: true, secretHash: await hashDeviceSecret(secret) });
    store.documents.set(`buses/${context.assignment.busId}`, { assignedRoutes: [context.assignment.routeId] });
    store.documents.set(`routes/${context.assignment.routeId}`, {});
    store.nodes.get(`activeBuses/${context.key}`)!.timestamp = now - 1_000;
    await expect(ingestDeviceTelemetry(deviceId, secret, {
      lat: 23, lng: 72, speed: 0, heading: 0, motionState: "stopped", gpsHdop: 1,
      timestamp: now, deviceSentAt: now, seq: 11,
    }, now)).resolves.toEqual({ ok: true, duplicate: false });
    for (let turn = 0; turn < 100; turn++) await Promise.resolve();
    expect(store.nodes.get(`activeBuses/${context.key}`)).toMatchObject({ sessionId: context.newSession, tripState: "pre_departure", timestamp: now, seq: 11 });
    expect(store.documents.get(`ride_sessions/${context.oldSession}`)?.stopsReached).toEqual({ end: "saved" });
  });
  it("recovers the same claimed return after the durable commit/RTDB activation crash window", async () => {
    const context = claimed();
    const history = store.documents.get(`ride_sessions/${context.oldSession}`);
    await expect(restoreDurableRide(context.assignment, undefined, context.newSession)).resolves.toBe(true);
    const live = store.nodes.get(`activeBuses/${context.key}`)!;
    expect(live).toMatchObject({ sessionId: context.newSession, status: "active", tripState: "pre_departure", direction: "reverse", currentStopIndex: 0, delayMinutes: 0, timestamp: 10_000, seq: 10, turnaroundClaimId: null, turnaroundSampledAt: null });
    expect(live).not.toHaveProperty("activeRouteId");
    expect(live).not.toHaveProperty("matchedLocation");
    expect(store.documents.get(`ride_sessions/${context.oldSession}`)).toBe(history);
    expect(store.documents.get(`_active_bus_locks/${context.assignment.busId}`)?.sessionId).toBe(context.newSession);
    await expect(restoreDurableRide(context.assignment)).resolves.toBe(false);
    expect(store.writes).toHaveLength(1);
    expect(store.documents.size).toBe(4); // no new session or lock was created
  });
  it.each(["new-live-session", "changed-lock", "terminal-session", "wrong-claim"])("protects %s", async conflict => {
    const context = claimed();
    const live = store.nodes.get(`activeBuses/${context.key}`)!;
    if (conflict === "new-live-session") store.beforePublish = () => store.nodes.set(`activeBuses/${context.key}`, { ...live, sessionId: "newer", tripState: "in_service" });
    if (conflict === "changed-lock") store.documents.set(`_active_bus_locks/${context.assignment.busId}`, { ...context.assignment, sessionId: "newer", driverId: "driver" });
    if (conflict === "terminal-session") store.documents.get(`ride_sessions/${context.newSession}`)!.status = "interrupted";
    if (conflict === "wrong-claim") live.turnaroundClaimId = "another-return";
    await expect(restoreDurableRide(context.assignment, undefined, context.newSession)).resolves.toBe(false);
    expect(store.writes).toHaveLength(0);
  });
  it("a newly observed claim bypasses the earlier no-ride miss cache", async () => {
    const context = claimed();
    store.documents.delete(`active_rides/${context.key}`);
    await expect(restoreDurableRide(context.assignment)).resolves.toBe(false);
    store.documents.set(`active_rides/${context.key}`, context.durable);
    await expect(restoreDurableRide(context.assignment, undefined, context.newSession)).resolves.toBe(true);
  });
  it("preserves newer live telemetry and uncertainty when recovery uses an older fix", async () => {
    const context = claimed();
    const live = store.nodes.get(`activeBuses/${context.key}`)!;
    live.motionState = "uncertain";
    const older: TelemetryPayload = { lat: 24, lng: 73, speed: 10, heading: 90, gpsHdop: 1, motionState: "moving", timestamp: 9_000, seq: 9, deviceSentAt: 9_000 };
    await expect(restoreDurableRide(context.assignment, older, context.newSession)).resolves.toBe(true);
    expect(store.nodes.get(`activeBuses/${context.key}`)).toMatchObject({ lat: 23, lng: 72, timestamp: 10_000, seq: 10, motionState: "uncertain", signalState: "gnss_lost" });
  });
});
