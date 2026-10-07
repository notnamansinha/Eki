import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getDatabase, type Database, type DataSnapshot } from "firebase-admin/database";
import { WorkerFence, workerRtdbTransaction } from "./lib/workerFence";

const fixture = vi.hoisted(() => ({ realtime: null as Database | null, failures: vi.fn() }));
vi.mock("./lib/firebaseAdmin", () => ({ rtdb: { ref: (path: string) => fixture.realtime!.ref(path) } }));
vi.mock("./lib/backgroundFailureTracker", () => ({ recordBackgroundFailure: fixture.failures }));
import { getLiveBusProjectionStatus, publicLiveBus, startLiveBusProjection } from "./services/liveBusProjection";

const integration = process.env.FIREBASE_RULES_TEST === "1" ? describe : describe.skip;
const roots = ["activeBuses", "publicRouteBuses", "liveRouteCatalog", "clientProjectionStatus"];
const live = (busId = "busA", routeId = "routeA", sessionId = "sessionA") => ({
  busId, routeId, sessionId, status: "active", tripState: "in_service", deviceState: "online",
  timestamp: Date.now(), seq: 0, lat: 23, lng: 72,
  rawLocation: { lat: 23, lng: 72, seq: 0, sampledAt: Date.now() },
  matchedLocation: { lat: 23, lng: 72, seq: 0, sampledAt: Date.now(), matchConfidence: 0.9 },
  routeMatchHistory: Array.from({ length: 4 }, (_, seq) => ({ lat: 23, lng: 72, seq })),
  telemetryRouteContext: { retryAt: 123 },
});
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const metrics = () => getLiveBusProjectionStatus() as unknown as Record<string, number>;

