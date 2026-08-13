import { db, rtdb } from "../lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { LruCache } from "../lib/lruCache";
import { recordBackgroundFailure } from "../lib/backgroundFailureTracker";
import { SerializedChangeWriter } from "./serializedChangeWriter";
import { reduceTripState } from "./tripStateReducer";
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
const fleetWrites = new SerializedChangeWriter(MAX_CACHE_ENTRIES);
const activeRideWrites = new SerializedChangeWriter(MAX_CACHE_ENTRIES);
const telemetryWrites = new SerializedChangeWriter(MAX_CACHE_ENTRIES);
const backgroundTasks = new Set<Promise<void>>();
interface TelemetrySample {
  timestamp: number;
  lat: number;
  lng: number;
}
const processedTelemetry = new LruCache<string, TelemetrySample>(MAX_CACHE_ENTRIES);

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
const MISSING_ROUTE_TTL_MS = 60_000;
const ROUTE_RECONNECT_INITIAL_MS = 1_000;
const ROUTE_RECONNECT_MAX_MS = 30_000;
const ENGINE_SHUTDOWN_TIMEOUT_MS = 8_000;
const ENGINE_COMPLETION_FLUSH_MS = 2_000;

/** Normalizes a raw RTDB fleet event into the durable lifecycle state shape. */
function fleetLifecycleState(data: Record<string, unknown>) {
  return {
    routeId: normalizeIdentifier(data.routeId),
    driverId: typeof data.driverId === "string" ? data.driverId : null,
    status: typeof data.status === "string" ? data.status : "active",
    deviceState: typeof data.deviceState === "string" ? data.deviceState : "online",
    tripState: typeof data.tripState === "string" ? data.tripState : "pre_departure",
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
  data: Record<string, unknown>,
  state: ReturnType<typeof fleetLifecycleState>,
): string {
  return JSON.stringify({
    sessionId: normalizeIdentifier(data.sessionId),
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
  const fingerprint = lifecycleFingerprint(data, state);

  // RTDB child events can arrive faster than Firestore commits. Serialize
  // lifecycle writes per bus so an older transition cannot finish after a
  // newer one and overwrite the durable fleet state.
  void fleetWrites.enqueue(busId, fingerprint, async () => {
    const lockRef = db.collection("_active_bus_locks").doc(busId);
    const locationRef = db.collection("bus_locations").doc(busId);
    try {
      const persisted = await db.runTransaction(async (transaction) => {
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
    }
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
): Promise<boolean> {
  const busId = normalizeIdentifier(data.busId);
  if (!busId) return false;
  const expectedSessionId = normalizeIdentifier(data.sessionId);
  const state = fleetLifecycleState({
    ...data,
    status: "offline",
    deviceState: "offline",
  });
  const fingerprint = lifecycleFingerprint(data, state);
  const lockRef = db.collection("_active_bus_locks").doc(busId);
  const locationRef = db.collection("bus_locations").doc(busId);
  try {
    const persisted = await fleetWrites.enqueue(busId, fingerprint, () =>
      db.runTransaction(async (transaction) => {
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
      }),
    );
    // The lock check failed, so this state was not persisted. Allow a later
    // identical event to retry instead of suppressing it as a no-change.
    if (!persisted) fleetWrites.retry(busId, fingerprint);
    return persisted;
  } catch (error) {
    fleetWrites.retry(busId, fingerprint);
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
): Promise<void> {
  const documentId = activeRideDocumentId(data);
  const busId = normalizeIdentifier(data.busId);
  const sessionId = normalizeIdentifier(data.sessionId);
  if (
    !documentId ||
    !busId ||
    !sessionId ||
    data.status !== "active" ||
    typeof data.driverId !== "string"
  ) {
    return Promise.resolve();
  }
  const delayUpdatedAt = delayRevision(data.delayUpdatedAt);
  const delayMinutes = normalizedDelayMinutes(data.delayMinutes);
  const state = {
    sessionId,
    busId: data.busId,
    driverId: data.driverId,
    routeId: data.routeId,
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
    try {
      const persisted = await db.runTransaction(async (transaction) => {
        const [activeRide, lock] = await Promise.all([
          transaction.get(activeRideRef),
          transaction.get(lockRef),
        ]);
        if (
          !lock.exists ||
          normalizeIdentifier(lock.data()?.sessionId) !== sessionId
        ) {
          return false;
        }
        const durableRevision = delayRevision(activeRide.data()?.delayUpdatedAt);
        transaction.set(activeRideRef, {
          ...state,
          ...(durableRevision > delayUpdatedAt
            ? {
                delayMinutes: normalizedDelayMinutes(activeRide.data()?.delayMinutes),
                delayUpdatedAt: durableRevision,
              }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return true;
      });
      // The lock check failed, so this state was not persisted. Allow a later
      // identical event to retry instead of suppressing it as a no-change.
      if (!persisted) activeRideWrites.retry(documentId, fingerprint);
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

/** Activates an armed ride without delaying the telemetry hot path. */
function activateRideSession(sessionId: string): void {
  const sessionRef = db.collection("ride_sessions").doc(sessionId);
  trackBackgroundTask(db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(sessionRef);
    const session = snapshot.data();
    if (!snapshot.exists || session?.status === "active") return;
    if (session?.status !== "armed" && session?.status !== "pending") return;
    transaction.set(sessionRef, {
      status: "active",
      startTime: Date.now(),
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }), `[TripState] Failed to activate session ${sessionId}:`);
}

/** Starts the leader-owned trip engine and returns its idempotent async stop hook. */
export function startTripStateEngine(): () => Promise<void> {
  console.log("🚀 Trip State Engine started, listening to RTDB /activeBuses");
  const busesRef = rtdb.ref("activeBuses");
  let stopping = false;
  let stopPromise: Promise<void> | null = null;
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

    // If driver marked offline via frontend, handle cleanup
    if (data.status === "offline") {
      if (completedTimeouts.has(nodeKey)) {
        clearTimeout(completedTimeouts.get(nodeKey)!.timeoutId);
        completedTimeouts.delete(nodeKey);
      }
      await persistOfflineFleetState(data, new Date().toISOString());
      return;
    }
    if (!Number.isFinite(data.lat) || !Number.isFinite(data.lng)) return;

    const stops = await ensureRouteLoaded(data.routeId);

    const telemetryTimestamp = Number(data.timestamp);
    const previousTelemetry = processedTelemetry.get(nodeKey);
    const isNewTelemetry =
      Number.isFinite(telemetryTimestamp) &&
      (!previousTelemetry || telemetryTimestamp > previousTelemetry.timestamp);
    if (isNewTelemetry) {
      processedTelemetry.set(nodeKey, {
        timestamp: telemetryTimestamp,
        lat: data.lat,
        lng: data.lng,
      });
    }

    const { tripState, currentStopIndex, hasDepartedOrigin } = isNewTelemetry
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

    const liveStateChanged =
      tripState !== data.tripState ||
      currentStopIndex !== data.currentStopIndex ||
      hasDepartedOrigin !== (data.hasDepartedOrigin === true);
    if (liveStateChanged && tripState !== "completed") {
      try {
        // Guarded write: the plain update() could recreate a node the stale
        // sweep removed (phantom bus with no coords/timestamp) or clobber a
        // newer session that reused this key (issue #66). The transaction
        // aborts when the node is gone, belongs to another session, or has
        // reached a terminal/offline state.
        await snapshot.ref.transaction((current) => {
          const live = current as Record<string, unknown> | null;
          if (!live) return;
          if (
            typeof data.sessionId === "string" &&
            live.sessionId !== data.sessionId
          ) {
            return;
          }
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

    if (
      data.tripState === "pre_departure" &&
      tripState === "in_service" &&
      typeof data.sessionId === "string"
    ) {
      activateRideSession(data.sessionId);
    }

    const reachedStopIndex =
      data.tripState === "pre_departure" && tripState === "in_service"
        ? 0
        : tripState === "completed" && data.tripState !== "completed"
        ? currentStopIndex
        : currentStopIndex !== data.currentStopIndex
          ? Math.max(0, currentStopIndex - 1)
          : null;
    if (
      typeof data.sessionId === "string" &&
      reachedStopIndex !== null &&
      tripState !== "completed" &&
      stops[reachedStopIndex]
    ) {
      const stop = stops[reachedStopIndex];
      trackBackgroundTask(db.collection("ride_sessions").doc(data.sessionId).set({
        stopsReached: {
          [reachedStopIndex]: {
            stopIndex: reachedStopIndex,
            stopId: stop.id,
            stopName: stop.name,
            timestamp: FieldValue.serverTimestamp(),
          },
        },
      }, { merge: true }),
      `[TripState] Failed to record stop ${reachedStopIndex} for session ${data.sessionId}:`);
    }

    if (data.tripState !== "completed" && completedTimeouts.has(nodeKey)) {
      clearTimeout(completedTimeouts.get(nodeKey)!.timeoutId);
      completedTimeouts.delete(nodeKey);
    }

    if (tripState === "completed" && data.tripState !== "completed") {
      const completionTimestamp = new Date().toISOString();
      const completionId =
        typeof data.sessionId === "string" && data.sessionId
          ? data.sessionId
          : nodeKey;
      const activeRideId = activeRideDocumentId(data);
      const completedRef = db.collection("completed_trips").doc(completionId);
      try {
        await db.runTransaction(async (transaction) => {
          const activeRideRef = activeRideId
            ? db.collection("active_rides").doc(activeRideId)
            : null;
          const lockRef = db.collection("_active_bus_locks").doc(data.busId);
          const [activeRide, lock] = await Promise.all([
            activeRideRef ? transaction.get(activeRideRef) : Promise.resolve(null),
            transaction.get(lockRef),
          ]);
          transaction.set(completedRef, {
            busId: data.busId,
            driverId: data.driverId || "unknown",
            routeId: data.routeId,
            completedAt: completionTimestamp,
            stopCount: stops.length,
            stopNames: stops.map(s => s.name),
            sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
          }, { merge: true });
          if (typeof data.sessionId === "string") {
            const finalStop = stops[currentStopIndex];
            transaction.set(db.collection("ride_sessions").doc(data.sessionId), {
              status: "completed",
              endTime: Date.now(),
              ...(finalStop
                ? {
                    stopsReached: {
                      [currentStopIndex]: {
                        stopIndex: currentStopIndex,
                        stopId: finalStop.id,
                        stopName: finalStop.name,
                        timestamp: FieldValue.serverTimestamp(),
                      },
                    },
                  }
                : {}),
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
        });
        if (activeRideId) {
          activeRideWrites.invalidate(activeRideId);
        }
        await snapshot.ref.transaction((current) => {
          const live = current as Record<string, unknown> | null;
          if (!live || live.sessionId !== data.sessionId) return;
          return { ...live, tripState, currentStopIndex, hasDepartedOrigin };
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
      const runCleanup = (): Promise<void> => {
        if (cleanupPromise) return cleanupPromise;
        if (completedTimeouts.get(nodeKey)?.run === runCleanup) {
          completedTimeouts.delete(nodeKey);
        }
        cleanupPromise = trackBackgroundTask((async () => {
          // Do not recreate a node removed by the stale sweep, and do not mark a
          // newer shift offline if the same bus/route key was reused meanwhile.
          const retirement = await snapshot.ref.transaction((current) => {
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
      };
      if (stopping) {
        void runCleanup();
      } else {
        const timeoutId = setTimeout(() => void runCleanup(), 30_000);
        const previousCompletion = completedTimeouts.get(nodeKey);
        if (previousCompletion) clearTimeout(previousCompletion.timeoutId);
        completedTimeouts.set(nodeKey, { timeoutId, run: runCleanup });
      }
    }

    if (tripState === "pre_departure" || tripState === "in_service") {
      await persistActiveRideLifecycle(
        data,
        tripState,
        currentStopIndex,
        hasDepartedOrigin,
      );
    }
    persistFleetState({ ...data, tripState }, new Date().toISOString());
  };

  /** Queues live snapshots per RTDB node to preserve telemetry ordering. */
  const liveSnapshotHandler = (
    snapshot: import("firebase-admin/database").DataSnapshot,
  ) => {
    if (stopping) return;
    const nodeKey = snapshot.key;
    if (!nodeKey) return;
    telemetryWrites.enqueue(nodeKey, null, async () => {
      try {
        await processLiveSnapshot(snapshot);
      } catch (error) {
        console.error(`[TripState] Failed to process telemetry for ${nodeKey}:`, error);
      }
    });
  };

  /** Persists the terminal offline state for a removed live-presence node. */
  const childRemovedHandler = (snapshot: import("firebase-admin/database").DataSnapshot) => {
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
  };

  busesRef.on("child_added", liveSnapshotHandler);
  busesRef.on("child_changed", liveSnapshotHandler);
  busesRef.on("child_removed", childRemovedHandler);

  // Hardware trackers cannot register an RTDB onDisconnect handler. Sweep only
  // nodes whose server timestamp has exceeded the client freshness horizon.
  let staleSweepInFlight: Promise<void> | null = null;
  /** Marks stale active rides offline and removes stale terminal nodes. */
  const runStaleSweep = async () => {
    try {
      const snapshot = await busesRef.once("value");
      if (stopping) return;
      const now = Date.now();
      const removals: Promise<unknown>[] = [];
      snapshot.forEach((child) => {
        const data = child.val() as {
          timestamp?: unknown;
          status?: unknown;
          tripState?: unknown;
          deviceState?: unknown;
        } | null;
        if (typeof data?.timestamp === "number" && now - data.timestamp > STALE_BUS_MS) {
          const rideIsActive =
            data.status === "active" &&
            (data.tripState === "pre_departure" ||
              data.tripState === "in_service");
          if (rideIsActive) {
            if (data.deviceState !== "offline") {
              removals.push(child.ref.update({
                deviceState: "offline",
                signalState: "lost",
                lifecycleUpdatedAt: { ".sv": "timestamp" },
              }));
            }
          } else {
            removals.push(child.ref.remove());
          }
        }
      });
      await Promise.all(removals);
    } catch (error) {
      console.error("[TripState] stale bus sweep failed:", error);
    }
  };
  const staleSweepTimer = setInterval(() => {
    if (stopping || staleSweepInFlight) return;
    const sweep = runStaleSweep().finally(() => {
      if (staleSweepInFlight === sweep) staleSweepInFlight = null;
    });
    staleSweepInFlight = sweep;
  }, STALE_BUS_MS);
  staleSweepTimer.unref();

  return () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopping = true;
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

      const getPendingTasks = () => [
        ...telemetryWrites.pending(),
        ...fleetWrites.pending(),
        ...activeRideWrites.pending(),
        ...backgroundTasks.values(),
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
  };
}
