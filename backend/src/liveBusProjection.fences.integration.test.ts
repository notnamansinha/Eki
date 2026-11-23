import net from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getDatabase, type Database, type DataSnapshot } from "firebase-admin/database";
import { RTDB_FENCED_WRITER_AUTH, WorkerFence, workerRtdbFencedUpdate, workerRtdbTransaction } from "./lib/workerFence";
import { installCommittedDatabaseRules } from "./test-support/emulatorIsolation";

const fixture = vi.hoisted(() => ({ realtime: null as Database | null, writer: null as Database | null, failures: vi.fn(),
  leafWrites: [] as Array<{ generation: unknown; denied: boolean; values: Record<string, unknown> }> }));
// The writer is the real rules-bound handle; the wrapper only records what the rules decided.
vi.mock("./lib/firebaseAdmin", () => ({ rtdb: { ref: (path: string) => fixture.realtime!.ref(path) },
  liveProjectionWriterRtdb: () => ({ ref: (path: string) => ({ update: async (values: Record<string, unknown>) => {
    const entry = { generation: values._workerGeneration, denied: false, values };
    try { await fixture.writer!.ref(path).update(values); } catch (error) { entry.denied = true; throw error; } finally { fixture.leafWrites.push(entry); }
  } }) }) }));
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
const NAMESPACE = "demo-eki-rules-test-default-rtdb";
/** Every public field a bus in service carries, at production-like precision. */
const fullLive = (busId: string, routeId = "routeA") => {
  const at = Date.now(), position = { lat: 23.038251, lng: 72.553417 };
  return { busId, routeId, driverId: `driver_${busId}`, sessionId: `session_${busId}_20261120`, ...position, speed: 31.4, heading: 187.25,
    timestamp: at, seq: 100000, deviceSentAt: at, backendReceivedAt: at, receivedAt: at, status: "active", deviceState: "online",
    signalState: "live", motionState: "moving", tripState: "in_service", currentStopIndex: 4, delayMinutes: 2, direction: "forward",
    directionState: "confirmed", originStopId: "stop_origin_01", destinationStopId: "stop_destination_09", automaticServiceState: "in_service",
    activeRouteId: routeId, routeVersion: 12, routeSource: "configured", routeState: "on_route", routeDirection: "forward", routeGeometryVersion: 7,
    routeComputedAt: at, routeTrafficState: "normal", mapMatchSeq: 100000, mapMatchSampledAt: at, mapMatchUpdatedAt: at, matchConfidence: 0.93,
    distanceToActiveRoute: 3.21,
    rawLocation: { ...position, speed: 31.4, heading: 187.25, gpsHdop: 0.9, motionState: "moving", seq: 100000, sampledAt: at },
    matchedLocation: { ...position, segmentIndex: 41, segmentFraction: 0.4375, alongRouteDistanceM: 5120.75, distanceToRouteM: 3.21,
      headingDifference: 1.75, matchConfidence: 0.93, seq: 100000, sampledAt: at, routeVersion: 12 },
    routeMatchHistory: Array.from({ length: 4 }, (_, seq) => ({ ...position, seq })), telemetryRouteContext: { retryAt: 123 } };
};
/**
 * A protocol-level listener: the JSON text the database sends this connection,
 * as carried on the wire (WebSocket and TLS framing excluded). SDK callbacks
 * cannot show this, because the SDK rebuilds the whole value from a merge.
 */
/**
 * TCP bytes the projection's own RTDB connections receive (WebSocket framing
 * included, TLS excluded): the backend's download. Only sockets the Firebase
 * SDK opens while capturing are counted; the test's own app connected earlier
 * and the protocol listeners use Node's built-in WebSocket.
 */