integration("R14 actual SDK publisher fences, recovery and listener isolation", () => {
  let app: App; let realtime: Database; let stop: (() => Promise<void>) | undefined;
  const subscriptions: Array<() => void> = [];
  const leader = (generation: number) => new WorkerFence("r14-sdk-publisher", generation, performance.now() + 120_000);
  beforeAll(() => {
    const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    if (!host || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) throw Error("Loopback RTDB emulator required; external database access prohibited.");
    app = initializeApp({ projectId: "eki-rules-test", databaseURL: "https://eki-rules-test-default-rtdb.firebaseio.com",
      credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) } }, "r14-sdk-publisher");
    realtime = getDatabase(app); fixture.realtime = realtime;
  });
  beforeEach(async () => {
    fixture.failures.mockClear();
    // Only the guarded, synthetic loopback namespace is cleared. Runner serializes files.
    await realtime.ref().update(Object.fromEntries(roots.map(root => [root, null])));
  });
  afterEach(async () => {
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    await stop?.(); stop = undefined;
    expect(fixture.failures).not.toHaveBeenCalled();
    await realtime.ref().update(Object.fromEntries(roots.map(root => [root, null])));
  });
  afterAll(async () => { if (app) await deleteApp(app); });
  async function eventually(check: () => Promise<boolean>, description: string, timeout = 18_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw Error(`Timed out awaiting ${description}; metrics=${JSON.stringify(metrics())}`);
  }
  const read = async (path: string) => (await realtime.ref(path).get()).val();
  async function start(generation = 4) {
    stop = leader(generation).run(startLiveBusProjection);
    await eventually(async () => {
      const status = await read("clientProjectionStatus");
      return status?._workerGeneration === generation && status.public?.ready === true;
    }, "completed current generation startup backfill");
  }
  async function idle() {
    await eventually(async () => !metrics().activeWorkers && !metrics().pendingKeys, "all dispatched publisher work settling");
  }
  function watch(path: string, receive: (value: unknown) => void) {
    const ref = realtime.ref(path);
    const callback = (snapshot: DataSnapshot) => receive(snapshot.val());
    ref.on("value", callback); subscriptions.push(() => ref.off("value", callback));
  }

  it("upgrades unchanged route and catalog generations, rejecting a real older SDK transaction", async () => {
    const value = live(); await realtime.ref("activeBuses/busA_routeA").set(value);
    await start(4); await stop!(); stop = undefined;
    const publicBefore = await read("publicRouteBuses/route:routeA/buses");
    const revisionBefore = (await read("publicRouteBuses/route:routeA"))?.revision;
    await start(5);
    expect(await read("publicRouteBuses/route:routeA/buses")).toEqual(publicBefore);
    expect((await read("publicRouteBuses/route:routeA"))?.revision).toBe(revisionBefore);
    expect(await read("liveRouteCatalog/generations/route:routeA")).toBe(5);
    for (const path of ["publicRouteBuses/route:routeA", "liveRouteCatalog", "clientProjectionStatus"]) {
      expect((await read(path))._workerGeneration, path).toBe(5);
      const stale = await leader(4).run(() => workerRtdbTransaction(realtime.ref(path), current => ({ ...current, poisoned: true })));
      expect(stale.committed).toBe(false); expect((await read(path)).poisoned).toBeUndefined();
    }
  }, 40_000);

  it("replays a bounded prior completion marker on its new ride and removes obsolete route state", async () => {
    const carried = { ...live("busA", "routeB", "newRide"), lastCompletedSessionId: "oldRide", lastCompletedRouteId: "routeA", lastCompletedAt: Date.now() - 1000 };
    await realtime.ref("activeBuses/busA_routeB").set(carried);
    await realtime.ref("publicRouteBuses/route:routeA").set({ revision: 1, _workerGeneration: 3, buses: { "node:busA_routeA": publicLiveBus(live()) } });
    await realtime.ref("liveRouteCatalog").set({ _workerGeneration: 3, values: { "route:routeA": { active: 1, available: 0, freshestAt: 0, availableReceipts: [] } }, revisions: { "route:routeA": 1 } });
    await start();
    expect(await read("publicRouteBuses/route:routeB/buses/node:busA_routeB")).toMatchObject({ sessionId: "newRide", lastCompletedSessionId: "oldRide", lastCompletedRouteId: "routeA" });
    expect(await read("publicRouteBuses/route:routeA/buses")).toBeNull();
    expect(await read("liveRouteCatalog/values/route:routeA")).toMatchObject({ active: 0 });
    await realtime.ref("activeBuses/busA_routeB").remove();
    await eventually(async () => (await read("publicRouteBuses/route:routeB/buses")) === null, "current removal reconciliation");
  }, 30_000);

  it("stores genuine SDK-valid reserved route IDs as own opaque keys", async () => {
    for (const routeId of ["__proto__", "constructor", "hasOwnProperty"]) await realtime.ref(`activeBuses/bus_${routeId}`).set(live("bus", routeId));
    await start();
    const catalog = await read("liveRouteCatalog/values");
    for (const routeId of ["__proto__", "constructor", "hasOwnProperty"]) {
      expect(Object.hasOwn(catalog, `route:${routeId}`)).toBe(true);
      expect(await read(`publicRouteBuses/route:${routeId}/buses/node:bus_${routeId}`)).toMatchObject({ busId: "bus", routeId });
    }
  }, 30_000);

  it.each([true, false])("repairs stale catalog counts for an empty destination exists=%j", async exists => {
    if (exists) await realtime.ref("publicRouteBuses/route:routeA").set({ revision: 5, _workerGeneration: 3 });
    await realtime.ref("liveRouteCatalog").set({ _workerGeneration: 3, values: { "route:routeA": { active: 1, available: 2, freshestAt: 1, availableReceipts: [1] } }, revisions: { "route:routeA": 5 } });
    await start(4);
    expect(await read("liveRouteCatalog/values/route:routeA")).toMatchObject({ active: 0, available: 0, freshestAt: 0 });
    expect((await read("liveRouteCatalog"))?._workerGeneration).toBe(4);
    expect((await read("publicRouteBuses/route:routeA"))?._workerGeneration).toBe(4);
  }, 30_000);

  it("reconstructs the active catalog from source when an older high revision has no destination", async () => {
    await realtime.ref("activeBuses/busA_routeA").set(live());
    await realtime.ref("liveRouteCatalog").set({ _workerGeneration: 3, values: { "route:routeA": { active: 0, available: 2, freshestAt: 1, availableReceipts: [1] } }, revisions: { "route:routeA": 5 } });
    await start(4);
    expect(await read("liveRouteCatalog/values/route:routeA")).toMatchObject({ active: 1, available: 0, freshestAt: 0 });
    expect(await read("publicRouteBuses/route:routeA/buses/node:busA_routeA")).toMatchObject({ sessionId: "sessionA" });
  }, 30_000);

  it.each([false, true])("reconstructs an erased same-generation destination with source=%j", async sourceExists => {
    if (sourceExists) await realtime.ref("activeBuses/busA_routeA").set(live());
    await realtime.ref("liveRouteCatalog").set({ _workerGeneration: 4, generations: { "route:routeA": 4 }, values: { "route:routeA": { active: 8, available: 2, freshestAt: 1, availableReceipts: [1] } }, revisions: { "route:routeA": 5 } });
    await start(4);
    expect(await read("liveRouteCatalog/values/route:routeA")).toMatchObject({ active: sourceExists ? 1 : 0, available: 0, freshestAt: 0 });
    expect(await read("liveRouteCatalog/generations/route:routeA")).toBe(4);
    expect((await read("publicRouteBuses/route:routeA"))?.revision).toBeGreaterThan(5);
    expect((await read("liveRouteCatalog/revisions/route:routeA"))).toBeGreaterThan(5);
  }, 30_000);

  it("measures a controlled 20-fix actual publisher workload and excludes internal and unrelated route events", async () => {
    await realtime.ref("activeBuses").set({ busA_routeA: live(), busB_routeB: live("busB", "routeB", "sessionB") });
    await start(); await idle();
    const measurement = { fixes: 20, rawEvents: 0, rawBytes: 0, selectedEvents: 0, selectedBytes: 0, catalogEvents: 0, catalogBytes: 0 };
    watch("activeBuses", value => { measurement.rawEvents++; measurement.rawBytes += bytes(value); });
    watch("publicRouteBuses/route:routeA/buses", value => { measurement.selectedEvents++; measurement.selectedBytes += bytes(value); });
    watch("liveRouteCatalog/values", value => { measurement.catalogEvents++; measurement.catalogBytes += bytes(value); });
    await eventually(async () => measurement.rawEvents === 1 && measurement.selectedEvents === 1 && measurement.catalogEvents === 1, "initial listener snapshots");
    Object.assign(measurement, { rawEvents: 0, rawBytes: 0, selectedEvents: 0, selectedBytes: 0, catalogEvents: 0, catalogBytes: 0 });
    const before = { ...metrics() };
    for (let fix = 1; fix <= measurement.fixes; fix++) {
      const sample = Date.now();
      await realtime.ref("activeBuses/busA_routeA").update({ seq: fix, timestamp: sample, rawLocation: { lat: 23 + fix / 1000, lng: 72, seq: fix, sampledAt: sample } });
      await eventually(async () => (await read("publicRouteBuses/route:routeA/buses/node:busA_routeA"))?.seq === fix, "raw fix publication"); await idle();
      await realtime.ref("activeBuses/busA_routeA/matchedLocation").set({ lat: 23 + fix / 1000, lng: 72, seq: fix, sampledAt: sample, matchConfidence: 0.9 });
      await eventually(async () => (await read("publicRouteBuses/route:routeA/buses/node:busA_routeA"))?.matchedLocation?.seq === fix, "matched fix publication"); await idle();
      await realtime.ref("activeBuses/busA_routeA/telemetryRouteContext/retryAt").set(fix);
      await realtime.ref("activeBuses/busA_routeA/routeMatchHistory").set([{ lat: 23, lng: 72, seq: fix }]);
    }
    await eventually(async () => measurement.rawEvents === 80 && measurement.selectedEvents === 40, "all controlled listener callbacks");
    const after = metrics(); const delta = Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
    expect(delta.events).toBe(80); expect(delta.skipped).toBe(40); expect(delta.sourceReads).toBe(40); expect(delta.committed).toBe(40);
    expect(delta.transactionAttempts).toBeGreaterThanOrEqual(40); expect(delta.sourceReadBytes).toBeGreaterThan(0);
    expect(delta.catalogTransactionAttempts).toBe(0); expect(measurement.catalogEvents).toBe(0);
    expect(delta.reconstructionReads).toBe(0); expect(delta.reconstructionReadBytes).toBe(0);
    expect(measurement.selectedBytes).toBeLessThan(measurement.rawBytes);
    const controlled = { ...measurement };
    const selectedBefore = measurement.selectedEvents;
    await realtime.ref("activeBuses/busB_routeB").update({ seq: 99, timestamp: Date.now(), lat: 24 });
    await eventually(async () => (await read("publicRouteBuses/route:routeB/buses/node:busB_routeB"))?.seq === 99, "unrelated route publication"); await idle();
    expect(measurement.selectedEvents).toBe(selectedBefore);
    process.stdout.write(`R14_ACTUAL_PUBLISHER_MEASUREMENT ${JSON.stringify({ ...controlled, publisherDelta: delta, decodedPayloadBytesPerFix: { fleet: controlled.rawBytes / 20, selectedRoute: controlled.selectedBytes / 20 }, includesProtocolOverhead: false, workload: "20 sequential raw+matched+2 internal updates; post-workload unrelated route isolation check" })}\n`);
  }, 45_000);
});
