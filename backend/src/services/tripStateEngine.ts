import { db, rtdb } from "../lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { reduceTripState } from "./tripStateReducer";

interface RouteStop { id: string; lat: number; lng: number; name: string; }
const routeStopsCache = new Map<string, RouteStop[]>();
const routeLoadPromises = new Map<string, Promise<RouteStop[]>>();
const completedTimeouts = new Map<string, NodeJS.Timeout>();
const persistedFleetState = new Map<string, string>();
const fleetWriteQueues = new Map<string, Promise<void>>();
const persistedActiveRideState = new Map<string, string>();
const activeRideWriteQueues = new Map<string, Promise<void>>();
const telemetryQueues = new Map<string, Promise<void>>();
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

/**
 * Firestore is the durable fleet-state store, not a second telemetry stream.
 * Persist only lifecycle changes; coordinates, speed and heartbeat data remain
 * in RTDB, which prevents a Firestore write for every GNSS update.
 */
function persistFleetState(
  data: Record<string, unknown>,
  lastSeen: string,
  forgetAfterWrite = false,
): void {
  const busId = typeof data.busId === "string" ? data.busId : null;
  if (!busId) return;

  const state = {
    routeId: typeof data.routeId === "string" ? data.routeId : null,
    driverId: typeof data.driverId === "string" ? data.driverId : null,
    status: typeof data.status === "string" ? data.status : "active",
    deviceState: typeof data.deviceState === "string" ? data.deviceState : "online",
    tripState: typeof data.tripState === "string" ? data.tripState : "pre_departure",
  };
  const fingerprint = JSON.stringify(state);
  if (persistedFleetState.get(busId) === fingerprint) return;

  persistedFleetState.set(busId, fingerprint);
  // RTDB child events can arrive faster than Firestore commits. Serialize
  // lifecycle writes per bus so an older transition cannot finish after a
  // newer one and overwrite the durable fleet state.
  const previous = fleetWriteQueues.get(busId) ?? Promise.resolve();
  const queuedWrite = previous
    .catch(() => undefined)
    .then(async () => {
      await db.collection("bus_locations").doc(busId).set({ ...state, lastSeen }, { merge: true });
    });
  fleetWriteQueues.set(busId, queuedWrite);

  void queuedWrite.then(
    () => {
      if (fleetWriteQueues.get(busId) === queuedWrite) fleetWriteQueues.delete(busId);
      if (
        forgetAfterWrite &&
        persistedFleetState.get(busId) === fingerprint
      ) {
        persistedFleetState.delete(busId);
      }
    },
    (error) => {
      // Do not discard a newer fingerprint when an earlier queued write fails.
      if (persistedFleetState.get(busId) === fingerprint) persistedFleetState.delete(busId);
      if (fleetWriteQueues.get(busId) === queuedWrite) fleetWriteQueues.delete(busId);
      console.warn("[TripState] Failed to persist fleet lifecycle state:", error);
    },
  );
}