function backendSockets() {
  const sockets: net.Socket[] = []; let capturing = true; let base = 0;
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: any[]) {
    if (capturing && /faye-websocket|websocket-driver|@firebase[\\/]database/.test(new Error().stack ?? "")) sockets.push(this);
    return (connect as any).apply(this, args);
  } as typeof connect;
  const total = () => sockets.reduce((sum, socket) => sum + socket.bytesRead, 0);
  return { stopCapturing() { capturing = false; net.Socket.prototype.connect = connect; },
    reset() { base = total(); }, read: () => ({ bytes: total() - base, sockets: sockets.length }) };
}
async function wireListener(path: string) {
  const socket = new WebSocket(`ws://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}/.ws?v=5&ns=${NAMESPACE}`);
  let received = 0, messages = 0; let listening!: () => void, failed!: (error: Error) => void;
  const ready = new Promise<void>((done, fail) => { listening = done; failed = fail; });
  const send = (request: number, action: string, body: unknown) => socket.send(JSON.stringify({ t: "d", d: { r: request, a: action, b: body } }));
  socket.addEventListener("error", () => failed(Error("Loopback RTDB protocol listener failed")));
  socket.addEventListener("message", event => {
    const text = String(event.data); received += Buffer.byteLength(text); messages++;
    let frame: any; try { frame = JSON.parse(text); } catch { return; } // A split frame of a large message.
    if (frame?.t === "c" && frame.d?.t === "h") { send(1, "gauth", { cred: "owner" }); send(2, "q", { p: `/${path}`, h: "" }); }
    else if (frame?.t === "d" && frame.d?.r === 2) { if (frame.d.b?.s === "ok") listening(); else failed(Error(`Listen refused: ${text}`)); }
  });
  await ready;
  return { reset() { received = 0; messages = 0; }, read: () => ({ bytes: received, messages }), close: () => socket.close() };
}

