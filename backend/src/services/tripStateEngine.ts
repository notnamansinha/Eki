import { db, rtdb } from "../lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
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
const routeStopsCache = new Map<string, RouteStop[]>();
const routeLoadPromises = new Map<string, Promise<RouteStop[]>>();
const missingRouteUntil = new Map<string, number>();
const completedTimeouts = new Map<string, PendingCompletion>();
const persistedFleetState = new Map<string, string>();
const fleetWriteQueues = new Map<string, Promise<void>>();
const persistedActiveRideState = new Map<string, string>();
const activeRideWriteQueues = new Map<string, Promise<void>>();
const telemetryQueues = new Map<string, Promise<void>>();
const backgroundTasks = new Set<Promise<void>>();
interface TelemetrySample {
  timestamp: number;
  lat: number;
  lng: number;
}
const processedTelemetry = new Map<string, TelemetrySample>();

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

function fleetLifecycleState(data: Record<string, unknown>) {
  return {
    routeId: normalizeIdentifier(data.routeId),
    driverId: typeof data.driverId === "string" ? data.driverId : null,
    status: typeof data.status === "string" ? data.status : "active",
    deviceState: typeof data.deviceState === "string" ? data.deviceState : "online",
    tripState: typeof data.tripState === "string" ? data.tripState : "pre_departure",
  };
}

function lifecycleFingerprint(
  data: Record<string, unknown>,
  state: ReturnType<typeof fleetLifecycleState>,
): string {
  return JSON.stringify({
    sessionId: normalizeIdentifier(data.sessionId),
    ...state,
  });
}

function delayRevision(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : 0;
}

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
      console.warn(failureMessage, error);
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
  if (persistedFleetState.get(busId) === fingerprint) return;

  persistedFleetState.set(busId, fingerprint);
  // RTDB child events can arrive faster than Firestore commits. Serialize
  // lifecycle writes per bus so an older transition cannot finish after a
  // newer one and overwrite the durable fleet state.
  const previous = fleetWriteQueues.get(busId) ?? Promise.resolve();
  const queuedWrite = previous
    .catch(() => undefined)
    .then(async () => {
      const lockRef = db.collection("_active_bus_locks").doc(busId);
      const locationRef = db.collection("bus_locations").doc(busId);
      const persisted = await db.runTransaction(async (transaction) => {
        const lock = await transaction.get(lockRef);
        if (!lock.exists || normalizeIdentifier(lock.data()?.sessionId) !== sessionId) {
          return false;
        }
        transaction.set(locationRef, { ...state, lastSeen }, { merge: true });
        return true;
      });
      if (!persisted && persistedFleetState.get(busId) === fingerprint) {
        persistedFleetState.delete(busId);
      }
    });
  fleetWriteQueues.set(busId, queuedWrite);

  void queuedWrite.then(
    () => {
      if (fleetWriteQueues.get(busId) === queuedWrite) fleetWriteQueues.delete(busId);
    },
    (error) => {
      // Do not discard a newer fingerprint when an earlier queued write fails.
      if (persistedFleetState.get(busId) === fingerprint) persistedFleetState.delete(busId);
      if (fleetWriteQueues.get(busId) === queuedWrite) fleetWriteQueues.delete(busId);
      console.warn("[TripState] Failed to persist fleet lifecycle state:", error);
    },
  );
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
  persistedFleetState.set(busId, fingerprint);
  const lockRef = db.collection("_active_bus_locks").doc(busId);
  const locationRef = db.collection("bus_locations").doc(busId);
  const previous = fleetWriteQueues.get(busId) ?? Promise.resolve();
  const queuedResult = previous
    .catch(() => undefined)
    .then(() => db.runTransaction(async (transaction) => {
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
    }));
  const queuedWrite = queuedResult.then(
    () => undefined,
    () => undefined,
  );
  fleetWriteQueues.set(busId, queuedWrite);
  try {
    const persisted = await queuedResult;
    if (!persisted && persistedFleetState.get(busId) === fingerprint) {
      persistedFleetState.delete(busId);
    }
    return persisted;
  } catch (error) {
    if (persistedFleetState.get(busId) === fingerprint) {
      persistedFleetState.delete(busId);
    }
    throw error;
  } finally {
    if (fleetWriteQueues.get(busId) === queuedWrite) {
      fleetWriteQueues.delete(busId);
    }
  }
}

/** Loads one route with request coalescing and a short cache for missing IDs. */
async function ensureRouteLoaded(routeId: string): Promise<RouteStop[]> {
  if (routeStopsCache.has(routeId)) return routeStopsCache.get(routeId)!;
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
  if (persistedActiveRideState.get(documentId) === fingerprint) {
    return activeRideWriteQueues.get(documentId) ?? Promise.resolve();
  }

  persistedActiveRideState.set(documentId, fingerprint);
  const previous = activeRideWriteQueues.get(documentId) ?? Promise.resolve();
  const write: Promise<void> = previous
    .catch(() => undefined)
    .then(async () => {
      const activeRideRef = db.collection("active_rides").doc(documentId);
      const lockRef = db.collection("_active_bus_locks").doc(busId);
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
      if (!persisted && persistedActiveRideState.get(documentId) === fingerprint) {
        persistedActiveRideState.delete(documentId);
      }
    });
  activeRideWriteQueues.set(documentId, write);
  void write.then(
    () => {
      if (activeRideWriteQueues.get(documentId) === write) {
        activeRideWriteQueues.delete(documentId);
      }
    },
    (error) => {
      if (persistedActiveRideState.get(documentId) === fingerprint) {
        persistedActiveRideState.delete(documentId);
      }
      if (activeRideWriteQueues.get(documentId) === write) {
        activeRideWriteQueues.delete(documentId);
      }
      console.warn(
        `[TripState] Failed to persist active ride ${documentId}:`,
        error,
      );
    },
  );
  return write;
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
          persistedActiveRideState.delete(activeRideId);
          activeRideWriteQueues.delete(activeRideId);
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
    const previous = telemetryQueues.get(nodeKey) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(() => processLiveSnapshot(snapshot))
      .catch((error) => {
        console.error(`[TripState] Failed to process telemetry for ${nodeKey}:`, error);
      });
    telemetryQueues.set(nodeKey, queued);
    void queued.then(() => {
      if (telemetryQueues.get(nodeKey) === queued) {
        telemetryQueues.delete(nodeKey);
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
      persistedActiveRideState.delete(activeRideId);
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
        ...telemetryQueues.values(),
        ...fleetWriteQueues.values(),
        ...activeRideWriteQueues.values(),
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
      persistedFleetState.clear();
      persistedActiveRideState.clear();
      missingRouteUntil.clear();
      routeStopsCache.clear();
      console.log("[TripState] Engine stopped.");
    })();
    return stopPromise;
  };
}
