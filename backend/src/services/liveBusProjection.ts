import { rtdb } from "../lib/firebaseAdmin";
import { assertWorkerLeadership, bindWorkerCallback, workerRtdbTransaction } from "../lib/workerFence";
import { createLatestPendingScheduler } from "../lib/latestPendingScheduler";
import { LruCache } from "../lib/lruCache";
import { createPagedLifecycleReplay } from "./pagedLifecycleReplay";
import { recordBackgroundFailure } from "../lib/backgroundFailureTracker";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PUBLIC_FIELDS = [
  "busId", "routeId", "driverId", "sessionId", "lat", "lng", "speed", "heading", "timestamp", "seq",
  "deviceSentAt", "backendReceivedAt", "receivedAt", "status", "deviceState", "signalState", "motionState",
  "tripState", "currentStopIndex", "delayMinutes", "direction", "directionState", "originStopId", "destinationStopId",
  "activeRouteId", "routeVersion", "routeSource", "routeState", "routeDirection", "routeGeometryVersion",
  "mapMatchSeq", "mapMatchSampledAt", "mapMatchUpdatedAt", "matchConfidence", "distanceToActiveRoute",
] as const;
const RAW_FIELDS = ["lat", "lng", "speed", "heading", "gpsHdop", "motionState", "seq", "sampledAt"];
const MATCH_FIELDS = ["lat", "lng", "segmentIndex", "segmentFraction", "alongRouteDistanceM", "distanceToRouteM",
  "headingDifference", "matchConfidence", "seq", "sampledAt", "routeVersion"];
function pick(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.flatMap(field => {
    const item = value[field];
    return (typeof item === "string" && item.length <= 512) || typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item)) ? [[field, item]] : [];
  }));
}

/** Explicit public contract: histories, anchors, claims, retry state and worker metadata never escape. */
export function publicLiveBus(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const live = value as Record<string, unknown>;
  if (typeof live.busId !== "string" || !SAFE_ID.test(live.busId) ||
      typeof live.routeId !== "string" || !SAFE_ID.test(live.routeId)) return null;
  const output: Record<string, unknown> = pick(live, PUBLIC_FIELDS);
  for (const [field, fields] of [["rawLocation", RAW_FIELDS], ["matchedLocation", MATCH_FIELDS]] as const) {
    const nested = live[field];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) output[field] = pick(nested as Record<string, unknown>, fields);
  }
  return output;
}

export function routeAvailability(buses: Record<string, Record<string, unknown>>, now = Date.now()) {
  let active = 0; let available = 0; let freshestAt = 0;
  for (const bus of Object.values(buses)) {
    if (bus.tripState === "completed") continue;
    const isRide = bus.status === "active" && typeof bus.sessionId === "string" &&
      (bus.tripState === "pre_departure" || bus.tripState === "in_service");
    const at = typeof bus.backendReceivedAt === "number" ? bus.backendReceivedAt : Number(bus.timestamp);
    if (isRide) active++;
    else if (bus.deviceState === "online" && at <= now + 10_000 && now - at < 300_000) { available++; freshestAt = Math.max(freshestAt, Math.floor(at / 60_000) * 60_000); }
  }
  return { active, available, freshestAt };
}

let projectionStatus = () => ({ scheduled: 0, processed: 0, coalesced: 0, failed: 0, rejected: 0 });
export function getLiveBusProjectionStatus() { return projectionStatus(); }

