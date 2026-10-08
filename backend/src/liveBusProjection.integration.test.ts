import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getDatabase, type Database } from "firebase-admin/database";
const projectionFixture = vi.hoisted(() => ({ realtime: {} as any }));
vi.mock("./lib/firebaseAdmin", () => ({ get rtdb() { return projectionFixture.realtime; } }));
import { publicLiveBus, routeAvailability, startLiveBusProjection } from "./services/liveBusProjection";
import { WorkerFence, workerRtdbTransaction } from "./lib/workerFence";
import { lifecycleIntakeFingerprint } from "./services/lifecycleIntake";
const integration = process.env.FIREBASE_RULES_TEST === "1" ? describe : describe.skip;
integration("R14 loopback transaction and payload measurement", () => {
  let app: App; let realtime: Database;
  beforeAll(() => {
    const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    if (!host || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) throw new Error("Loopback RTDB emulator required");
    app = initializeApp({ projectId: "eki-rules-test", databaseURL: "https://eki-rules-test-default-rtdb.firebaseio.com",
      credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) } }, "r14-measurement");
    realtime = getDatabase(app);
  });
  afterAll(async () => { if (app) await deleteApp(app); });
  it("records attempts/events/JSON bytes per fix for speculative and committed-only server transactions", async () => {
    const results = [];
    for (const speculative of [true, false]) {
      const destination = realtime.ref(`_r14_measurement/${speculative}`);
      await destination.set({ seq: 0, match: 0, lifecycle: 0, timestamp: 1 });
      await destination.once("value");
      let events = 0; let attempts = 0; let bytes = 0; let intakes = 0; let fingerprint = "";
      const callback = destination.on("value", snapshot => {
        const value = snapshot.val(); events++; bytes += Buffer.byteLength(JSON.stringify(value));
        const next = lifecycleIntakeFingerprint(value); if (next !== fingerprint) { intakes++; fingerprint = next; }
      });
      await new Promise(done => setTimeout(done, 100)); events = 0; bytes = 0; intakes = 0;
      const fixes = 20;
      for (let fix = 1; fix <= fixes; fix++) {
        // Same-hot-record telemetry, matcher metadata and lifecycle writes.
        await Promise.all(["seq", "match", "lifecycle"].map(field => destination.transaction(current => {
          attempts++; return { ...current, [field]: fix, ...(field === "seq" ? { timestamp: fix + 1 } : {}) };
        }, undefined, speculative)));
      }
      await new Promise(done => setTimeout(done, 100)); destination.off("value", callback);
      expect((await destination.once("value")).val()).toMatchObject({ seq: fixes, match: fixes, lifecycle: fixes });
      results.push({ speculative, fixes, attempts, events, bytes, filteredIntakes: intakes,
        attemptsPerFix: attempts / fixes, eventsPerFix: events / fixes, bytesPerFix: bytes / fixes });
      await destination.remove();
    }
    process.stdout.write(`R14_TRANSACTION_MEASUREMENT ${JSON.stringify(results)}\n`);
  }, 30_000);
  it("records fleet versus compact selected-route payload sizes using representative bounded histories", () => {
    const fleet: Record<string, any> = {}; const projected: Record<string, any> = {}; const catalog: Record<string, any> = {};
    for (let bus = 0; bus < 100; bus++) {
      const routeId = `route${bus % 10}`; const key = `bus${bus}_${routeId}`;
      const value = { busId: `bus${bus}`, routeId, sessionId: `s${bus}`, status: "active", tripState: "in_service", seq: 1,
        timestamp: 1_800_000_000_000, lat: 23, lng: 72, speed: 10, heading: 90,
        _workerGeneration: 5, telemetryRouteContext: { routeId, retryAt: 123, lastMatchAt: 456 },
        rawLocation: { lat: 23, lng: 72, speed: 10, heading: 90, gpsHdop: 2, motionState: "moving", seq: 1, sampledAt: 1_800_000_000_000 },
        matchedLocation: { lat: 23, lng: 72, seq: 1, sampledAt: 1_800_000_000_000, matchConfidence: 0.9, routeVersion: 1 },
        plausibilityAnchor: { lat: 23, lng: 72, speed: 10, gpsHdop: 2, timestamp: 1_800_000_000_000 },
        routeMatchHistory: Array.from({ length: 4 }, (_, i) => ({ lat: 23 + i / 1000, lng: 72, sampledAt: 1_800_000_000_000 + i, seq: i })) };
      fleet[key] = value;
      if (routeId === "route0") projected[`node:${key}`] = publicLiveBus(value);

    }
    for (const routeId of new Set(Object.values(fleet).map(bus => bus.routeId))) {
      catalog[`route:${routeId}`] = routeAvailability(Object.fromEntries(Object.entries(fleet).filter(([, bus]) => bus.routeId === routeId)), 1_800_000_000_000);
    }
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
    const result = { fleetBuses: 100, routes: 10, selectedBuses: 10, fleetBytes: bytes(fleet), selectedRouteBytes: bytes(projected), catalogBytes: bytes(catalog) };
    expect(bytes(projected) + bytes(catalog)).toBeLessThan(bytes(fleet));
    expect(JSON.stringify(projected)).not.toContain("routeMatchHistory");
    process.stdout.write(`R14_PAYLOAD_MEASUREMENT ${JSON.stringify(result)}\n`);
  });
  it("claims unchanged public destinations on real RTDB and rejects a delayed former leader", async () => {
    const root = realtime.ref("_r14_projection_takeover");
    const bus = { busId: "bus", routeId: "route", sessionId: "session", status: "active", tripState: "in_service", timestamp: Date.now() };
    await root.set({ activeBuses: { bus_route: bus }, publicRouteBuses: { "route:route": { _workerGeneration: 1, revision: 5, buses: { "node:bus_route": bus } } },
      liveRouteCatalog: { _workerGeneration: 1, revisions: { "route:route": 5 }, values: { "route:route": { active: 1, available: 0, freshestAt: 0 } } } });
    projectionFixture.realtime = { ref: (path: string) => root.child(path) };
    const leader = new WorkerFence("r14", 2, performance.now() + 30_000);
    const stop = leader.run(startLiveBusProjection);
    try {
      await waitFor(async () => (await root.child("publicRouteBuses/route:route/_workerGeneration").once("value")).val() === 2);
      expect((await root.child("publicRouteBuses/route:route/revision").once("value")).val()).toBe(5);
      expect((await root.child("liveRouteCatalog/_workerGeneration").once("value")).val()).toBe(2);
      const old = new WorkerFence("old", 1, performance.now() + 30_000);
      const attempt = await old.run(() => workerRtdbTransaction(root.child("publicRouteBuses/route:route"), current => ({ ...current, revision: 999 })));
      expect(attempt.committed).toBe(false);
      expect((await root.child("publicRouteBuses/route:route/revision").once("value")).val()).toBe(5);
    } finally { await stop(); await root.remove(); }
  }, 15_000);
  it("recovers automatic-return completion proof and removes missed source deletions on real RTDB", async () => {
    const root = realtime.ref("_r14_projection_return");
    await root.set({ activeBuses: { bus_route: { busId: "bus", routeId: "route", sessionId: "return", previousSessionId: "joined",
      automaticTurnaround: true, status: "active", tripState: "pre_departure", timestamp: Date.now(), privateHistory: "never public" } } });
    projectionFixture.realtime = { ref: (path: string) => root.child(path) };
    const stop = new WorkerFence("r14", 3, performance.now() + 30_000).run(startLiveBusProjection);
    try {
      await waitFor(async () => (await root.child("publicRouteBuses/route:route/buses/node:bus_route").once("value")).val()?.sessionId === "return");
      const projected = (await root.child("publicRouteBuses/route:route/buses/node:bus_route").once("value")).val();
      expect(projected).toMatchObject({ previousSessionId: "joined", automaticTurnaround: true });
      expect(projected.privateHistory).toBeUndefined();
      await root.child("activeBuses/bus_route").remove();
      await waitFor(async () => !(await root.child("publicRouteBuses/route:route/buses/node:bus_route").once("value")).exists());
      await waitFor(async () => (await root.child("liveRouteCatalog/values/route:route/active").once("value")).val() === 0);
    } finally { await stop(); await root.remove(); }
  }, 15_000);
  it("stops within the drain deadline and cannot publish a late real source read", async () => {
    const root = realtime.ref("_r14_projection_stop");
    await root.set({ activeBuses: { bus_route: { busId: "bus", routeId: "route", timestamp: Date.now() } } });
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    projectionFixture.realtime = { ref: (path: string) => path === "activeBuses/bus_route" ? {
      once: async () => { const snapshot = await root.child(path).once("value"); entered(); await gate; return snapshot; },
    } : root.child(path) };
    const stop = new WorkerFence("r14", 4, performance.now() + 30_000).run(startLiveBusProjection);
    try {
      await started; const before = performance.now(); await stop();
      expect(performance.now() - before).toBeLessThan(9500);
      release(); await new Promise(resolve => setTimeout(resolve, 100));
      expect((await root.child("publicRouteBuses").once("value")).exists()).toBe(false);
    } finally { release(); await stop(); await root.remove(); }
  }, 15_000);
});

async function waitFor(condition: () => Promise<boolean>) {
  const deadline = performance.now() + 5000;
  while (!(await condition())) {
    if (performance.now() >= deadline) throw new Error("R14 emulator condition timed out");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
