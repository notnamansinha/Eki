import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getDatabase, type Database } from "firebase-admin/database";
vi.mock("./lib/firebaseAdmin", () => ({ rtdb: {} }));
import { publicLiveBus } from "./services/liveBusProjection";
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
      if (routeId === "route0") projected[key] = publicLiveBus(value);
      catalog[routeId] = { active: 10, available: 0, freshestAt: 0 };
    }
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
    const result = { fleetBuses: 100, routes: 10, selectedBuses: 10, fleetBytes: bytes(fleet), selectedRouteBytes: bytes(projected), catalogBytes: bytes(catalog) };
    expect(bytes(projected) + bytes(catalog)).toBeLessThan(bytes(fleet));
    expect(JSON.stringify(projected)).not.toContain("routeMatchHistory");
    process.stdout.write(`R14_PAYLOAD_MEASUREMENT ${JSON.stringify(result)}\n`);
  });
});
