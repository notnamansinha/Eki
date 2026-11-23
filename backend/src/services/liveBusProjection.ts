import { isDeepStrictEqual } from "node:util";
import { liveProjectionWriterRtdb, rtdb } from "../lib/firebaseAdmin";
import { assertWorkerLeadership, bindWorkerCallback, bindWorkerContext, isRtdbPermissionDenied, workerRtdbFencedUpdate, workerRtdbTransaction, workerGeneration } from "../lib/workerFence";
import { createLatestPendingScheduler } from "../lib/latestPendingScheduler";
import { LruCache } from "../lib/lruCache";
import { createPagedLifecycleReplay } from "./pagedLifecycleReplay";
import { recordBackgroundFailure } from "../lib/backgroundFailureTracker";
import { drainDynamicPromises } from "./tripStateLifecycle";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const projectionRouteKey = (routeId: string) => `route:${routeId}`;
const projectionBusKey = (key: string) => `node:${key}`;
const decodeRoute = (key: string) => key.startsWith("route:") ? key.slice(6) : key;
const decodeBus = (key: string) => key.startsWith("node:") ? key.slice(5) : key;
const PUBLIC_FIELDS = [
  "busId", "routeId", "driverId", "sessionId", "lat", "lng", "speed", "heading", "timestamp", "seq",
  "deviceSentAt", "backendReceivedAt", "receivedAt", "status", "deviceState", "signalState", "motionState",
  "tripState", "currentStopIndex", "delayMinutes", "direction", "directionState", "originStopId", "destinationStopId",
  "automaticServicePaused", "automaticServiceState",
  "activeRouteId", "routeVersion", "routeSource", "routeState", "routeDirection", "routeGeometryVersion",
  "routeComputedAt", "routeTrafficState",
  "mapMatchSeq", "mapMatchSampledAt", "mapMatchUpdatedAt", "matchConfidence", "distanceToActiveRoute",
] as const;
const RAW_FIELDS = ["lat", "lng", "speed", "heading", "gpsHdop", "motionState", "seq", "sampledAt"];
const MAX_PUBLIC_STOP_INDEX = 500;
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
  if (typeof live.retiredAssignmentRevision === "number") return null;
  if (typeof live.busId !== "string" || !SAFE_ID.test(live.busId) ||
      typeof live.routeId !== "string" || !SAFE_ID.test(live.routeId)) return null;
  const output: Record<string, unknown> = pick(live, PUBLIC_FIELDS);
  if (typeof live.lastCompletedSessionId === "string" && SAFE_ID.test(live.lastCompletedSessionId) && typeof live.lastCompletedAt === "number" && Number.isFinite(live.lastCompletedAt) && typeof live.lastCompletedRouteId === "string" && SAFE_ID.test(live.lastCompletedRouteId)) {
    output.lastCompletedSessionId = live.lastCompletedSessionId;
    output.lastCompletedAt = live.lastCompletedAt;
    output.lastCompletedRouteId = live.lastCompletedRouteId;
  }
  // Legacy automatic return activation also carries bounded predecessor proof.
  if (live.automaticTurnaround === true && typeof live.previousSessionId === "string" &&
      SAFE_ID.test(live.previousSessionId) && live.previousSessionId !== live.sessionId) {
    output.automaticTurnaround = true;
    output.previousSessionId = live.previousSessionId;
  }
  // The stop the bus is at, and the stops this ride passed without observing
  // them (a bounded list), published only for the session that recorded them.
  const atStop = live.atStop as { sessionId?: unknown; index?: unknown } | null | undefined;
  if (atStop && typeof live.sessionId === "string" && atStop.sessionId === live.sessionId &&
      Number.isSafeInteger(atStop.index) && Number(atStop.index) >= 0 && Number(atStop.index) < MAX_PUBLIC_STOP_INDEX) {
    output.atStopIndex = Number(atStop.index);
  }
  const unobserved = live.unobservedStops as { sessionId?: unknown; indices?: unknown } | null | undefined;
  if (unobserved && typeof live.sessionId === "string" && unobserved.sessionId === live.sessionId) {
    const raw = Array.isArray(unobserved.indices) ? unobserved.indices
      : unobserved.indices && typeof unobserved.indices === "object" ? Object.values(unobserved.indices) : [];
    const indices = [...new Set(raw.filter((index): index is number =>
      Number.isSafeInteger(index) && Number(index) >= 0 && Number(index) < MAX_PUBLIC_STOP_INDEX))]
      .sort((left, right) => left - right).slice(0, MAX_PUBLIC_STOP_INDEX);
    if (indices.length > 0) output.unobservedStopIndices = indices;
  }
  for (const [field, fields] of [["rawLocation", RAW_FIELDS], ["matchedLocation", MATCH_FIELDS]] as const) {
    const nested = live[field];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const selected = pick(nested as Record<string, unknown>, fields);
      if (Object.keys(selected).length) output[field] = selected;
    }
  }
  return output;
}

