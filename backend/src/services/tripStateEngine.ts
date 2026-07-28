import { db, rtdb } from "../lib/firebaseAdmin";
import { startETATracking, stopETATracking, updateRoutePolylineCache } from "../lib/etaService";
import { FieldValue } from "firebase-admin/firestore";
import { reduceTripState } from "./tripStateReducer";

interface RouteStop { id: string; lat: number; lng: number; name: string; }
interface LiveLocation { lat: number; lng: number; speed: number | null; }
const latestLocations = new Map<string, LiveLocation>();
const routeStopsCache = new Map<string, RouteStop[]>();
const routeDestCache = new Map<string, {lat: number, lng: number}>();
const routeLoadPromises = new Map<string, Promise<RouteStop[]>>();
const activeETATracking = new Map<string, string>();
const completedTimeouts = new Map<string, NodeJS.Timeout>();
const persistedFleetState = new Map<string, string>();
const fleetWriteQueues = new Map<string, Promise<void>>();
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
const ETA_INTERVAL_MS = readIntervalMs(process.env.ETA_INTERVAL_MS, 180_000, 30_000);

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
    routeDestCache.delete(routeId);
    updateRoutePolylineCache(routeId);
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
  const destination = stops.at(-1);
  if (destination) {
    routeDestCache.set(routeId, { lat: destination.lat, lng: destination.lng });
  } else {
    routeDestCache.delete(routeId);
  }
  updateRoutePolylineCache(
    routeId,
    typeof routeData.polyline === "string" ? routeData.polyline : undefined,
  );
}

export function startTripStateEngine(): () => void {
  console.log("🚀 Trip State Engine started, listening to RTDB /activeBuses");
  const busesRef = rtdb.ref("activeBuses");
  const unsubscribeRoutes = db.collection("routes").onSnapshot(
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
    
    if (Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
      latestLocations.set(data.busId, {
        lat: data.lat,
        lng: data.lng,
        speed: Number.isFinite(data.speed) ? data.speed : null,
      });
    }
    persistFleetState(data, new Date().toISOString());
    
    await ensureRouteLoaded(data.routeId);
    
    if (!activeETATracking.has(data.busId)) {
      activeETATracking.set(data.busId, data.routeId);
      startETATracking(
        data.busId, 
        data.routeId, 
        () => latestLocations.get(data.busId) || null, 
        () => routeDestCache.get(data.routeId) || null, 
        ETA_INTERVAL_MS,
        () => latestLocations.get(data.busId)?.speed ?? null,
      );
    }

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

  const childChangedHandler = async (snapshot: import("firebase-admin/database").DataSnapshot) => {
    const data = snapshot.val();
    if (
      !data ||
      !data.busId ||
      !data.routeId ||
      !Number.isFinite(data.lat) ||
      !Number.isFinite(data.lng)
    ) return;

    latestLocations.set(data.busId, {
      lat: data.lat,
      lng: data.lng,
      speed: Number.isFinite(data.speed) ? data.speed : null,
    });
    const stops = await ensureRouteLoaded(data.routeId);

    // If driver marked offline via frontend, handle cleanup
    if (data.status === "offline") {
      latestLocations.delete(data.busId);
      activeETATracking.delete(data.busId);
      stopETATracking(data.busId);
      if (completedTimeouts.has(data.busId)) {
        clearTimeout(completedTimeouts.get(data.busId));
        completedTimeouts.delete(data.busId);
      }
      persistFleetState({ ...data, deviceState: "offline", status: "offline" }, new Date().toISOString());
      return;
    }

    // Handle route changes
    const currentActiveRoute = activeETATracking.get(data.busId);
    if (currentActiveRoute && currentActiveRoute !== data.routeId) {
      stopETATracking(data.busId);
      activeETATracking.set(data.busId, data.routeId);
      startETATracking(
        data.busId, 
        data.routeId, 
        () => latestLocations.get(data.busId) || null, 
        () => routeDestCache.get(data.routeId) || null, 
        ETA_INTERVAL_MS,
        () => latestLocations.get(data.busId)?.speed ?? null,
      );
    } else if (!currentActiveRoute) {
      activeETATracking.set(data.busId, data.routeId);
      startETATracking(
        data.busId, 
        data.routeId, 
        () => latestLocations.get(data.busId) || null, 
        () => routeDestCache.get(data.routeId) || null, 
        ETA_INTERVAL_MS,
        () => latestLocations.get(data.busId)?.speed ?? null,
      );
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

    if (
      tripState !== data.tripState ||
      currentStopIndex !== data.currentStopIndex ||
      hasDepartedOrigin !== (data.hasDepartedOrigin === true)
    ) {
      snapshot.ref
        .update({ tripState, currentStopIndex, hasDepartedOrigin })
        .catch((error) => {
          console.error(`[TripState] Failed to update live state for ${nodeKey}:`, error);
        });
    }

    const reachedStopIndex =
      tripState === "completed" && data.tripState !== "completed"
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
      db.collection("completed_trips").doc(completionId).set({
        busId: data.busId,
        driverId: data.driverId || "unknown",
        routeId: data.routeId,
        completedAt: completionTimestamp,
        stopCount: stops.length,
        stopNames: stops.map(s => s.name),
        sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
      }, { merge: true }).catch(console.warn);
      if (typeof data.sessionId === "string") {
        db.collection("ride_sessions").doc(data.sessionId).set({
          status: "completed",
          endTime: Date.now(),
        }, { merge: true }).catch(console.warn);
      }

      const timeoutId = setTimeout(() => {
        latestLocations.delete(data.busId);
        activeETATracking.delete(data.busId);
        stopETATracking(data.busId);
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
            timestamp: { ".sv": "timestamp" },
          };
        }).catch((error) => {
          console.warn(`[TripState] Failed to retire completed session ${data.sessionId}:`, error);
        });
        persistFleetState({ ...data, status: "offline", tripState: "completed" }, completionTimestamp);
      }, 30_000);
      
      completedTimeouts.set(data.busId, timeoutId);
    }

    persistFleetState({ ...data, tripState }, new Date().toISOString());
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
    latestLocations.delete(data.busId);
    processedTelemetry.delete(snapshot.key || `${data.busId}_${data.routeId || ""}`);
    activeETATracking.delete(data.busId);
    stopETATracking(data.busId);
    
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
        const data = child.val() as { timestamp?: unknown } | null;
        if (typeof data?.timestamp === "number" && now - data.timestamp > STALE_BUS_MS) {
          removals.push(child.ref.remove());
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
    activeETATracking.forEach((_routeId, busId) => stopETATracking(busId));
    activeETATracking.clear();
    latestLocations.clear();
    processedTelemetry.clear();
    console.log("[TripState] Engine stopped.");
  };
}