async function ensureRouteLoaded(routeId: string): Promise<RouteStop[]> {
  if (routeStopsCache.has(routeId)) return routeStopsCache.get(routeId)!;
  const pending = routeLoadPromises.get(routeId);
  if (pending) return pending;

  const load = (async () => {
    try {
      const routeDoc = await db.collection("routes").doc(routeId).get();
      const routeData = routeDoc.data();
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

function activeRideDocumentId(
  data: Record<string, unknown>,
): string | null {
  return typeof data.busId === "string" && typeof data.routeId === "string"
    ? `${data.busId}_${data.routeId}`
    : null;
}

function persistActiveRideLifecycle(
  data: Record<string, unknown>,
  tripState: "pre_departure" | "in_service",
  currentStopIndex: number,
  hasDepartedOrigin: boolean,
): Promise<void> {
  const documentId = activeRideDocumentId(data);
  if (
    !documentId ||
    data.status !== "active" ||
    typeof data.sessionId !== "string" ||
    typeof data.driverId !== "string"
  ) {
    return Promise.resolve();
  }
  const state = {
    sessionId: data.sessionId,
    busId: data.busId,
    driverId: data.driverId,
    routeId: data.routeId,
    status: "active",
    tripState,
    currentStopIndex,
    hasDepartedOrigin,
    delayMinutes:
      typeof data.delayMinutes === "number" ? data.delayMinutes : 0,
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
      await db.collection("active_rides").doc(documentId).set({
        ...state,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
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

function activateRideSession(sessionId: string): void {
  const sessionRef = db.collection("ride_sessions").doc(sessionId);
  void db.runTransaction(async (transaction) => {
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
  }).catch((error) => {
    console.warn(
      `[TripState] Failed to activate session ${sessionId}:`,
      error,
    );
  });
}

export function startTripStateEngine(): () => void {
  console.log("🚀 Trip State Engine started, listening to RTDB /activeBuses");
  const busesRef = rtdb.ref("activeBuses");
  const unsubscribeRoutes = db.collection("routes").limit(500).onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        cacheRoute(change.doc.id, change.type === "removed" ? undefined : change.doc.data());
      });
    },
    (error) => console.error("[TripState] Route cache watcher failed:", error),
  );

  const childAddedHandler = async (snapshot: import("firebase-admin/database").DataSnapshot) => {
    const data = snapshot.val();
    if (!data || !data.busId || !data.routeId) return;
    
    persistFleetState(data, new Date().toISOString());
    
    await ensureRouteLoaded(data.routeId);

    const nodeKey = snapshot.key || `${data.busId}_${data.routeId}`;
    const telemetryTimestamp = Number(data.timestamp);
    const previousTelemetry = processedTelemetry.get(nodeKey);
    const isNewTelemetry =
      Number.isFinite(telemetryTimestamp) &&
      Number.isFinite(data.lat) &&
      Number.isFinite(data.lng) &&
      (!previousTelemetry || telemetryTimestamp > previousTelemetry.timestamp);
    if (
      isNewTelemetry
    ) {
      processedTelemetry.set(nodeKey, {
        timestamp: telemetryTimestamp,
        lat: data.lat,
        lng: data.lng,
      });
    }
  };

  const processChildChanged = async (snapshot: import("firebase-admin/database").DataSnapshot) => {
    const data = snapshot.val();
    if (
      !data ||
      !data.busId ||
      !data.routeId ||
      !Number.isFinite(data.lat) ||
      !Number.isFinite(data.lng)
    ) return;

    const stops = await ensureRouteLoaded(data.routeId);

    // If driver marked offline via frontend, handle cleanup
    if (data.status === "offline") {
      if (completedTimeouts.has(data.busId)) {
        clearTimeout(completedTimeouts.get(data.busId));
        completedTimeouts.delete(data.busId);
      }
      persistFleetState({ ...data, deviceState: "offline", status: "offline" }, new Date().toISOString());
      return;
    }

    const nodeKey = snapshot.key || `${data.busId}_${data.routeId}`;
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
        await snapshot.ref.update({
          tripState,
          currentStopIndex,
          hasDepartedOrigin,
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
      stops[reachedStopIndex]
    ) {
      const stop = stops[reachedStopIndex];
      db.collection("ride_sessions").doc(data.sessionId).set({
        stopsReached: {
          [reachedStopIndex]: {
            stopIndex: reachedStopIndex,
            stopId: stop.id,
            stopName: stop.name,
            timestamp: FieldValue.serverTimestamp(),
          },
        },
      }, { merge: true }).catch((error) => {
        console.warn(
          `[TripState] Failed to record stop ${reachedStopIndex} for session ${data.sessionId}:`,
          error,
        );
      });
    }

    if (data.tripState !== "completed" && completedTimeouts.has(data.busId)) {
      clearTimeout(completedTimeouts.get(data.busId));
      completedTimeouts.delete(data.busId);
    }

    if (tripState === "completed" && data.tripState !== "completed") {
      const completionTimestamp = new Date().toISOString();
      const completionId =
        typeof data.sessionId === "string" && data.sessionId
          ? data.sessionId
          : nodeKey;
      const activeRideId = activeRideDocumentId(data);
      const completedRef = db.collection("completed_trips").doc(completionId);
      const batch = db.batch();
      batch.set(completedRef, {
        busId: data.busId,
        driverId: data.driverId || "unknown",
        routeId: data.routeId,
        completedAt: completionTimestamp,
        stopCount: stops.length,
        stopNames: stops.map(s => s.name),
        sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
      }, { merge: true });
      if (typeof data.sessionId === "string") {
        batch.set(db.collection("ride_sessions").doc(data.sessionId), {
          status: "completed",
          endTime: Date.now(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      if (activeRideId) {
        batch.delete(db.collection("active_rides").doc(activeRideId));
      }
      try {
        await batch.commit();
        if (activeRideId) {
          persistedActiveRideState.delete(activeRideId);
          activeRideWriteQueues.delete(activeRideId);
        }
        await snapshot.ref.update({
          tripState,
          currentStopIndex,
          hasDepartedOrigin,
        });
      } catch (error) {
        console.warn(
          `[TripState] Failed to persist completion ${completionId}:`,
          error,
        );
        return;
      }

      const timeoutId = setTimeout(() => {
        completedTimeouts.delete(data.busId);
        // Do not recreate a node removed by the stale sweep, and do not mark a
        // newer shift offline if the same bus/route key was reused meanwhile.
        snapshot.ref.transaction((current) => {
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
        }).catch((error) => {
          console.warn(`[TripState] Failed to retire completed session ${data.sessionId}:`, error);
        });
        persistFleetState({ ...data, status: "offline", tripState: "completed" }, completionTimestamp);
      }, 30_000);
      
      completedTimeouts.set(data.busId, timeoutId);
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

  const childChangedHandler = (
    snapshot: import("firebase-admin/database").DataSnapshot,
  ) => {
    const nodeKey = snapshot.key;
    if (!nodeKey) return;
    const previous = telemetryQueues.get(nodeKey) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(() => processChildChanged(snapshot))
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

  const childRemovedHandler = (snapshot: import("firebase-admin/database").DataSnapshot) => {
    const data = snapshot.val();
    if (!data || !data.busId) return;

    // RTDB is the live-presence source. Preserve the final offline lifecycle
    // state before forgetting a bus removed by the stale sweep.
    persistFleetState(
      { ...data, status: "offline", deviceState: "offline" },
      new Date().toISOString(),
      true,
    );
    processedTelemetry.delete(snapshot.key || `${data.busId}_${data.routeId || ""}`);
    const activeRideId = activeRideDocumentId(data);
    if (activeRideId) {
      persistedActiveRideState.delete(activeRideId);
      activeRideWriteQueues.delete(activeRideId);
    }
    if (snapshot.key) telemetryQueues.delete(snapshot.key);
    if (completedTimeouts.has(data.busId)) {
      clearTimeout(completedTimeouts.get(data.busId));
      completedTimeouts.delete(data.busId);
    }
  };

  busesRef.on("child_added", childAddedHandler);
  busesRef.on("child_changed", childChangedHandler);
  busesRef.on("child_removed", childRemovedHandler);

  // Hardware trackers cannot register an RTDB onDisconnect handler. Sweep only
  // nodes whose server timestamp has exceeded the client freshness horizon.
  const staleSweepTimer = setInterval(async () => {
    try {
      const snapshot = await busesRef.once("value");
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
  }, STALE_BUS_MS);
  staleSweepTimer.unref();

  return () => {
    unsubscribeRoutes();
    busesRef.off("child_added", childAddedHandler);
    busesRef.off("child_changed", childChangedHandler);
    busesRef.off("child_removed", childRemovedHandler);
    clearInterval(staleSweepTimer);
    completedTimeouts.forEach(clearTimeout);
    completedTimeouts.clear();
    processedTelemetry.clear();
    persistedActiveRideState.clear();
    activeRideWriteQueues.clear();
    telemetryQueues.clear();
    console.log("[TripState] Engine stopped.");
  };
}