integration("R14 actual SDK publisher fences, recovery and listener isolation", () => {
  let app: App; let writerApp: App; let realtime: Database; let stop: (() => Promise<void>) | undefined;
  const subscriptions: Array<() => void> = [];
  const leader = (generation: number) => new WorkerFence("r14-sdk-publisher", generation, performance.now() + 120_000);
  beforeAll(async () => {
    const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    if (!host || !/^(127\.0\.0\.1|\[::1\]):\d+$/.test(host)) throw Error("Loopback RTDB emulator required; external database access prohibited.");
    app = initializeApp({ projectId: "demo-eki-rules-test", databaseURL: "http://127.0.0.1:9005/?ns=demo-eki-rules-test-default-rtdb",
      credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) } }, "r14-sdk-publisher");
    realtime = getDatabase(app); fixture.realtime = realtime;
    writerApp = initializeApp({ ...app.options, databaseAuthVariableOverride: { ...RTDB_FENCED_WRITER_AUTH } }, "r14-sdk-fenced-writer");
    fixture.writer = getDatabase(writerApp);
    // The fence under test is the committed rule set, installed on this disposable namespace.
    await installCommittedDatabaseRules("demo-eki-rules-test", host);
  });
  beforeEach(async () => {
    fixture.failures.mockClear(); fixture.leafWrites.length = 0;
    // Only the guarded, synthetic loopback namespace is cleared. Runner serializes files.
    await realtime.ref().update(Object.fromEntries(roots.map(root => [root, null])));
  });
  afterEach(async () => {
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    await stop?.(); stop = undefined; vi.unstubAllEnvs();
    expect(fixture.failures).not.toHaveBeenCalled();
    await realtime.ref().update(Object.fromEntries(roots.map(root => [root, null])));
  });
  afterAll(async () => { if (writerApp) await deleteApp(writerApp); if (app) await deleteApp(app); });
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
    const catalog = await read("liveRouteCatalog/values/route:routeA");
    expect(catalog).toMatchObject({ active: 1, available: 0, freshestAt: catalog.activeReceipts[0] });
    expect(catalog.activeReceipts).toHaveLength(1); expect(catalog.availableReceipts ?? []).toEqual([]);
    expect(await read("publicRouteBuses/route:routeA/buses/node:busA_routeA")).toMatchObject({ sessionId: "sessionA" });
  }, 30_000);

  it.each([false, true])("reconstructs an erased same-generation destination with source=%j", async sourceExists => {
    if (sourceExists) await realtime.ref("activeBuses/busA_routeA").set(live());
    await realtime.ref("liveRouteCatalog").set({ _workerGeneration: 4, generations: { "route:routeA": 4 }, values: { "route:routeA": { active: 8, available: 2, freshestAt: 1, availableReceipts: [1] } }, revisions: { "route:routeA": 5 } });
    await start(4);
    const catalog = await read("liveRouteCatalog/values/route:routeA");
    expect(catalog).toMatchObject({ active: sourceExists ? 1 : 0, available: 0, freshestAt: sourceExists ? catalog.activeReceipts[0] : 0 });
    expect(catalog.activeReceipts ?? []).toHaveLength(sourceExists ? 1 : 0); expect(catalog.availableReceipts ?? []).toEqual([]);
    expect(await read("liveRouteCatalog/generations/route:routeA")).toBe(4);
    expect((await read("publicRouteBuses/route:routeA"))?.revision).toBeGreaterThan(5);
    expect((await read("liveRouteCatalog/revisions/route:routeA"))).toBeGreaterThan(5);
  }, 30_000);

  it("measures a controlled 20-fix actual publisher workload and excludes internal and unrelated route events", async () => {
    // Catalog leases advance in 30s receipt buckets, an intended heartbeat write.
    // Start early in a bucket so the measured fixes cannot cross into the next.
    const untilNextBucket = 30_000 - Date.now() % 30_000;
    if (untilNextBucket < 20_000) await new Promise(resolve => setTimeout(resolve, untilNextBucket + 50));
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
    const after = metrics(); const delta = Object.fromEntries(Object.keys(after).filter(key => typeof after[key] === "number").map(key => [key, after[key] - before[key]]));
    expect(delta.events).toBe(80); expect(delta.skipped).toBe(40); expect(delta.sourceReads).toBe(40); expect(delta.committed).toBe(40);
    // Every publication is a fenced leaf write: no per-fix route transaction, denial or fallback.
    expect(delta.leafWrites).toBe(40); expect(delta.leafWriteDenials).toBe(0); expect(delta.leafWriteFallbacks).toBe(0);
    expect(getLiveBusProjectionStatus()).toMatchObject({ writeMode: "leaf" });
    expect(fixture.leafWrites.filter(write => !write.denied && write.generation === 4).length).toBeGreaterThanOrEqual(40);
    expect(delta.sourceReadBytes).toBeGreaterThan(0);
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

  it("accepts a fenced leaf update only from the claimed generation at the next revision, under the committed rules", async () => {
    await realtime.ref("activeBuses/busA_routeA").set(live());
    await start(4); await idle(); await stop!(); stop = undefined;
    const route = "publicRouteBuses/route:routeA", lat = "buses/node:busA_routeA/lat";
    const fenced = (generation: number, values: Record<string, unknown>) => leader(generation).run(() => workerRtdbFencedUpdate(fixture.writer!.ref(route), values));
    const { revision } = await read(route);
    await fenced(4, { revision: revision + 1, [lat]: 23.5 });
    expect((await read(route)).buses["node:busA_routeA"].lat).toBe(23.5);
    // The same write resent after a lost acknowledgement, a skipped revision and a partial record are all refused.
    await expect(fenced(4, { revision: revision + 1, [lat]: 30 })).rejects.toThrow(/permission.denied/i);
    await expect(fenced(4, { revision: revision + 3, [lat]: 30 })).rejects.toThrow(/permission.denied/i);
    await expect(fenced(4, { revision: revision + 2, "buses/node:ghost_routeA/lat": 30 })).rejects.toThrow(/permission.denied/i);
    // An update without the revision leaf keeps the stored revision, which is never the next one.
    await expect(fixture.writer!.ref(route).update({ _workerGeneration: 4, [lat]: 30 })).rejects.toThrow(/permission.denied/i);
    // Rules see merged data, so an omitted generation reads as the stored one: the fence
    // depends on workerRtdbFencedUpdate always writing the caller's own generation.
    await fixture.writer!.ref(route).update({ revision: revision + 2, [lat]: 24 });
    expect(await read(route)).toMatchObject({ _workerGeneration: 4, revision: revision + 2 });
    const stamped = await leader(3).run(() => workerRtdbFencedUpdate(fixture.writer!.ref(route), { revision: revision + 3, [lat]: 30, _workerGeneration: 4 }).then(() => "accepted", error => String(error)));
    expect(stamped).toMatch(/permission.denied/i);
    await fixture.writer!.ref(route).update({ revision: revision + 3, [lat]: 23 }); // Restore the claimed state.
    // A generation that has not claimed the route by transaction cannot write it either.
    await expect(fenced(5, { revision: revision + 2, [lat]: 30 })).rejects.toThrow(/permission.denied/i);
    await start(5); await idle();
    const claimed = await read(route);
    expect(claimed).toMatchObject({ _workerGeneration: 5, buses: { "node:busA_routeA": { lat: 23 } } });
    // The former leader's delayed write names the right next revision and is still refused at the destination.
    await expect(fenced(4, { revision: claimed.revision + 1, [lat]: 99 })).rejects.toThrow(/permission.denied/i);
    // Outside the projection, and for any path without the fence leaves, the writer identity holds no write
    // grant. Like any signed-in identity it reads route buses, but never the route node.
    await expect(fixture.writer!.ref(`${route}/${lat}`).set(99)).rejects.toThrow(/permission.denied/i);
    await expect(fixture.writer!.ref("activeBuses/busA_routeA/lat").set(99)).rejects.toThrow(/permission.denied/i);
    await expect(fixture.writer!.ref("liveRouteCatalog/values/route:routeA/active").set(99)).rejects.toThrow(/permission.denied/i);
    await expect(fixture.writer!.ref(route).get()).rejects.toThrow(/permission.denied/i);
    expect((await fixture.writer!.ref(`${route}/buses`).get()).val()).toEqual(claimed.buses);
    expect(await read(route)).toEqual(claimed);
  }, 40_000);

  it("stops a still-running former leader at the destination once its successor has claimed the route", async () => {
    await realtime.ref("activeBuses/busA_routeA").set(live());
    await start(4); await idle();
    const former = stop!; // Generation 4 keeps running: its in-process fence has not expired.
    try {
      await start(5); await idle();
      fixture.leafWrites.length = 0;
      const generations: unknown[] = []; watch("publicRouteBuses/route:routeA/_workerGeneration", value => generations.push(value));
      for (let fix = 1; fix <= 3; fix++) {
        await realtime.ref("activeBuses/busA_routeA").update({ seq: fix, lat: 23 + fix / 1000, timestamp: Date.now() });
        await eventually(async () => (await read("publicRouteBuses/route:routeA/buses/node:busA_routeA"))?.seq === fix, "successor publication");
      }
      await eventually(async () => fixture.leafWrites.some(write => write.generation === 4), "the former leader's attempt"); await idle();
      const attempts = (generation: number) => fixture.leafWrites.filter(write => write.generation === generation);
      // Both leaders saw every fix. The rules refused the former one, which then found the route claimed and stopped writing.
      expect(attempts(4)).toHaveLength(1); expect(attempts(4)[0].denied).toBe(true);
      expect(attempts(5).filter(write => !write.denied)).toHaveLength(3); expect(attempts(5).filter(write => write.denied)).toHaveLength(0);
      expect(new Set(generations)).toEqual(new Set([5]));
      expect(await read("publicRouteBuses/route:routeA")).toMatchObject({ _workerGeneration: 5, buses: { "node:busA_routeA": { seq: 3, lat: 23.003 } } });
      expect(getLiveBusProjectionStatus()).toMatchObject({ writeMode: "leaf", leafWriteDenials: 0, leafWriteFallbacks: 0 });
    } finally { await former(); }
  }, 40_000);

  it.each([
    ["leaf", "its public bus"], ["leaf", "the whole route"],
    ["transaction", "its public bus"], ["transaction", "the whole route"],
  ] as const)("%s mode restores a stationary bus on the first recovery pass after %s was erased", async (mode, erased) => {
    vi.stubEnv("LIVE_PROJECTION_WRITE_MODE", mode);
    const bus = "publicRouteBuses/route:routeA/buses/node:busA_routeA";
    await realtime.ref("activeBuses/busA_routeA").set(live());
    await start(4); await idle();
    // The startup pass ends with a claim; this fix leaves the leader a copy confirmed after it.
    await realtime.ref("activeBuses/busA_routeA").update({ seq: 1, lat: 23.001, timestamp: Date.now() });
    await eventually(async () => (await read(bus))?.seq === 1, "the fix publication"); await idle();
    const published = await read(bus);
    // Erased without a revision change, while the bus sends nothing new: only recovery can restore it.
    await realtime.ref(erased === "the whole route" ? "publicRouteBuses/route:routeA" : bus).remove();
    const passes = metrics().reconstructionReads;
    // A source record that cannot be published requests a recovery pass, as the 60 s timer does,
    // so the next pass starts now rather than up to a minute later.
    await realtime.ref("activeBuses/unrouted").set({ busId: "busZ" });
    // The pass replays source buses first and then rereads each route's revision floor.
    await eventually(async () => metrics().reconstructionReads > passes, "the first recovery pass");
    await eventually(async () => (await read(bus)) !== null, "the restored bus", 4000); await idle();
    expect(metrics().reconstructionReads - passes).toBe(1);
    expect(await read(bus)).toEqual(published);
    expect(await read("publicRouteBuses/route:routeA")).toMatchObject({ _workerGeneration: 4 });
    expect(getLiveBusProjectionStatus()).toMatchObject({ writeMode: mode, leafWriteFallbacks: 0 });
  }, 40_000);

  it("delivers a route listener only the changed leaves of a fix, whatever the number of buses on the route", async () => {
    const fixes = 10, results: Array<Record<string, unknown>> = [];
    const route = "publicRouteBuses/route:routeA/buses", node = `${route}/node:bus0_routeA`;
    const testWriter = fixture.writer;
    for (const mode of ["transaction", "leaf"] as const) {
      vi.stubEnv("LIVE_PROJECTION_WRITE_MODE", mode);
      await realtime.ref("activeBuses/bus0_routeA").set(fullLive("bus0"));
      // The publisher gets connections of its own, so their bytes are the backend's alone.
      const backendApp = initializeApp(app.options, `r14-backend-${mode}`);
      const backendWriterApp = initializeApp({ ...app.options, databaseAuthVariableOverride: { ...RTDB_FENCED_WRITER_AUTH } }, `r14-backend-writer-${mode}`);
      const backend = backendSockets();
      fixture.realtime = getDatabase(backendApp); fixture.writer = getDatabase(backendWriterApp);
      try {
      await start(); await idle();
      let seq = 100000;
      for (const buses of [1, 5, 10]) {
        // The same publisher and the same moving bus; only the route's population grows.
        for (let bus = 1; bus < buses; bus++) await realtime.ref(`activeBuses/bus${bus}_routeA`).update(fullLive(`bus${bus}`));
        await eventually(async () => Object.keys((await read(route)) ?? {}).length === buses, "route population"); await idle();
        // A passenger listens to one route; the admin fleet view listens to the projection root.
        const listener = await wireListener(route), fleet = await wireListener("publicRouteBuses");
        try {
          await new Promise(done => setTimeout(done, 100));
          const snapshot = listener.read(); listener.reset(); fleet.reset(); backend.reset();
          const before = { ...metrics() };
          for (let fix = 1; fix <= fixes; fix++) {
            // One 1 Hz fix as production publishes it: the telemetry write, then the route match.
            const at = Date.now(), position = { lat: 23.038251 + fix / 100000, lng: 72.553417 + fix / 100000 }; seq++;
            await realtime.ref("activeBuses/bus0_routeA").update({ ...position, speed: 31.4 + fix / 10, heading: 187.25 + fix / 100, timestamp: at, seq,
              deviceSentAt: at, backendReceivedAt: at, receivedAt: at,
              rawLocation: { ...position, speed: 31.4 + fix / 10, heading: 187.25 + fix / 100, gpsHdop: 0.9, motionState: "moving", seq, sampledAt: at } });
            await eventually(async () => (await read(node))?.seq === seq, "telemetry publication"); await idle();
            await realtime.ref("activeBuses/bus0_routeA").update({ mapMatchSeq: seq, mapMatchSampledAt: at, mapMatchUpdatedAt: at + 1, distanceToActiveRoute: 3.21 + fix / 100,
              matchedLocation: { ...position, segmentIndex: 41, segmentFraction: 0.4375 + fix / 10000, alongRouteDistanceM: 5120.75 + fix, distanceToRouteM: 3.21 + fix / 100,
                headingDifference: 1.75, matchConfidence: 0.93, seq, sampledAt: at, routeVersion: 12 } });
            await eventually(async () => (await read(node))?.matchedLocation?.seq === seq, "route-match publication"); await idle();
          }
          await new Promise(done => setTimeout(done, 100));
          const { bytes: delivered, messages } = listener.read(), after = metrics(), backendRead = backend.read();
          expect(after.committed - before.committed).toBe(2 * fixes);
          expect(after.leafWrites - before.leafWrites).toBe(mode === "leaf" ? 2 * fixes : 0);
          results.push({ mode, buses, fixes, publicBusBytes: bytes(await read(node)), initialSnapshotBytes: snapshot.bytes,
            listenerBytes: delivered, listenerMessages: messages, listenerBytesPerFix: delivered / fixes,
            fleetListenerBytes: fleet.read().bytes, fleetListenerBytesPerFix: fleet.read().bytes / fixes,
            backendBytes: backendRead.bytes, backendBytesPerFix: backendRead.bytes / fixes, backendSockets: backendRead.sockets,
            // The 60 s recovery pass rereads source pages and reclaims routes: backend
            // download that is not per fix. Listeners receive nothing from an unchanged claim.
            recoveryReads: after.reconstructionReads - before.reconstructionReads, routeClaims: after.routeClaims - before.routeClaims });
        } finally { listener.close(); fleet.close(); }
      }
      await stop!(); stop = undefined;
      } finally {
        backend.stopCapturing(); fixture.realtime = realtime; fixture.writer = testWriter;
        await deleteApp(backendWriterApp); await deleteApp(backendApp);
      }
      await realtime.ref().update(Object.fromEntries(roots.map(root => [root, null])));
    }
    process.stdout.write(`R14_LISTENER_WIRE_MEASUREMENT ${JSON.stringify({ results, includesProtocolOverhead: "RTDB JSON protocol frames; excludes WebSocket and TLS framing",
      workload: "10 fixes to one bus, each a telemetry publication then a route-match publication; listeners on the route's buses node and on the publicRouteBuses root; backend bytes are TCP bytes received by the publisher's own two connections, including its activeBuses listener" })}\n`);
    const perFix = (mode: string, buses: number) => results.find(result => result.mode === mode && result.buses === buses)!.listenerBytesPerFix as number;
    // Whole-route commits resend every bus; leaf writes cost the same on a route of one or ten.
    expect(perFix("transaction", 10)).toBeGreaterThan(5 * perFix("transaction", 1));
    for (const buses of [5, 10]) expect(Math.abs(perFix("leaf", buses) - perFix("leaf", 1))).toBeLessThanOrEqual(0.02 * perFix("leaf", 1));
    for (const buses of [1, 5, 10]) expect(perFix("leaf", buses)).toBeLessThan(perFix("transaction", buses));
    expect(perFix("leaf", 10)).toBeLessThan(perFix("transaction", 10) / 10);
    const fleetPerFix = (mode: string, buses: number) => results.find(result => result.mode === mode && result.buses === buses)!.fleetListenerBytesPerFix as number;
    for (const buses of [5, 10]) expect(Math.abs(fleetPerFix("leaf", buses) - fleetPerFix("leaf", 1))).toBeLessThanOrEqual(0.02 * fleetPerFix("leaf", 1));
    expect(fleetPerFix("leaf", 10)).toBeLessThan(fleetPerFix("transaction", 10) / 10);
    // The backend no longer downloads the route node per publication (transaction listen and echo).
    const backendPerFix = (mode: string, buses: number) => results.find(result => result.mode === mode && result.buses === buses)!.backendBytesPerFix as number;
    for (const result of results) expect(result.backendSockets).toBeGreaterThan(0);
    expect(backendPerFix("transaction", 10)).toBeGreaterThan(3 * backendPerFix("transaction", 1));
    for (const buses of [1, 5, 10]) expect(backendPerFix("leaf", buses)).toBeLessThan(backendPerFix("transaction", buses));
    const quiet = results.filter(result => result.mode === "leaf" && result.recoveryReads === 0 && result.routeClaims === 0).map(result => result.backendBytesPerFix as number);
    expect(quiet.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...quiet) - Math.min(...quiet)).toBeLessThanOrEqual(0.1 * Math.min(...quiet));
  }, 120_000);
});