export function routeAvailability(buses: Record<string, Record<string, unknown>>, now = Date.now()) {
  let active = 0; let available = 0; let freshestAt = 0;
  const activeReceipts: number[] = [], availableReceipts: number[] = [];
  for (const bus of Object.values(buses)) {
    if (bus.tripState === "completed") continue;
    const isRide = bus.status === "active" && typeof bus.sessionId === "string" &&
      (bus.tripState === "pre_departure" || bus.tripState === "in_service");
    const sample = typeof bus.timestamp === "number" ? bus.timestamp : NaN;
    const received = bus.backendReceivedAt;
    const at = typeof received === "number" && Number.isFinite(received) && received - sample >= -10_000 && received - sample <= 60_000 ? received : sample;
    if (bus.deviceState !== "online" || bus.automaticServicePaused === true || !Number.isFinite(at) || at > now + 10_000 || now - at > 90_000) continue;
    // Conservative 30s leases expire 60–90s after the last fix. Unlike a raw
    // receipt on every fix, this bounds catalog heartbeat writes to 2/min/bus.
    // A durable ride/session alone must never advertise live availability.
    const receipt = Math.floor(at / 30_000) * 30_000;
    if (now - receipt > 90_000) continue;
    if (isRide) { active++; activeReceipts.push(receipt); }
    else { available++; availableReceipts.push(receipt); }
    freshestAt = Math.max(freshestAt, receipt);
  }
  return { active, available, freshestAt, activeReceipts: activeReceipts.sort((a, b) => a - b), availableReceipts: availableReceipts.sort((a, b) => a - b) };
}

type RouteNode = { buses?: Record<string, Record<string, unknown>>; revision?: number; _workerGeneration?: number };
/**
 * The leader's copy of one route's public buses and revision, as last confirmed
 * by the database. `epoch` is the recovery pass in which the claim behind it began.
 */
type RouteView = { buses: Record<string, Record<string, unknown>>; revision: number; epoch: number };
const isMap = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The smallest multi-path update that turns `previous` into `next` at `path`:
 * changed leaves, `null` for removed ones, and a whole value where there was
 * none (or an array, which is replaced as a unit). Every leaf repeats its full
 * path on the wire, so a map most of whose fields changed is replaced whole
 * when that serializes smaller. No returned path is an ancestor of another,
 * as a multi-path update requires.
 */
export function projectionLeafChanges(path: string, previous: unknown, next: unknown, changes: Record<string, unknown> = {}): Record<string, unknown> {
  if (isMap(previous) && isMap(next)) {
    const leaves: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      projectionLeafChanges(`${path}/${key}`, Object.hasOwn(previous, key) ? previous[key] : null, Object.hasOwn(next, key) ? next[key] : null, leaves);
    }
    if (Object.keys(leaves).length === 0) return changes;
    if (JSON.stringify(leaves).length > JSON.stringify({ [path]: next }).length) changes[path] = next;
    else Object.assign(changes, leaves);
  } else if (!isDeepStrictEqual(previous ?? null, next ?? null)) changes[path] = next ?? null;
  return changes;
}

/** After rules deny a write that follows a fresh claim, use whole-node transactions this long before probing again. */
const LEAF_WRITE_RETRY_MS = 5 * 60_000;

let projectionStatus = () => ({ scheduled: 0, processed: 0, coalesced: 0, failed: 0, rejected: 0 });
export function getLiveBusProjectionStatus() { return projectionStatus(); }

