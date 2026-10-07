import { assertWorkerLeadership, bindWorkerCallback, bindWorkerContext, workerTransaction, workerRtdbTransaction } from "../lib/workerFence";
import { BoundedKeyedExecutor } from "../lib/boundedKeyedExecutor";
import { createStaleBusSweeper } from "./staleBusSweeper";
import { createPagedLifecycleReplay } from "./pagedLifecycleReplay";
import { endpointSnapshotVersion } from "../lib/endpointSnapshotVersion";
import { db, rtdb } from "../lib/firebaseAdmin";
import { FieldPath, FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { DataSnapshot } from "firebase-admin/database";
import type { Reference } from "firebase-admin/database";
import { LruCache } from "../lib/lruCache";
import { recordBackgroundFailure } from "../lib/backgroundFailureTracker";
import {
  automaticTurnaroundIsReady,
  oppositeRideDirection,
} from "../lib/automaticRideDirection";
import { withoutLiveRouteContext } from "../lib/liveRouteContext";
import { SerializedChangeWriter } from "./serializedChangeWriter";
import { restoreDurableRide } from "./durableRideRecovery";
import { reduceTripState } from "./tripStateReducer";
import { missingStopHistory } from "./rideProgressHistory";
import {
  normalizeRideDirection,
  stopsInRideDirection,
} from "../lib/rideDirection";
import {
  drainDynamicPromises,
  normalizeIdentifier,
  normalizeLiveBusData,
} from "./tripStateLifecycle";

interface RouteStop { id: string; lat: number; lng: number; name: string; }
interface PendingCompletion {
  timeoutId: NodeJS.Timeout;
  run: () => Promise<void>;
}
// Bounded in-memory state (issue #37): every long-lived map is LRU-capped so
// a long-running engine cannot leak memory as bus/route keys churn. The two
// remaining plain collections self-clean — routeLoadPromises holds only
// in-flight loads (each deletes itself on settle) and backgroundTasks holds
// only tracked tasks (each removes itself in finally) — so they are bounded
// by concurrency, not by history.
const MAX_CACHE_ENTRIES = 1_000;
const routeStopsCache = new LruCache<string, RouteStop[]>(MAX_CACHE_ENTRIES);
const routeLoadPromises = new Map<string, Promise<RouteStop[]>>();
const missingRouteUntil = new LruCache<string, number>(MAX_CACHE_ENTRIES);
const completedTimeouts = new LruCache<string, PendingCompletion>(
  MAX_CACHE_ENTRIES,
  (key, completion) => {
    // Evicting a completion must not drop terminal state: retire the session
    // immediately instead of waiting for its 30s timer.
    clearTimeout(completion.timeoutId);
    void completion.run();
  },
);
// Serialized change-only writers: per-key FIFO queues plus fingerprint dedup
// for the durable fleet projection, the active-ride projection and telemetry.
const durableExecution = new BoundedKeyedExecutor<string>();
const fleetWrites = new SerializedChangeWriter(MAX_CACHE_ENTRIES, { executor: durableExecution });
const activeRideWrites = new SerializedChangeWriter(MAX_CACHE_ENTRIES, { executor: durableExecution });
const telemetryWrites = new SerializedChangeWriter(MAX_CACHE_ENTRIES);
let requestLifecycleReplay: (() => void) | null = null;
let replayStatus: (() => { requested: boolean; inFlight: boolean; scanned: number; failures: number; pageSize: number }) | null = null;

let staleSweepStatus: (() => ReturnType<ReturnType<typeof createStaleBusSweeper>["snapshot"]>) | null = null;

export function getTripStateQueueStatus() {
  return { lifecycle: durableExecution.snapshot(), intake: telemetryWrites.snapshot(),
    staleSweep: staleSweepStatus?.() ?? null,
    recovery: replayStatus?.() ?? { requested: false, inFlight: false, scanned: 0, failures: 0, pageSize: 25 } };
}
const backgroundTasks = new Set<Promise<void>>();
interface TelemetrySample {
  timestamp: number;
  lat: number;
  lng: number;
}
interface RideCheckpoint {
  tripState: "pre_departure" | "in_service";
  currentStopIndex: number;
  hasDepartedOrigin: boolean;
}
const processedTelemetry = new LruCache<string, TelemetrySample>(MAX_CACHE_ENTRIES);

export function lifecycleDirection(data: Record<string, unknown>) {
  return normalizeRideDirection(data.direction);
}

/**
 * Parses an environment-derived interval with a fallback and a lower bound.
 *
 * Returns `fallback` when `value` is not a finite number or is below
 * `minimum`; otherwise the floored parsed value.
 */
function readIntervalMs(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

const STALE_BUS_MS = readIntervalMs(process.env.BUS_STALE_MS, 300_000, 90_000);
const AUTOMATIC_TURNAROUND_DWELL_MS = readIntervalMs(
  process.env.AUTOMATIC_TURNAROUND_DWELL_MS,
  0,
  0,
);
const TURNAROUND_CLAIM_STALE_MS = 60_000;
const MISSING_ROUTE_TTL_MS = 60_000;
const ROUTE_RECONNECT_INITIAL_MS = 1_000;
const ROUTE_RECONNECT_MAX_MS = 30_000;
const ENGINE_SHUTDOWN_TIMEOUT_MS = 8_000;
const ENGINE_COMPLETION_FLUSH_MS = 2_000;

/** Normalizes a raw RTDB fleet event into the durable lifecycle state shape. */
function fleetLifecycleState(data: Record<string, unknown>) {
  return {
    sessionId: normalizeIdentifier(data.sessionId),
    routeId: normalizeIdentifier(data.routeId),
    driverId: typeof data.driverId === "string" ? data.driverId : null,
    status: typeof data.status === "string" ? data.status : "active",
    deviceState: typeof data.deviceState === "string" ? data.deviceState : "online",
    tripState: typeof data.tripState === "string" ? data.tripState : "pre_departure",
    // Direction is deliberately nullable for device-only and newly armed
    // pending nodes. Do not silently classify an unresolved ride as forward.
    direction: lifecycleDirection(data),
    // Persist the live GNSS state so analytics can count signal loss; without
    // it the admin panel's signalLost count under-reported (issue #48 L2).
    motionState: typeof data.motionState === "string" ? data.motionState : null,
  };
}

/**
 * Fingerprints the lifecycle-relevant fields of a fleet event so unchanged
 * state can be skipped by the serialized writer's dedup.
 */
function lifecycleFingerprint(
  state: ReturnType<typeof fleetLifecycleState>,
): string {
  return JSON.stringify({
    ...state,
  });
}

/** Clamps a delay value to a non-negative safe integer, defaulting to 0. */
function delayRevision(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : 0;
}

/** Clamps a delay in minutes to 0..1440 (one day), defaulting to 0. */
function normalizedDelayMinutes(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1440
    ? Number(value)
    : 0;
}

/**
 * Claims and arms the opposite ride after a completed bus has dwelled stopped
 * at the endpoint. RTDB supplies the cross-replica claim; Firestore supplies
 * the durable unique-bus lock. A crash after the durable commit is recovered
 * on the leader's completed-node snapshot or the next accepted telemetry fix,
 * reusing the lock-owned return session rather than creating another claim.
 */
async function maybeArmAutomaticTurnaround(
  data: Record<string, unknown>,
  naturalStops: RouteStop[],
  nodeRef: Reference,
): Promise<boolean> {
  const previousDirection = lifecycleDirection(data);
  if (!previousDirection) return false;
  const completedStops = stopsInRideDirection(naturalStops, previousDirection);
  const completedDestination = completedStops.at(-1);
  const previousSessionId = normalizeIdentifier(data.sessionId);
  const busId = normalizeIdentifier(data.busId);
  const routeId = normalizeIdentifier(data.routeId);
  const driverId = normalizeIdentifier(data.driverId);
  const now = Date.now();
  if (
    !completedDestination ||
    !previousSessionId ||
    !busId ||
    !routeId ||
    !driverId ||
    !automaticTurnaroundIsReady({
      now,
      telemetryTimestamp: Number(data.timestamp),
      eligibleAt: Number(data.turnaroundEligibleAt),
      minimumSampleTimestamp: Number(data.turnaroundSampledAt ?? data.turnaroundEligibleAt),
      motionState: data.motionState,
      position: { lat: Number(data.lat), lng: Number(data.lng) },
      destination: completedDestination,
    })
  ) {
    return false;
  }

  const direction = oppositeRideDirection(previousDirection);
  const stops = stopsInRideDirection(naturalStops, direction);
  const origin = stops[0];
  const destination = stops.at(-1)!;
  const sessionRef = db.collection("ride_sessions").doc();
  const claim = await workerRtdbTransaction(nodeRef, (current) => {
    const live = current as Record<string, unknown> | null;
    const claimedAt = Number(live?.turnaroundClaimedAt);
    const claimIsFresh =
      typeof live?.turnaroundClaimId === "string" &&
      Number.isFinite(claimedAt) &&
      now - claimedAt < TURNAROUND_CLAIM_STALE_MS;
    if (
      !live ||
      live.sessionId !== previousSessionId ||
      live.tripState !== "completed" ||
      claimIsFresh ||
      !automaticTurnaroundIsReady({
        now,
        telemetryTimestamp: Number(live.timestamp),
        eligibleAt: Number(live.turnaroundEligibleAt),
        minimumSampleTimestamp: Number(live.turnaroundSampledAt ?? live.turnaroundEligibleAt),
        motionState: live.motionState,
        position: { lat: Number(live.lat), lng: Number(live.lng) },
        destination: completedDestination,
        })
    ) {
      return;
    }
    return {
      ...live,
      turnaroundClaimId: sessionRef.id,
      turnaroundClaimedAt: now,
    };
  });
  if (!claim.committed) return false;

  const lockRef = db.collection("_active_bus_locks").doc(busId);
  const completedSessionRef = db.collection("ride_sessions").doc(previousSessionId);
  const activeRideRef = db.collection("active_rides").doc(`${busId}_${routeId}`);
  const driverRef = db.collection("drivers").doc(driverId);
  const busRef = db.collection("buses").doc(busId);
  let durableCreated = false;
  try {
    durableCreated = await workerTransaction(db, async (transaction) => {
      const [lock, completedSession, driver, bus] = await Promise.all([
        transaction.get(lockRef),
        transaction.get(completedSessionRef),
        transaction.get(driverRef),
        transaction.get(busRef),
      ]);
      const completed = completedSession.data();
      const assignedRoutes = Array.isArray(bus.data()?.assignedRoutes)
        ? bus.data()?.assignedRoutes
        : typeof bus.data()?.assignedRouteId === "string"
          ? [bus.data()?.assignedRouteId]
          : [];
      if (
        lock.exists ||
        !completedSession.exists ||
        completed?.status !== "completed" ||
        completed?.busId !== busId ||
        completed?.routeId !== routeId ||
        completed?.driverId !== driverId ||
        !driver.exists ||
        driver.data()?.assignedBusId !== busId ||
        !bus.exists ||
        !assignedRoutes.includes(routeId)
      ) {
        return false;
      }
      transaction.create(sessionRef, {
        id: sessionRef.id,
        busId,
        driverId,
        routeId,
        direction,
        originStopId: origin.id,
        destinationStopId: destination.id,
        armedAt: now,
        status: "armed",
        directionState: "resolved",
        directionEndpointVersion: endpointSnapshotVersion(naturalStops),
        directionFirestoreSynced: true,
        automaticTurnaround: true,
        previousSessionId,
        passengers: {},
        stopsReached: {},
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(lockRef, {
        busId,
        routeId,
        driverId,
        sessionId: sessionRef.id,
        direction,
        directionState: "resolved",
        directionEndpointVersion: endpointSnapshotVersion(naturalStops),
        directionFirestoreSynced: true,
        automaticTurnaround: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(activeRideRef, {
        sessionId: sessionRef.id,
        busId,
        driverId,
        routeId,
        direction,
        originStopId: origin.id,
        destinationStopId: destination.id,
        status: "active",
        tripState: "pre_departure",
        currentStopIndex: 0,
        hasDepartedOrigin: false,
        delayMinutes: 0,
        delayUpdatedAt: 0,
        directionState: "resolved",
        directionEndpointVersion: endpointSnapshotVersion(naturalStops),
        directionFirestoreSynced: true,
        automaticTurnaround: true,
        previousSessionId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!durableCreated) return false;

    const activated = await workerRtdbTransaction(nodeRef, (current) => {
      const live = current as Record<string, unknown> | null;
      if (
        !live ||
        live.sessionId !== previousSessionId ||
        live.tripState !== "completed" ||
        live.turnaroundClaimId !== sessionRef.id
      ) {
        return;
      }
      return {
        ...withoutLiveRouteContext(live),
        sessionId: sessionRef.id,
        driverId,
        direction,
        originStopId: origin.id,
        destinationStopId: destination.id,
        status: "active",
        deviceState: "online",
        tripState: "pre_departure",
        currentStopIndex: 0,
        hasDepartedOrigin: false,
        delayMinutes: 0,
        delayUpdatedAt: 0,
        directionState: "resolved",
        directionEndpointVersion: endpointSnapshotVersion(naturalStops),
        directionFirestoreSynced: true,
        automaticTurnaround: true,
        previousSessionId,
        completedAt: null,
        turnaroundEligibleAt: null,
        turnaroundSampledAt: null,
        turnaroundClaimId: null,
        turnaroundClaimedAt: null,
        lifecycleUpdatedAt: { ".sv": "timestamp" },
      };
    });
    if (activated.committed) {
      activeRideWrites.invalidate(`${busId}_${routeId}`);
    }
    return activated.committed;
  } finally {
    if (!durableCreated) {
      await workerRtdbTransaction(nodeRef, (current) => {
        const live = current as Record<string, unknown> | null;
        if (!live || live.turnaroundClaimId !== sessionRef.id) return;
        return {
          ...live,
          turnaroundClaimId: null,
          turnaroundClaimedAt: null,
        };
      });
    }
  }
}

/** Tracks non-blocking lifecycle work so shutdown can still flush it. */
function trackBackgroundTask(
  task: Promise<unknown>,
  failureMessage: string,
): Promise<void> {
  const tracked = task
    .then(() => undefined)
    .catch((error) => {
      // Surface through the failure tracker too (issue #38): sustained
      // failures escalate to an error-level alert and show up on /health.
      recordBackgroundFailure(
        "tripState.backgroundTask",
        "Trip-state background task",
        failureMessage,
        error,
      );
    })
    .finally(() => {
      backgroundTasks.delete(tracked);
    });
  backgroundTasks.add(tracked);
  return tracked;
}

/**
 * Firestore is the durable fleet-state store, not a second telemetry stream.
 * Persist only lifecycle changes; coordinates, speed and heartbeat data remain
 * in RTDB, which prevents a Firestore write for every GNSS update.
 */
function persistFleetState(
  data: Record<string, unknown>,
  lastSeen: string,
): void {
  const busId = normalizeIdentifier(data.busId);
  if (!busId) return;

  const state = fleetLifecycleState(data);
  const sessionId = normalizeIdentifier(data.sessionId);
  if (!sessionId) return;
  const fingerprint = lifecycleFingerprint(state);

  // RTDB child events can arrive faster than Firestore commits. Serialize
  // lifecycle writes per bus so an older transition cannot finish after a
  // newer one and overwrite the durable fleet state.
  void fleetWrites.enqueue(busId, fingerprint, async () => {
    const lockRef = db.collection("_active_bus_locks").doc(busId);
    const locationRef = db.collection("bus_locations").doc(busId);
    try {
      const persisted = await workerTransaction(db, async (transaction) => {
        const lock = await transaction.get(lockRef);
        if (!lock.exists || normalizeIdentifier(lock.data()?.sessionId) !== sessionId) {
          return false;
        }
        transaction.set(locationRef, { ...state, lastSeen }, { merge: true });
        return true;
      });
      // The lock check failed, so this state was not persisted. Allow a later
      // identical event to retry instead of suppressing it as a no-change.
      if (!persisted) fleetWrites.retry(busId, fingerprint);
    } catch (error) {
      // Do not discard a newer fingerprint when an earlier queued write fails.
      fleetWrites.retry(busId, fingerprint);
      console.warn("[TripState] Failed to persist fleet lifecycle state:", error);
      requestLifecycleReplay?.();
    }
  }).catch(error => {
    requestLifecycleReplay?.();
    recordBackgroundFailure("worker.lifecycleAdmission", "Lifecycle admission", "[TripState] Fleet write not admitted:", error);
  });
}

/**
 * Persists an offline fleet projection only when no newer session owns the
 * bus. Reading the active lock in the same Firestore transaction prevents a
 * completed node on one route from racing a fresh shift on another route.
 */
async function persistOfflineFleetState(
  data: Record<string, unknown>,
  lastSeen: string,
  confirmMissing?: () => Promise<boolean>,
): Promise<boolean> {
  const busId = normalizeIdentifier(data.busId);
  if (!busId) return false;
  const expectedSessionId = normalizeIdentifier(data.sessionId);
  const state = fleetLifecycleState({
    ...data,
    status: "offline",
    deviceState: "offline",
  });
  const fingerprint = lifecycleFingerprint(state);
  const lockRef = db.collection("_active_bus_locks").doc(busId);
  const locationRef = db.collection("bus_locations").doc(busId);
  try {
    const persisted = await fleetWrites.enqueue(busId, fingerprint, async () => {
      if (confirmMissing && !(await confirmMissing())) return false;
      return workerTransaction(db, async (transaction) => {
        const lock = await transaction.get(lockRef);
        const lockSessionId = normalizeIdentifier(lock.data()?.sessionId);
        if (
          lock.exists &&
          (!expectedSessionId || lockSessionId !== expectedSessionId)
        ) {
          return false;
        }
        transaction.set(locationRef, { ...state, lastSeen }, { merge: true });
        return true;
      });
    });
    // The lock check failed, so this state was not persisted. Allow a later
    // identical event to retry instead of suppressing it as a no-change.
    if (!persisted) fleetWrites.retry(busId, fingerprint);
    return persisted;
  } catch (error) {
    fleetWrites.retry(busId, fingerprint);
    requestLifecycleReplay?.();
    throw error;
  }
}

/** Loads one route with request coalescing and a short cache for missing IDs. */
async function ensureRouteLoaded(routeId: string): Promise<RouteStop[]> {
  const cached = routeStopsCache.get(routeId);
  if (cached) return cached;
  const suppressUntil = missingRouteUntil.get(routeId);
  if (suppressUntil && Date.now() < suppressUntil) return [];
  if (suppressUntil) missingRouteUntil.delete(routeId);
  const pending = routeLoadPromises.get(routeId);
  if (pending) return pending;

  const load = (async () => {
    try {
      const routeDoc = await db.collection("routes").doc(routeId).get();
      if (!routeDoc.exists) {
        missingRouteUntil.set(routeId, Date.now() + MISSING_ROUTE_TTL_MS);
        cacheRoute(routeId, undefined);
        return [];
      }
      const routeData = routeDoc.data();
      missingRouteUntil.delete(routeId);
      cacheRoute(routeId, routeData);
      return routeStopsCache.get(routeId) ?? [];
    } catch (err) {
      console.error(`[TripState] Failed to load route ${routeId}:`, err);
      return [];
    } finally {
      routeLoadPromises.delete(routeId);
    }
  })();
  routeLoadPromises.set(routeId, load);
  return load;
}

/** Replaces the validated stop cache for one route, or evicts a deleted route. */
function cacheRoute(routeId: string, routeData: Record<string, any> | undefined): void {
  if (!routeData) {
    routeStopsCache.delete(routeId);
    return;
  }
  const stops = Array.isArray(routeData.stops)
    ? routeData.stops.filter(
        (stop: any) =>
          Number.isFinite(stop?.lat) &&
          stop.lat >= -90 &&
          stop.lat <= 90 &&
          Number.isFinite(stop?.lng) &&
          stop.lng >= -180 &&
          stop.lng <= 180,
      ).map((stop: any) => ({
        id: typeof stop.id === "string" ? stop.id : "",
        lat: stop.lat,
        lng: stop.lng,
        name: typeof stop.name === "string" ? stop.name : "",
      }))
    : [];
  routeStopsCache.set(routeId, stops);
}

/** Builds the durable active-ride document ID from normalized identifiers. */
function activeRideDocumentId(
  data: Record<string, unknown>,
): string | null {
  const busId = normalizeIdentifier(data.busId);
  const routeId = normalizeIdentifier(data.routeId);
  return busId && routeId
    ? `${busId}_${routeId}`
    : null;
}

/** Serializes the durable active-ride lifecycle write for one ride. */
function persistActiveRideLifecycle(
  data: Record<string, unknown>,
  tripState: "pre_departure" | "in_service",
  currentStopIndex: number,
  hasDepartedOrigin: boolean,
  stops: RouteStop[],
): Promise<RideCheckpoint | undefined> {
  const documentId = activeRideDocumentId(data);
  const busId = normalizeIdentifier(data.busId);
  const sessionId = normalizeIdentifier(data.sessionId);
  const direction = lifecycleDirection(data);
  if (
    !documentId ||
    !busId ||
    !sessionId ||
    data.status !== "active" ||
    typeof data.driverId !== "string" ||
    !direction
  ) {
    return Promise.resolve(undefined);
  }
  const delayUpdatedAt = delayRevision(data.delayUpdatedAt);
  const delayMinutes = normalizedDelayMinutes(data.delayMinutes);
  const state = {
    sessionId,
    busId: data.busId,
    driverId: data.driverId,
    routeId: data.routeId,
    direction,
    originStopId: normalizeIdentifier(data.originStopId),
    destinationStopId: normalizeIdentifier(data.destinationStopId),
    status: "active",
    tripState,
    currentStopIndex,
    hasDepartedOrigin,
    delayMinutes,
    delayUpdatedAt,
  };
  const fingerprint = JSON.stringify(state);

  return activeRideWrites.enqueue(documentId, fingerprint, async () => {
    const activeRideRef = db.collection("active_rides").doc(documentId);
    const lockRef = db.collection("_active_bus_locks").doc(busId);
    const sessionRef = db.collection("ride_sessions").doc(sessionId);
    try {
      const persisted = await workerTransaction(db, async (transaction) => {
        const [activeRide, lock, session] = await Promise.all([
          transaction.get(activeRideRef),
          transaction.get(lockRef),
          transaction.get(sessionRef),
        ]);
        if (
          !lock.exists ||
          normalizeIdentifier(lock.data()?.sessionId) !== sessionId
        ) {
          return false;
        }
        const durableRevision = delayRevision(activeRide.data()?.delayUpdatedAt);
        const durable = activeRide.data();
        const sameSession = durable?.sessionId === sessionId;
        const durableIndex = sameSession && Number.isSafeInteger(durable?.currentStopIndex) &&
          durable.currentStopIndex >= 0 && durable.currentStopIndex < stops.length
          ? Number(durable.currentStopIndex) : 0;
        const checkpoint: RideCheckpoint = {
          tripState: sameSession && durable?.tripState === "in_service" ? "in_service" : tripState,
          currentStopIndex: Math.max(currentStopIndex, durableIndex),
          hasDepartedOrigin: hasDepartedOrigin || (sameSession && durable?.hasDepartedOrigin === true),
        };
        const sessionData = session.data();
        if (session.exists && ["pending", "armed", "active"].includes(sessionData?.status)) {
          const stopsReached = missingStopHistory(
            stops, checkpoint.tripState, checkpoint.currentStopIndex, sessionData?.stopsReached,
            FieldValue.serverTimestamp(), Number(data.currentStopIndex),
          );
          const activating = checkpoint.tripState === "in_service" && sessionData?.status !== "active";
          if (activating || Object.keys(stopsReached).length > 0) {
            transaction.set(sessionRef, {
              ...(activating ? {
                status: "active",
                startTime: sessionData?.startTime ?? Date.now(),
                activatedAt: FieldValue.serverTimestamp(),
              } : {}),
              ...(Object.keys(stopsReached).length > 0 ? { stopsReached } : {}),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        }
        transaction.set(activeRideRef, {
          ...state,
          ...checkpoint,
          ...(durableRevision > delayUpdatedAt
            ? {
                delayMinutes: normalizedDelayMinutes(activeRide.data()?.delayMinutes),
                delayUpdatedAt: durableRevision,
              }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return checkpoint;
      });
      // The lock check failed, so this state was not persisted. Allow a later
      // identical event to retry instead of suppressing it as a no-change.
      if (!persisted) activeRideWrites.retry(documentId, fingerprint);
      else if (
        persisted.tripState !== tripState || persisted.currentStopIndex !== currentStopIndex ||
        persisted.hasDepartedOrigin !== hasDepartedOrigin
      ) activeRideWrites.retry(documentId, fingerprint);
      return persisted || undefined;
    } catch (error) {
      activeRideWrites.retry(documentId, fingerprint);
      console.warn(
        `[TripState] Failed to persist active ride ${documentId}:`,
        error,
      );
      // Surface to the telemetry handler, which logs its own context.
      throw error;
    }
  });
}

/** Starts the leader-owned trip engine and returns its idempotent async stop hook. */
export function startTripStateEngine(): () => Promise<void> {
  console.log("🚀 Trip State Engine started, listening to RTDB /activeBuses");
  const busesRef = rtdb.ref("activeBuses");
  let stopping = false;
  let stopPromise: Promise<void> | null = null;
  type ReplayItem = { kind: "live"; snapshot: DataSnapshot } | { kind: "fleet"; document: QueryDocumentSnapshot };
  const replay = createPagedLifecycleReplay<ReplayItem>({
    hasCapacity: () => {
      const intake = telemetryWrites.snapshot(); const durable = durableExecution.snapshot();
      return !stopping && intake.pending + 25 <= intake.maxPending && durable.pending + 25 <= durable.maxPending;
    },
    async readPage(cursor, limit) {
      assertWorkerLeadership();
      if (!cursor?.startsWith("fleet:")) {
        let query = busesRef.orderByKey();
        if (cursor) query = query.startAfter(cursor.slice("live:".length));
        const snapshot = await query.limitToFirst(limit).once("value");
        const items: ReplayItem[] = [];
        snapshot.forEach(child => { items.push({ kind: "live", snapshot: child }); });
        return { items, nextCursor: items.length === limit ? `live:${(items.at(-1)! as { snapshot: DataSnapshot }).snapshot.key}` : "fleet:" };
      }
      let query = db.collection("bus_locations").orderBy(FieldPath.documentId()).limit(limit);
      if (cursor !== "fleet:") query = query.startAfter(cursor.slice("fleet:".length));
      const page = await query.get();
      return { items: page.docs.map(document => ({ kind: "fleet" as const, document })),
        nextCursor: page.size === limit ? `fleet:${page.docs.at(-1)!.id}` : null };
    },
    async admit(item) {
      assertWorkerLeadership();
      if (stopping) return false;
      if (item.kind === "live") return enqueueLiveSnapshot(item.snapshot, true);
      const data = item.document.data();
      const busId = item.document.id; const routeId = normalizeIdentifier(data.routeId);
      if (!routeId || data.status === "offline") return true;
      // A dropped child_removed event is discoverable from durable fleet state.
      // Read current presence and ownership; never borrow a newer route's lock.
      const live = await rtdb.ref(`activeBuses/${busId}_${routeId}`).once("value");
      if (live.exists()) return true;
      const canonical = await workerTransaction(db, async transaction => {
        const [lock, ride] = await Promise.all([
          transaction.get(db.collection("_active_bus_locks").doc(busId)),
          transaction.get(db.collection("active_rides").doc(`${busId}_${routeId}`)),
        ]);
        return { owner: lock.data(), ride: ride.data() };
      });
      const { owner, ride } = canonical;
      if (owner && (owner.routeId !== routeId || owner.driverId !== data.driverId)) return true;
      if (owner && (!ride || ride.sessionId !== owner.sessionId || ride.routeId !== routeId || ride.driverId !== owner.driverId)) return true;
      await persistOfflineFleetState({ ...data, ...(owner ? ride : {}), busId,
        sessionId: owner?.sessionId ?? data.sessionId ?? null }, new Date().toISOString(),
        async () => !(await rtdb.ref(`activeBuses/${busId}_${routeId}`).once("value")).exists());
      return true;
    },
    onError: error => recordBackgroundFailure("worker.lifecycleReplay", "Lifecycle replay", "[TripState] Lifecycle recovery page failed:", error),
  });
  const requestReplay = () => replay.request();
  requestLifecycleReplay = requestReplay;
  replayStatus = replay.snapshot;
  const replayTimer = setInterval(() => { void replay.tick(); }, 1_000);
  replayTimer.unref();
  // Cold start must also discover missed removals in durable fleet state.
  replay.request();
  let routeCacheUnsubscribe: (() => void) | null = null;
  let routeReconnectTimer: NodeJS.Timeout | null = null;
  let routeReconnectDelayMs = ROUTE_RECONNECT_INITIAL_MS;

  /** Attaches the route watcher and schedules bounded-backoff recovery on failure. */
  const attachRouteCacheWatcher = () => {
    if (stopping) return;
    routeCacheUnsubscribe = db.collection("routes").onSnapshot(
      (snapshot) => {
        routeReconnectDelayMs = ROUTE_RECONNECT_INITIAL_MS;
        snapshot.docChanges().forEach((change) => {
          const routeId = change.doc.id;
          if (change.type === "removed") {
            missingRouteUntil.set(routeId, Date.now() + MISSING_ROUTE_TTL_MS);
            cacheRoute(routeId, undefined);
            return;
          }
          missingRouteUntil.delete(routeId);
          cacheRoute(routeId, change.doc.data());
        });
      },
      (error) => {
        routeCacheUnsubscribe = null;
        console.error("[TripState] Route cache watcher failed:", error);
        if (stopping || routeReconnectTimer) return;
        const retryInMs = routeReconnectDelayMs;
        routeReconnectDelayMs = Math.min(
          routeReconnectDelayMs * 2,
          ROUTE_RECONNECT_MAX_MS,
        );
        routeReconnectTimer = setTimeout(() => {
          routeReconnectTimer = null;
          attachRouteCacheWatcher();
        }, retryInMs);
        routeReconnectTimer.unref();
      },
    );
  };
  attachRouteCacheWatcher();

  /** Applies one ordered RTDB telemetry snapshot to lifecycle state. */
  const processLiveSnapshot = async (
    snapshot: import("firebase-admin/database").DataSnapshot,
  ) => {
    const data = normalizeLiveBusData(snapshot.val(), snapshot.key);
    if (!data) return;
    const nodeKey = snapshot.key || `${data.busId}_${data.routeId}`;

    // Ordinary offline nodes have no ride lifecycle to advance. Completed
    // nodes remain eligible for a guarded automatic turnaround below.
    if (data.status === "offline" && data.tripState !== "completed") {
      if (completedTimeouts.has(nodeKey)) {
        clearTimeout(completedTimeouts.get(nodeKey)!.timeoutId);
        completedTimeouts.delete(nodeKey);
      }
      await persistOfflineFleetState(data, new Date().toISOString());
      return;
    }
    const naturalStops = await ensureRouteLoaded(data.routeId);
    if (data.tripState === "completed") {
      try {
        if (await restoreDurableRide({ busId: data.busId, routeId: data.routeId }, undefined,
          typeof data.turnaroundClaimId === "string" ? data.turnaroundClaimId : null)) return;
        const armed =
          Number.isFinite(data.lat) && Number.isFinite(data.lng)
            ? await maybeArmAutomaticTurnaround(
                data,
                naturalStops,
                snapshot.ref,
              )
            : false;
        if (!armed) {
          await persistOfflineFleetState(data, new Date().toISOString());
        }
      } catch (error) {
        console.warn(
          `[TripState] Failed to arm automatic turnaround for ${nodeKey}:`,
          error,
        );
      }
      return;
    }
    if (!Number.isFinite(data.lat) || !Number.isFinite(data.lng)) return;
    const direction = lifecycleDirection(data);
    // Pending direction is operational state, not an implicit forward ride.
    // Keep fleet visibility, but wait for telemetryRouteService to claim a
    // direction before deriving stops, completion, or an active-ride mirror.
    if (!direction) {
      persistFleetState(data, new Date().toISOString());
      return;
    }
    const stops = stopsInRideDirection(naturalStops, direction);

    const telemetryTimestamp = Number(data.timestamp);
    const previousTelemetry = processedTelemetry.get(nodeKey);
    const isNewTelemetry =
      Number.isFinite(telemetryTimestamp) &&
      (!previousTelemetry || telemetryTimestamp > previousTelemetry.timestamp);
    let { tripState, currentStopIndex, hasDepartedOrigin } = isNewTelemetry
      ? reduceTripState({
      lat: data.lat,
      lng: data.lng,
      previousPosition: previousTelemetry
        ? { lat: previousTelemetry.lat, lng: previousTelemetry.lng }
        : undefined,
      motionState: data.motionState || "moving",
      currentTripState: data.tripState || "pre_departure",
      currentStopIndex: Number.isInteger(data.currentStopIndex) ? data.currentStopIndex : 0,
      stops,
      hasDepartedOrigin: data.hasDepartedOrigin === true,
      })
      : {
          tripState: data.tripState,
          currentStopIndex: data.currentStopIndex,
          hasDepartedOrigin: data.hasDepartedOrigin === true,
        };

    if (tripState === "pre_departure" || tripState === "in_service") {
      // Commit lifecycle and all crossed-stop history together before exposing
      // the next index. A failed write leaves the same sample retryable.
      const checkpoint = await persistActiveRideLifecycle(data, tripState, currentStopIndex, hasDepartedOrigin, stops);
      if (checkpoint) ({ tripState, currentStopIndex, hasDepartedOrigin } = checkpoint);
    }
    const liveStateChanged = tripState !== data.tripState || currentStopIndex !== data.currentStopIndex ||
      hasDepartedOrigin !== (data.hasDepartedOrigin === true);
    if (liveStateChanged && tripState !== "completed") {
      try {
        // Guarded write: the plain update() could recreate a node the stale
        // sweep removed (phantom bus with no coords/timestamp) or clobber a
        // newer session that reused this key (issue #66). The transaction
        // aborts when the node is gone, belongs to another session, or has
        // reached a terminal/offline state.
        await workerRtdbTransaction(snapshot.ref, (current) => {
          const live = current as Record<string, unknown> | null;
          if (!live) return;
          if (
            typeof data.sessionId === "string" &&
            live.sessionId !== data.sessionId
          ) {
            return;
          }
          if (lifecycleDirection(live) !== direction) return;
          if (
            live.tripState === "completed" ||
            live.deviceState === "offline"
          ) {
            return;
          }
          return {
            ...live,
            tripState,
            currentStopIndex,
            hasDepartedOrigin,
          };
        });
      } catch (error) {
        console.error(
          `[TripState] Failed to update live state for ${nodeKey}:`,
          error,
        );
        return;
      }
    }

    if (data.tripState !== "completed" && completedTimeouts.has(nodeKey)) {
      clearTimeout(completedTimeouts.get(nodeKey)!.timeoutId);
      completedTimeouts.delete(nodeKey);
    }

    if (tripState === "completed" && data.tripState !== "completed") {
      let completionTimeMs = Date.now();
      let completionTimestamp = new Date(completionTimeMs).toISOString();
      let turnaroundEligibleAt = completionTimeMs + AUTOMATIC_TURNAROUND_DWELL_MS;
      const completionId =
        typeof data.sessionId === "string" && data.sessionId
          ? data.sessionId
          : nodeKey;
      const activeRideId = activeRideDocumentId(data);
      const completedRef = db.collection("completed_trips").doc(completionId);
      try {
        const persistedCompletion = await workerTransaction(db, async (transaction) => {
          const activeRideRef = activeRideId
            ? db.collection("active_rides").doc(activeRideId)
            : null;
          const lockRef = db.collection("_active_bus_locks").doc(data.busId);
          const sessionRef = typeof data.sessionId === "string"
            ? db.collection("ride_sessions").doc(data.sessionId)
            : null;
          const [activeRide, lock, session, existingCompletion] = await Promise.all([
            activeRideRef ? transaction.get(activeRideRef) : Promise.resolve(null),
            transaction.get(lockRef),
            sessionRef ? transaction.get(sessionRef) : Promise.resolve(null),
            transaction.get(completedRef),
          ]);
          if (sessionRef) {
            const sessionStatus = session?.data()?.status;
            if (sessionStatus === "completed") {
              // Firestore completion and RTDB publication are separate commits.
              // Recover the original terminal projection after a lost RTDB
              // response or process crash, without moving its retention date or
              // touching a replacement ride's lock.
              const completed = existingCompletion.data();
              const completedAtMs = Date.parse(completed?.completedAt);
              if (
                !existingCompletion.exists ||
                completed?.sessionId !== data.sessionId ||
                completed?.busId !== data.busId ||
                completed?.routeId !== data.routeId ||
                completed?.direction !== direction ||
                !Number.isFinite(completedAtMs) ||
                (lock.exists && lock.data()?.sessionId !== data.sessionId) ||
                (activeRide?.exists && activeRide.data()?.sessionId !== data.sessionId)
              ) return null;
              return {
                completedAtMs,
                eligibleAt: Number.isFinite(completed?.automaticTurnaroundEligibleAt)
                  ? Number(completed?.automaticTurnaroundEligibleAt)
                  : completedAtMs + AUTOMATIC_TURNAROUND_DWELL_MS,
              };
            }
            if (
              !session?.exists ||
              lock.data()?.sessionId !== data.sessionId ||
              (sessionStatus !== "pending" &&
                sessionStatus !== "armed" &&
                sessionStatus !== "active")
            ) {
              return null;
            }
          }
          transaction.set(completedRef, {
            busId: data.busId,
            driverId: data.driverId || "unknown",
            routeId: data.routeId,
            direction,
            originStopId: normalizeIdentifier(data.originStopId) ?? stops[0]?.id ?? null,
            destinationStopId:
              normalizeIdentifier(data.destinationStopId) ?? stops.at(-1)?.id ?? null,
            completedAt: completionTimestamp,
            automaticTurnaroundEligibleAt:
              completionTimeMs + AUTOMATIC_TURNAROUND_DWELL_MS,
            stopCount: stops.length,
            stopNames: stops.map(s => s.name),
            sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
          }, { merge: true });
          if (typeof data.sessionId === "string") {
            const stopsReached = missingStopHistory(
              stops, tripState, currentStopIndex, session?.data()?.stopsReached,
              FieldValue.serverTimestamp(), Number(data.currentStopIndex),
            );
            transaction.set(sessionRef!, {
              status: "completed",
              endTime: Date.now(),
              ...(Object.keys(stopsReached).length > 0 ? { stopsReached } : {}),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
          if (activeRideRef && activeRide?.data()?.sessionId === data.sessionId) {
            transaction.delete(activeRideRef);
          }
          if (
            typeof data.sessionId === "string" &&
            data.sessionId.length > 0 &&
            lock.data()?.sessionId === data.sessionId
          ) {
            transaction.delete(lockRef);
          }
          return { completedAtMs: completionTimeMs, eligibleAt: turnaroundEligibleAt };
        });
        // A concurrent manual termination or replacement session won. Do not
        // overwrite its interrupted history or publish a stale completion.
        if (!persistedCompletion) return;
        completionTimeMs = persistedCompletion.completedAtMs;
        completionTimestamp = new Date(completionTimeMs).toISOString();
        turnaroundEligibleAt = persistedCompletion.eligibleAt;
        if (activeRideId) {
          activeRideWrites.invalidate(activeRideId);
        }
        await workerRtdbTransaction(snapshot.ref, (current) => {
          const live = current as Record<string, unknown> | null;
          if (!live || live.sessionId !== data.sessionId) return;
          return {
            ...live,
            tripState,
            currentStopIndex,
            hasDepartedOrigin,
            completedAt: completionTimeMs,
            turnaroundEligibleAt,
            turnaroundSampledAt: AUTOMATIC_TURNAROUND_DWELL_MS === 0
              ? Number(data.timestamp)
              : turnaroundEligibleAt,
            turnaroundClaimId: null,
            turnaroundClaimedAt: null,
          };
        });
      } catch (error) {
        console.warn(
          `[TripState] Failed to persist completion ${completionId}:`,
          error,
        );
        return;
      }

      let cleanupPromise: Promise<void> | null = null;
      /** Retires this completed session once and persists its final fleet state. */
      const runCleanup = bindWorkerContext((): Promise<void> => {
        if (cleanupPromise) return cleanupPromise;
        if (completedTimeouts.get(nodeKey)?.run === runCleanup) {
          completedTimeouts.delete(nodeKey);
        }
        cleanupPromise = trackBackgroundTask((async () => {
          // Do not recreate a node removed by the stale sweep, and do not mark a
          // newer shift offline if the same bus/route key was reused meanwhile.
          const retirement = await workerRtdbTransaction(snapshot.ref, (current) => {
            const live = current as Record<string, unknown> | null;
            if (
              !live ||
              live.tripState !== "completed" ||
              live.sessionId !== data.sessionId
            ) {
              return;
            }
            return {
              ...live,
              status: "offline",
              deviceState: "offline",
              lifecycleUpdatedAt: { ".sv": "timestamp" },
            };
          });
          // In normal operation the committed RTDB child_changed event writes
          // the fleet projection in order. During shutdown listeners are
          // detached, so persist the guarded terminal projection explicitly.
          if (stopping && retirement.committed) {
            await persistOfflineFleetState(
              { ...data, status: "offline", tripState: "completed" },
              completionTimestamp,
            );
          }
        })(), `[TripState] Failed to retire completed session ${data.sessionId}:`);
        return cleanupPromise;
      });
      if (stopping) {
        void runCleanup();
      } else {
        const timeoutId = setTimeout(() => void runCleanup(), 30_000);
        const previousCompletion = completedTimeouts.get(nodeKey);
        if (previousCompletion) clearTimeout(previousCompletion.timeoutId);
        completedTimeouts.set(nodeKey, { timeoutId, run: runCleanup });
      }
    }

    if (isNewTelemetry) {
      processedTelemetry.set(nodeKey, { timestamp: telemetryTimestamp, lat: data.lat, lng: data.lng });
    }
    persistFleetState({ ...data, tripState }, new Date().toISOString());
  };

  /** Queues live snapshots per RTDB node to preserve telemetry ordering. */
  const enqueueLiveSnapshot = (
    snapshot: import("firebase-admin/database").DataSnapshot,
    replayed = false,
  ): boolean => {
    if (stopping) return false;
    assertWorkerLeadership();
    const nodeKey = snapshot.key;
    if (!nodeKey) return false;
    const admitted = telemetryWrites.canEnqueue(nodeKey);
    void telemetryWrites.enqueue(nodeKey, null, async () => {
      try {
        // A replay page may wait behind newer live events. Resolve its authority
        // only after reaching this node's serialized queue.
        const current = replayed ? await rtdb.ref(`activeBuses/${nodeKey}`).once("value") : snapshot;
        if (!replayed || current.exists()) await processLiveSnapshot(current);
      } catch (error) {
        console.error(`[TripState] Failed to process telemetry for ${nodeKey}:`, error);
        replay.request();
      }
    }).catch(error => {
      replay.request();
      recordBackgroundFailure("worker.lifecycleAdmission", "Lifecycle admission", "[TripState] Live event not admitted:", error);
    });
    return admitted;
  };
  const liveSnapshotHandler = bindWorkerCallback((snapshot: import("firebase-admin/database").DataSnapshot) => {
    enqueueLiveSnapshot(snapshot);
  });

  /** Persists the terminal offline state for a removed live-presence node. */
  const childRemovedHandler = bindWorkerCallback((snapshot: import("firebase-admin/database").DataSnapshot) => {
    if (stopping) return;
    const data = normalizeLiveBusData(snapshot.val(), snapshot.key);
    if (!data) return;

    const nodeKey = snapshot.key || `${data.busId}_${data.routeId || ""}`;
    // RTDB is the live-presence source. Preserve the final offline lifecycle
    // state only if a newer session has not claimed this bus.
    trackBackgroundTask(
      persistOfflineFleetState(data, new Date().toISOString()),
      `[TripState] Failed to persist removed node ${nodeKey}:`,
    );
    processedTelemetry.delete(nodeKey);
    const activeRideId = activeRideDocumentId(data);
    if (activeRideId) {
      // The next event for this ride may belong to a fresh session with
      // identical lifecycle fields, so drop the dedup fingerprint.
      activeRideWrites.forgetFingerprint(activeRideId);
    }
    if (completedTimeouts.has(nodeKey)) {
      clearTimeout(completedTimeouts.get(nodeKey)!.timeoutId);
      completedTimeouts.delete(nodeKey);
    }
  });

  busesRef.on("child_added", liveSnapshotHandler);
  busesRef.on("child_changed", liveSnapshotHandler);
  busesRef.on("child_removed", childRemovedHandler);

  // Hardware trackers cannot register an RTDB onDisconnect handler. Sweep only
  // nodes whose server timestamp has exceeded the client freshness horizon.
  let staleSweepInFlight: Promise<void> | null = null;
  const staleSweeper = createStaleBusSweeper(busesRef, STALE_BUS_MS, error =>
    recordBackgroundFailure("worker.staleSweep", "Stale presence scan", "[TripState] Stale bus page failed:", error));
  const sweepStatus = staleSweeper.snapshot;
  staleSweepStatus = sweepStatus;
  const runStaleSweep = () => staleSweeper.tick();
  const staleSweepTimer = setInterval(() => {
    if (stopping || staleSweepInFlight) return;
    const sweep = runStaleSweep().finally(() => {
      if (staleSweepInFlight === sweep) staleSweepInFlight = null;
    });
    staleSweepInFlight = sweep;
  }, 1_000);
  staleSweepTimer.unref();

  return bindWorkerContext(() => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopping = true;
      replay.stop(); clearInterval(replayTimer);
      if (requestLifecycleReplay === requestReplay) { requestLifecycleReplay = null; replayStatus = null; }
      const deadlineMs = Date.now() + ENGINE_SHUTDOWN_TIMEOUT_MS;
      const handlerDeadlineMs = deadlineMs - ENGINE_COMPLETION_FLUSH_MS;

      routeCacheUnsubscribe?.();
      routeCacheUnsubscribe = null;
      if (routeReconnectTimer) {
        clearTimeout(routeReconnectTimer);
        routeReconnectTimer = null;
      }
      busesRef.off("child_added", liveSnapshotHandler);
      busesRef.off("child_changed", liveSnapshotHandler);
      busesRef.off("child_removed", childRemovedHandler);
      clearInterval(staleSweepTimer);
      staleSweeper.stop();
      if (staleSweepStatus === sweepStatus) staleSweepStatus = null;

      const getPendingTasks = () => [
        ...telemetryWrites.pending(),
        ...fleetWrites.pending(),
        ...activeRideWrites.pending(),
        ...backgroundTasks.values(),
        ...(replay.pending() ? [replay.pending()!] : []),
        ...(staleSweepInFlight ? [staleSweepInFlight] : []),
      ];

      // Finish handlers already past RTDB off() before collecting completion
      // timers; those handlers may still enqueue lifecycle writes or cleanup.
      const handlersDrained = await drainDynamicPromises(
        getPendingTasks,
        handlerDeadlineMs,
      );
      if (!handlersDrained) {
        console.warn("[TripState] Timed out draining active handlers during shutdown.");
      }

      let writesDrained = false;
      do {
        const pendingCompletions = Array.from(completedTimeouts.values());
        completedTimeouts.clear();
        for (const completion of pendingCompletions) {
          clearTimeout(completion.timeoutId);
          void completion.run();
        }
        writesDrained = await drainDynamicPromises(getPendingTasks, deadlineMs);
      } while (completedTimeouts.size > 0 && Date.now() < deadlineMs);
      if (completedTimeouts.size > 0) {
        writesDrained = false;
        for (const completion of completedTimeouts.values()) {
          clearTimeout(completion.timeoutId);
          void completion.run();
        }
        completedTimeouts.clear();
      }
      if (!writesDrained) {
        console.warn("[TripState] Timed out flushing lifecycle writes during shutdown.");
      }

      processedTelemetry.clear();
      fleetWrites.clear();
      activeRideWrites.clear();
      telemetryWrites.clear();
      missingRouteUntil.clear();
      routeStopsCache.clear();
      console.log("[TripState] Engine stopped.");
    })();
    return stopPromise;
  });
}