/** Leader-owned materialization, separate from durable lifecycle FIFO work. */
export function startLiveBusProjection(): () => Promise<void> {
  const source = rtdb.ref("activeBuses");
  const fingerprints = new LruCache<string, string>(1000);
  const catalogFingerprints = new LruCache<string, string>(1000);
  const registeredRoutes = new LruCache<string, boolean>(1000);
  const counters = { events: 0, skipped: 0, sourceReads: 0, transactionAttempts: 0, committed: 0, publicBytes: 0 };
  let stopped = false;
  const routeTails = new Map<string, Promise<void>>();
  const materialize = async (key: string, routeId: string) => {
    assertWorkerLeadership();
    // Persist discoverability before the view: a crash cannot leave an orphan
    // projection outside the bounded startup/removal reconciliation scan.
    if (!registeredRoutes.get(routeId)) {
      await workerRtdbTransaction(rtdb.ref("liveRouteCatalog"), current => {
        if (stopped || current?.values?.[routeId]) return;
        return { ...current, values: { ...current?.values, [routeId]: { active: 0, available: 0, freshestAt: 0 } } };
      });
      registeredRoutes.set(routeId, true);
    }
    // Replay and queued notifications read current authority, never publish an old captured session.
    counters.sourceReads++;
    const snapshot = await rtdb.ref(`activeBuses/${key}`).once("value");
    if (stopped) return;
    const live = publicLiveBus(snapshot.val());
    const value = live?.routeId === routeId && key === `${live.busId}_${routeId}` ? live : null;
    const result = await workerRtdbTransaction(rtdb.ref(`publicRouteBuses/${routeId}`), current => {
      counters.transactionAttempts++;
      if (stopped) return;
      const previous = current?.buses?.[key] ?? null;
      if (JSON.stringify(previous) === JSON.stringify(value)) return;
      const buses = { ...(current?.buses ?? {}) };
      if (value) buses[key] = value; else delete buses[key];
      return { ...current, buses, revision: Number(current?.revision ?? 0) + 1 };
    });
    if (result.committed) { counters.committed++; counters.publicBytes += Buffer.byteLength(JSON.stringify(value)); }
    // An abort can also mean a newer generation rejected the write; keep catalog reads canonical.
    const view = result.snapshot.val();
    const availability = routeAvailability(view?.buses ?? {});
    const fingerprint = JSON.stringify(availability);
    if (catalogFingerprints.get(routeId) === fingerprint) return;
    const revision = Number(view?.revision ?? 0);
    const catalog = await workerRtdbTransaction(rtdb.ref("liveRouteCatalog"), current => {
      if (stopped || Number(current?.revisions?.[routeId] ?? 0) > revision) return;
      return { ...current, values: { ...current?.values, [routeId]: availability },
        revisions: { ...current?.revisions, [routeId]: revision } };
    });
    if (catalog.committed) catalogFingerprints.set(routeId, fingerprint);
  };
  const scheduler = createLatestPendingScheduler<string, string>(async (key, routeId) => {
    const previous = routeTails.get(routeId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => materialize(key, routeId));
    routeTails.set(routeId, task);
    try { await task; } finally { if (routeTails.get(routeId) === task) routeTails.delete(routeId); }
  }, (key, error) => {
    fingerprints.delete(key); replay.request();
    recordBackgroundFailure("worker.liveProjection", "Public live projection", "[LiveProjection] Materialization failed:", error);
  }, () => performance.now(), { maxConcurrent: 2, maxPending: 64, maxQueueAgeMs: 5000 });
  const schedule = (key: string, routeId: string) => {
    const busId = key.slice(0, -(routeId.length + 1));
    if (stopped || !SAFE_ID.test(routeId) || !SAFE_ID.test(busId) || key !== `${busId}_${routeId}`) return false;
    return scheduler.schedule(key, routeId);
  };
  type Item = { key: string; routeId: string };
  const replay = createPagedLifecycleReplay<Item>({
    hasCapacity: () => !stopped && scheduler.snapshot().pendingKeys < 32,
    async readPage(cursor, limit) {
      assertWorkerLeadership();
      const position = cursor ? JSON.parse(cursor) : { phase: "live", key: "" };
      if (position.phase === "live") {
        let query = source.orderByKey();
        if (position.key) query = query.startAfter(position.key);
        const page = await query.limitToFirst(limit).once("value");
        const items: Item[] = []; let last = ""; let count = 0;
        page.forEach(child => { count++; last = child.key!; const live = publicLiveBus(child.val());
          if (live) items.push({ key: child.key!, routeId: live.routeId as string }); });
        return { items, nextCursor: JSON.stringify(count === limit ? { phase: "live", key: last } : { phase: "views", route: "", key: "" }) };
      }
      let route = position.route as string;
      if (!position.key) {
        let query = rtdb.ref("liveRouteCatalog/values").orderByKey();
        if (route) query = query.startAfter(route);
        const page = await query.limitToFirst(1).once("value");
        route = ""; page.forEach(child => { route = child.key!; });
        if (!route) return { items: [], nextCursor: null };
      }
      let query = rtdb.ref(`publicRouteBuses/${route}/buses`).orderByKey();
      if (position.key) query = query.startAfter(position.key);
      const page = await query.limitToFirst(limit).once("value");
      const items: Item[] = []; page.forEach(child => { items.push({ key: child.key!, routeId: route }); });
      return { items, nextCursor: JSON.stringify({ phase: "views", route, key: items.length === limit ? items.at(-1)!.key : "" }) };
    },
    admit: item => schedule(item.key, item.routeId),
    onError: error => recordBackgroundFailure("worker.liveProjectionReplay", "Public view recovery", "[LiveProjection] Recovery failed:", error),
  });
  const receive = bindWorkerCallback((snapshot: import("firebase-admin/database").DataSnapshot) => {
    counters.events++;
    const raw = snapshot.val(); const live = publicLiveBus(raw); const key = snapshot.key;
    if (!key || !live) { replay.request(); return; }
    const fingerprint = JSON.stringify(live);
    if (fingerprints.get(key) === fingerprint) { counters.skipped++; return; }
    if (schedule(key, live.routeId as string)) fingerprints.set(key, fingerprint); else replay.request();
  });
  const removed = bindWorkerCallback((snapshot: import("firebase-admin/database").DataSnapshot) => {
    const live = publicLiveBus(snapshot.val());
    if (snapshot.key && live) { fingerprints.delete(snapshot.key); if (!schedule(snapshot.key, live.routeId as string)) replay.request(); }
  });
  const fail = bindWorkerCallback(() => replay.request());
  source.on("child_added", receive, fail); source.on("child_changed", receive, fail); source.on("child_removed", removed, fail);
  projectionStatus = () => ({ ...scheduler.snapshot(), ...counters });
  replay.request();
  const timer = setInterval(() => { void replay.tick(); }, 1000); timer.unref();
  const recover = setInterval(() => replay.request(), 60_000); recover.unref();
  return async () => {
    stopped = true; clearInterval(timer); clearInterval(recover); replay.stop();
    source.off("child_added", receive); source.off("child_changed", receive); source.off("child_removed", removed);
    await Promise.allSettled([scheduler.drain(), replay.pending()]);
  };
}