/** Leader-owned materialization, separate from durable lifecycle FIFO work. */
export function startLiveBusProjection(): () => Promise<void> {
  // Firebase invokes transaction retries from its own async resources. Capture
  // the elected generation here rather than consulting caller context there.
  const generation = workerGeneration();
  const source = rtdb.ref("activeBuses");
  const fingerprints = new LruCache<string, string>(1000);
  const catalogFingerprints = new LruCache<string, string>(1000);
  const registeredRoutes = new LruCache<string, boolean>(1000);
  // Startup coverage must not wait for a continuously updating fleet to go
  // globally idle. Remember successful publications and only wait for keys
  // whose first publication (or failed recovery) has not settled yet.
  const startupPublished = new LruCache<string, boolean>(1000);
  const startupPending = new Set<string>();
  const counters = { events: 0, skipped: 0, sourceReads: 0, sourceReadBytes: 0, reconstructionReads: 0, reconstructionReadBytes: 0, transactionAttempts: 0, committed: 0, publicBytes: 0, catalogTransactionAttempts: 0, committedCatalogWrites: 0, catalogPublicBytes: 0,
    routeClaims: 0, leafWriteAttempts: 0, leafWrites: 0, leafWriteDenials: 0, leafWriteFallbacks: 0 };
  // Per-bus leaf writes need a generation for the rules to compare. An
  // unfenced run and LIVE_PROJECTION_WRITE_MODE=transaction keep the
  // whole-node transaction for every publication.
  const leafCapable = generation > 0 && process.env.LIVE_PROJECTION_WRITE_MODE?.trim().toLowerCase() !== "transaction";
  let leafRetryAt = 0;
  const routeViews = new LruCache<string, RouteView>(1000);
  // Advanced as each recovery pass starts. A copy whose claim began earlier can
  // miss an edit made without a revision, such as an erased bus or route, and a
  // replay that matches such a copy would write nothing. Publications therefore
  // claim each route afresh once per pass before comparing against it.
  let viewEpoch = 0;
  let stopped = false;
  let initialized = false, readyPublished = false, readinessWrite: Promise<void> | null = null, stopPromise: Promise<void> | null = null;
  const report = (error: unknown) => recordBackgroundFailure("worker.liveProjection", "Public live projection", "[LiveProjection] Materialization/recovery failed:", error);
  const routeTails = new Map<string, Promise<void>>();
  /** One publication at a time per route, so the leader's copy changes in the order its writes land. */
  const inRoute = <T>(routeId: string, work: () => Promise<T>): Promise<T> => {
    const task = (routeTails.get(routeId) ?? Promise.resolve()).then(work);
    const tail = task.then(() => {}, () => {});
    routeTails.set(routeId, tail);
    void tail.then(() => { if (routeTails.get(routeId) === tail) routeTails.delete(routeId); });
    return task;
  };
  // Revisions belong to one publisher generation. Preserve every route's
  // previous lineage when the global catalog first advances to a successor.
  const catalogGenerations = (current: { values?: Record<string, unknown>; generations?: Record<string, number>; _workerGeneration?: number } | null) =>
    Object.fromEntries(Object.keys(current?.values ?? {}).map(key => [key, current?.generations?.[key] ?? Number(current?._workerGeneration ?? 0)]));
  async function publishCatalog(routeId: string, view: { buses?: Record<string, Record<string, unknown>>; revision?: number } | null) {
    if (stopped) return;
    assertWorkerLeadership();
    const routeKey = projectionRouteKey(routeId), availability = routeAvailability(view?.buses ?? {});
    const fingerprint = JSON.stringify(availability);
    if (catalogFingerprints.get(routeId) === fingerprint) return;
    const revision = Number(view?.revision ?? 0);
    const catalog = await workerRtdbTransaction(rtdb.ref("liveRouteCatalog"), current => {
      counters.catalogTransactionAttempts++;
      const generations = catalogGenerations(current);
      if (stopped || (generations[routeKey] === generation && Number(current?.revisions?.[routeKey] ?? 0) > revision)) return;
      return { ...current, values: { ...current?.values, [routeKey]: availability }, revisions: { ...current?.revisions, [routeKey]: revision }, generations: { ...generations, [routeKey]: generation } };
    });
    if (catalog.committed) { catalogFingerprints.set(routeId, fingerprint); counters.committedCatalogWrites++; counters.catalogPublicBytes += Buffer.byteLength(JSON.stringify(catalog.snapshot.val()?.values ?? null)); }
  }
  /**
   * Whole-node transaction, run once per route per leadership and once per
   * recovery pass, never per fix. It stamps this generation (rejected when a
   * newer one already has) and restores a lost revision lineage above `floor`.
   * A publication (`adopt`, inside `inRoute`) keeps the authoritative node as
   * the copy its leaf writes are diffed against. It never aborts and adopts
   * only a committed result: the SDK can resolve an abort from local state that
   * includes another transaction's unconfirmed output, and a commit is accepted
   * only against the server's current value. Recovery runs beside publications
   * and must not replace a copy they may be changing, so it discards the copy
   * instead: the next publication claims afresh, which repairs a destination
   * that changed without a revision. A copy is stamped with the pass in which
   * its claim began, so one that began before a pass started is not reused by
   * that pass's replay (see `viewEpoch`).
   */
  async function claimRoute(routeId: string, floor: number, adopt: boolean): Promise<{ view: RouteView | null; node: RouteNode | null }> {
    counters.routeClaims++;
    const epoch = viewEpoch;
    const result = await workerRtdbTransaction(rtdb.ref(`publicRouteBuses/${projectionRouteKey(routeId)}`), current => {
      counters.transactionAttempts++;
      if (stopped) return;
      const revision = Number(current?.revision ?? 0);
      const rebuilding = !current || revision < floor;
      if (!adopt && !rebuilding && current?._workerGeneration === generation && typeof current.revision === "number") return;
      return { ...current, buses: current?.buses ?? {}, revision: rebuilding ? Math.max(revision, floor) + 1 : revision };
    });
    const node = result.snapshot.val() as RouteNode | null;
    const view = adopt && result.committed && !stopped && leafCapable && node?._workerGeneration === generation && typeof node.revision === "number"
      ? { buses: { ...node.buses }, revision: node.revision, epoch } : null;
    if (view) routeViews.set(routeId, view); else routeViews.delete(routeId);
    return { view, node };
  }
  /** The original publication: replaces the route node, so every listener is resent every bus on the route. */
  async function publishBusByTransaction(routeId: string, busKey: string, value: Record<string, unknown> | null): Promise<RouteNode | null> {
    routeViews.delete(routeId);
    const result = await workerRtdbTransaction(rtdb.ref(`publicRouteBuses/${projectionRouteKey(routeId)}`), current => {
      counters.transactionAttempts++;
      if (stopped) return;
      const previous = current?.buses?.[busKey] ?? null;
      if (isDeepStrictEqual(previous, value)) return current?._workerGeneration === generation ? undefined : { ...current };
      const buses = { ...(current?.buses ?? {}) };
      if (value) buses[busKey] = value; else delete buses[busKey];
      return { ...current, buses, revision: Number(current?.revision ?? 0) + 1 };
    });
    if (result.committed && !stopped) { counters.committed++; counters.publicBytes += Buffer.byteLength(JSON.stringify(value)); }
    // An abort can also mean a newer generation rejected the write; keep catalog reads canonical.
    return result.snapshot.val();
  }
  /**
   * Publishes one bus as a multi-path update of only its changed leaves, so a
   * listener downloads those leaves rather than every bus on the route. The
   * rules accept the update only while the stored generation and revision are
   * the ones this leader last confirmed (see `workerRtdbFencedUpdate`).
   * Returns the route as now known, or null when nothing may be concluded.
   */
  async function publishBus(routeId: string, busKey: string, value: Record<string, unknown> | null): Promise<RouteNode | RouteView | null> {
    if (!leafCapable || performance.now() < leafRetryAt) return publishBusByTransaction(routeId, busKey, value);
    for (let attempt = 0; attempt < 2; attempt++) {
      let view = routeViews.get(routeId);
      // A copy from before the current recovery pass may still list a bus that
      // was erased since; comparing a replay against it could skip the repair.
      if (!view || view.epoch !== viewEpoch) {
        const claim = await claimRoute(routeId, 0, true);
        if (stopped) return null;
        // A newer generation owns the destination (or the claim could not
        // commit): only a confirmed owner may write there.
        if (!claim.view) return claim.node;
        view = claim.view;
      }
      const changes = projectionLeafChanges(`buses/${busKey}`, Object.hasOwn(view.buses, busKey) ? view.buses[busKey] : null, value);
      if (Object.keys(changes).length === 0) return view;
      counters.leafWriteAttempts++;
      try {
        await workerRtdbFencedUpdate(liveProjectionWriterRtdb().ref(`publicRouteBuses/${projectionRouteKey(routeId)}`), { ...changes, revision: view.revision + 1 });
      } catch (error) {
        // The copy can no longer be trusted, whatever failed.
        routeViews.delete(routeId);
        if (!isRtdbPermissionDenied(error)) throw error;
        counters.leafWriteDenials++;
        if (stopped) return null;
        // Claim again: that tells a successor's takeover (stop writing) from a
        // drifted copy or a write the SDK resent after a lost acknowledgement.
        continue;
      }
      if (value) view.buses[busKey] = value; else delete view.buses[busKey];
      view.revision++;
      counters.committed++; counters.leafWrites++; counters.publicBytes += Buffer.byteLength(JSON.stringify(changes));
      return view;
    }
    // Denied twice, the second time straight after a successful claim: the
    // deployed rules do not grant the fenced writer. The transaction is fenced
    // on its own, so publication continues at the old download cost.
    leafRetryAt = performance.now() + LEAF_WRITE_RETRY_MS;
    counters.leafWriteFallbacks++;
    console.warn("[LiveProjection] Rules denied the per-bus projection write after a fresh claim; using whole-route transactions for 5 minutes. Deploy database.rules.json to restore leaf writes.");
    return publishBusByTransaction(routeId, busKey, value);
  }
  const materialize = async (key: string, routeId: string) => {
    if (stopped) return;
    assertWorkerLeadership();
    const routeKey = projectionRouteKey(routeId), busKey = projectionBusKey(key);
    // Persist discoverability before the view: a crash cannot leave an orphan
    // projection outside the bounded startup/removal reconciliation scan.
    if (!registeredRoutes.get(routeId)) {
      const registered = await workerRtdbTransaction(rtdb.ref("liveRouteCatalog"), current => {
        counters.catalogTransactionAttempts++;
        if (stopped) return;
        if (current?.values?.[routeKey]) return current?._workerGeneration === generation ? undefined : { ...current, generations: catalogGenerations(current) };
        return { ...current, generations: catalogGenerations(current), values: { ...current?.values, [routeKey]: { active: 0, available: 0, freshestAt: 0, activeReceipts: [], availableReceipts: [] } } };
      });
      if (registered.committed) { counters.committedCatalogWrites++; counters.catalogPublicBytes += Buffer.byteLength(JSON.stringify(registered.snapshot.val()?.values ?? null)); }
      if (stopped) return;
      registeredRoutes.set(routeId, true);
    }
    // Replay and queued notifications read current authority, never publish an old captured session.
    counters.sourceReads++;
    const snapshot = await rtdb.ref(`activeBuses/${key}`).once("value");
    counters.sourceReadBytes += Buffer.byteLength(JSON.stringify(snapshot.val()));
    if (stopped) return;
    const live = publicLiveBus(snapshot.val());
    const value = live?.routeId === routeId && key === `${live.busId}_${routeId}` ? live : null;
    assertWorkerLeadership();
    const view = await publishBus(routeId, busKey, value);
    if (stopped) return;
    assertWorkerLeadership();
    await publishCatalog(routeId, view);
  };
  const scheduler = createLatestPendingScheduler<string, string>(async (key, routeId) => {
    await inRoute(routeId, () => materialize(key, routeId));
    if (!stopped) { startupPublished.set(key, true); startupPending.delete(key); }
  }, (key, error) => {
    startupPublished.delete(key);
    startupPending.delete(key);
    fingerprints.delete(key); replay.request();
    recordBackgroundFailure("worker.liveProjection", "Public live projection", "[LiveProjection] Materialization failed:", error);
  }, () => performance.now(), { maxConcurrent: 2, maxPending: 64, maxQueueAgeMs: 5000 });
  const schedule = (key: string, routeId: string) => {
    const busId = key.slice(0, -(routeId.length + 1));
    if (stopped || !SAFE_ID.test(routeId) || !SAFE_ID.test(busId) || key !== `${busId}_${routeId}`) return false;
    const needsStartupPublication = !readyPublished && !startupPublished.get(key);
    const alreadyPending = startupPending.has(key);
    // Enrollment precedes dispatch, including synchronous executor admission.
    if (needsStartupPublication) startupPending.add(key);
    const admitted = scheduler.schedule(key, routeId);
    if (!admitted && !alreadyPending) startupPending.delete(key);
    return admitted;
  };
  type Item = { key: string; routeId: string };
  const replay = createPagedLifecycleReplay<Item>({
    hasCapacity: () => !stopped && scheduler.snapshot().pendingKeys < 32,
    async readPage(cursor, limit) {
      assertWorkerLeadership();
      // A new pass replays every source bus: refresh each route's copy before
      // the first replay compares against it, so this pass repairs it.
      if (!cursor) viewEpoch++;
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
      if (!SAFE_ID.test(decodeRoute(route))) return { items: [], nextCursor: JSON.stringify({ phase: "views", route, key: "" }) };
      const routeId = decodeRoute(route), canonicalRoute = projectionRouteKey(routeId);
      let recoveredView: { buses?: Record<string, Record<string, unknown>>; revision?: number } | null = null;
      if (!position.key && !stopped) {
        // One fixed read per recovery page origin, never per telemetry fix.
        // A destination can disappear within the same generation. Restore its
        // revision lineage above the observed catalog without letting a delayed
        // older publication bypass the ordinary revision fence.
        const floorSnapshot = await rtdb.ref(`liveRouteCatalog/revisions/${canonicalRoute}`).once("value");
        counters.reconstructionReads++;
        counters.reconstructionReadBytes += Buffer.byteLength(JSON.stringify(floorSnapshot.val()));
        if (stopped) return { items: [], nextCursor: null };
        const observed = Number(floorSnapshot.val() ?? 0);
        const floor = Number.isSafeInteger(observed) && observed >= 0 ? observed : 0;
        recoveredView = (await claimRoute(routeId, floor, false)).node;
      }
      if (stopped) return { items: [], nextCursor: null };
      assertWorkerLeadership();
      let query = rtdb.ref(`publicRouteBuses/${canonicalRoute}/buses`).orderByKey();
      if (position.key) query = query.startAfter(position.key);
      const page = await query.limitToFirst(limit).once("value");
      const items: Item[] = []; let last = ""; page.forEach(child => { last = child.key!; items.push({ key: decodeBus(child.key!), routeId: decodeRoute(route) }); });
      if (!stopped && !position.key && items.length === 0) {
        // The restored tombstone carries the canonical catalog lineage even
        // when there is no bus task to dispatch.
        await publishCatalog(routeId, recoveredView);
      }
      return { items, nextCursor: JSON.stringify({ phase: "views", route, key: items.length === limit ? last : "" }) };
    },
    admit: item => schedule(item.key, item.routeId),
    onError: error => recordBackgroundFailure("worker.liveProjectionReplay", "Public view recovery", "[LiveProjection] Recovery failed:", error),
  });
  const receive = bindWorkerCallback((snapshot: import("firebase-admin/database").DataSnapshot) => {
    counters.events++;
    const raw = snapshot.val(); const live = publicLiveBus(raw); const key = snapshot.key;
    if (key && !live && typeof raw?.retiredAssignmentRevision === "number" &&
        typeof raw.routeId === "string" && key === `${raw.busId}_${raw.routeId}`) {
      fingerprints.delete(key);
      if (!schedule(key, raw.routeId)) replay.request();
      return;
    }
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
  projectionStatus = () => ({ ...scheduler.snapshot(), ...counters, writeMode: !leafCapable ? "transaction" : performance.now() < leafRetryAt ? "transaction-fallback" : "leaf" });
  replay.request();
  function publishReadiness(ready: boolean) {
    if (stopped || readinessWrite) return;
    const writing = Promise.resolve().then(() => {
      if (stopped) return null;
      return workerRtdbTransaction(rtdb.ref("clientProjectionStatus"), () => {
      if (stopped) return;
      const recovery = replay.snapshot();
      if (ready && (startupPending.size || recovery.requested || recovery.inFlight)) return;
      return { public: { schemaVersion: 1, ready } };
      });
    }).then(result => { if (result?.committed && !stopped) { initialized = true; readyPublished = ready; } }).catch(report).finally(() => { if (readinessWrite === writing) readinessWrite = null; });
    readinessWrite = writing;
  }
  publishReadiness(false);
  const timer = setInterval(bindWorkerContext(() => {
    if (stopped) return;
    if (!initialized) { publishReadiness(false); return; }
    void replay.tick().then(() => {
      const recovery = replay.snapshot();
      if (!readyPublished && !stopped && !startupPending.size && !recovery.requested && !recovery.inFlight) publishReadiness(true);
    }).catch(report);
  }), 1000); timer.unref();
  const recover = setInterval(() => replay.request(), 60_000); recover.unref();
  return bindWorkerContext(() => {
    if (stopPromise) return stopPromise;
    stopped = true; clearInterval(timer); clearInterval(recover); replay.stop();
    source.off("child_added", receive); source.off("child_changed", receive); source.off("child_removed", removed);
    let drained = false;
    const draining = scheduler.drain().then(() => { drained = true; });
    stopPromise = drainDynamicPromises(() => [...(!drained ? [draining] : []), ...(replay.pending() ? [replay.pending()!] : []), ...(readinessWrite ? [readinessWrite] : [])], Date.now() + 8000).then(() => {});
    return stopPromise;
  });
}
