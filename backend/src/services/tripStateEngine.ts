import { db, rtdb } from "../lib/firebaseAdmin";
import type { DataSnapshot } from "firebase-admin/database";
import {
  startETATracking,
  stopETATracking,
  haversineMeters,
  cacheRoutePolyline,
  evictRoutePolyline,
} from "../lib/etaService";
import type { TripState, MotionState } from "../types";

interface RouteStop { id: string; lat: number; lng: number; name: string; }
const latestLocations = new Map<string, {lat: number, lng: number}>();
// Live reported speed (km/h) per bus, fed into ETA computation.
const latestSpeeds = new Map<string, number>();
const routeStopsCache = new Map<string, RouteStop[]>();
const routeDestCache = new Map<string, {lat: number, lng: number}>();
const activeETATracking = new Map<string, string>();
const completedTimeouts = new Map<string, NodeJS.Timeout>();
const persistedFleetState = new Map<string, string>();
const fleetWriteQueues = new Map<string, Promise<void>>();

const STOP_GEOFENCE_M = 20;
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
function persistFleetState(data: Record<string, unknown>, lastSeen: string): void {
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
    },
    (error) => {
      // Do not discard a newer fingerprint when an earlier queued write fails.
      if (persistedFleetState.get(busId) === fingerprint) persistedFleetState.delete(busId);
      if (fleetWriteQueues.get(busId) === queuedWrite) fleetWriteQueues.delete(busId);
      console.warn("[TripState] Failed to persist fleet lifecycle state:", error);
    },
  );
}

function extractBusAndRoute(snapshot: DataSnapshot): { busId: string | null; routeId: string | null } {
  const data = snapshot.val() || {};
  let busId = typeof data.busId === "string" && data.busId.trim() ? data.busId : null;
  let routeId = typeof data.routeId === "string" && data.routeId.trim() ? data.routeId : null;

  if ((!busId || !routeId) && snapshot.key) {
    const parts = snapshot.key.split("_");
    if (!busId && parts[0]) busId = parts[0];
    if (!routeId && parts[1]) routeId = parts.slice(1).join("_");
  }
  return { busId, routeId };
}

async function ensureRouteLoaded(routeId: string): Promise<RouteStop[]> {
  if (!routeId) return [];
  if (routeStopsCache.has(routeId)) return routeStopsCache.get(routeId)!;
  try {
    const routeDoc = await db.collection("routes").doc(routeId).get();
    if (!routeDoc.exists) {
      // Do not cache missing route so future attempts can re-query Firestore if created later
      return [];
    }
    const routeData = routeDoc.data();
    const stops: RouteStop[] = (routeData?.stops ?? []).map((s: any) => ({
      id: s.id ?? "", lat: s.lat ?? 0, lng: s.lng ?? 0, name: s.name ?? "",
    }));
    routeStopsCache.set(routeId, stops);
    
    if (routeData?.waypoints && routeData.waypoints.length >= 2) {
      const lastWp = routeData.waypoints[routeData.waypoints.length - 1];
      routeDestCache.set(routeId, { lat: lastWp.lat, lng: lastWp.lng });
    }
    return stops;
  } catch (err) {
    console.error(`[TripState] Failed to load route ${routeId}:`, err);
    return [];
  }
}

function computeTripState(
  lat: number, lng: number, 
  motionState: MotionState, 
  currentTripState: TripState, 
  currentStopIndex: number, 
  stops: RouteStop[]
): { tripState: TripState; currentStopIndex: number } {
  if (stops.length === 0) return { tripState: "in_service", currentStopIndex: 0 };
  if (motionState === "uncertain") return { tripState: "maintenance", currentStopIndex };

  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];

  if (currentTripState === "pre_departure") {
    if (haversineMeters({lat, lng}, firstStop) <= STOP_GEOFENCE_M) {
      return { tripState: "in_service", currentStopIndex: 0 };
    }
    return { tripState: "pre_departure", currentStopIndex };
  }

  if (currentTripState === "in_service") {
    if (haversineMeters({lat, lng}, lastStop) <= STOP_GEOFENCE_M) {
      return { tripState: "completed", currentStopIndex: stops.length - 1 };
    }
    // The driver app is the source of truth for intermediate stop progression.
    // Removed the aggressive "closest of next 5 stops" logic because it causes
    // phantom skips if a future stop is closer in a straight line than the route.
    return { tripState: "in_service", currentStopIndex };
  }

  if (currentTripState === "maintenance") {
    return { tripState: "in_service", currentStopIndex };
  }
  return { tripState: currentTripState, currentStopIndex };
}

/**
 * Watches the Firestore `routes` collection and keeps the in-memory route
 * caches (stops, destination, polylines) in sync with admin edits. Without
 * this, the backend geofences and computes ETAs against stale geometry until
 * the next deploy/restart.
 */
function startRouteCacheInvalidation(): () => void {
  return db.collection("routes").onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const routeId = change.doc.id;
      if (change.type === "removed") {
        routeStopsCache.delete(routeId);
        routeDestCache.delete(routeId);
        evictRoutePolyline(routeId);
        console.log(`🗑️  [RouteCache] Evicted deleted route: ${routeId}`);
        return;
      }
      // added or modified → refresh stops, destination, and polyline caches
      const data = change.doc.data();
      const stops: RouteStop[] = (data?.stops ?? []).map((s: any) => ({
        id: s.id ?? "", lat: s.lat ?? 0, lng: s.lng ?? 0, name: s.name ?? "",
      }));
      routeStopsCache.set(routeId, stops);
      if (Array.isArray(data?.waypoints) && data.waypoints.length >= 2) {
        const lastWp = data.waypoints[data.waypoints.length - 1];
        routeDestCache.set(routeId, { lat: lastWp.lat, lng: lastWp.lng });
      } else {
        routeDestCache.delete(routeId);
      }
      if (typeof data?.polyline === "string" && data.polyline) {
        cacheRoutePolyline(routeId, data.polyline);
      } else {
        evictRoutePolyline(routeId);
      }
      if (change.type === "modified") {
        console.log(`♻️  [RouteCache] Refreshed modified route: ${routeId}`);
      }
    });
  }, (error) => {
    console.error("[RouteCache] routes listener error:", error);
  });
}

// ── Engine lifecycle handles (for graceful shutdown) ──
let staleSweepInterval: NodeJS.Timeout | null = null;
let routeCacheUnsubscribe: (() => void) | null = null;

export function startTripStateEngine() {
  console.log("🚀 Trip State Engine started, listening to RTDB /activeBuses");
  const busesRef = rtdb.ref("activeBuses");

  // Keep route caches in sync with admin edits (fixes stale-ETA/geofence bug).
  routeCacheUnsubscribe = startRouteCacheInvalidation();

  busesRef.on("child_added", async (snapshot: DataSnapshot) => {
    const data = snapshot.val() || {};
    const { busId, routeId } = extractBusAndRoute(snapshot);
    if (!busId || !routeId) return;

    const fullData = { ...data, busId, routeId };

    if (data.lat != null && data.lng != null) {
      latestLocations.set(busId, { lat: data.lat, lng: data.lng });
    }
    if (typeof data.speed === "number" && Number.isFinite(data.speed)) {
      latestSpeeds.set(busId, data.speed);
    }
    persistFleetState(fullData, new Date().toISOString());
    
    await ensureRouteLoaded(routeId);
    
    if (!activeETATracking.has(busId)) {
      activeETATracking.set(busId, routeId);
      startETATracking(
        busId, 
        routeId, 
        () => latestLocations.get(busId) || null, 
        () => routeDestCache.get(routeId) || null, 
        ETA_INTERVAL_MS,
        () => latestSpeeds.get(busId) ?? null
      );
    }
  });

  busesRef.on("child_changed", async (snapshot: DataSnapshot) => {
    const data = snapshot.val() || {};
    const { busId, routeId } = extractBusAndRoute(snapshot);
    if (!busId || !routeId) return;

    const fullData = { ...data, busId, routeId };

    if (data.lat != null && data.lng != null) {
      latestLocations.set(busId, { lat: data.lat, lng: data.lng });
    }
    if (typeof data.speed === "number" && Number.isFinite(data.speed)) {
      latestSpeeds.set(busId, data.speed);
    }

    const stops = await ensureRouteLoaded(routeId);

    // If driver marked offline via frontend, handle cleanup
    if (data.status === "offline") {
      latestLocations.delete(busId);
      latestSpeeds.delete(busId);
      activeETATracking.delete(busId);
      stopETATracking(busId);
      if (completedTimeouts.has(busId)) {
        clearTimeout(completedTimeouts.get(busId)!);
        completedTimeouts.delete(busId);
      }
      persistFleetState({ ...fullData, deviceState: "offline", status: "offline" }, new Date().toISOString());
      snapshot.ref.remove().catch(console.error);
      return;
    }

    // Handle route changes
    const currentActiveRoute = activeETATracking.get(busId);
    if (currentActiveRoute && currentActiveRoute !== routeId) {
      stopETATracking(busId);
      activeETATracking.set(busId, routeId);
      startETATracking(
        busId, 
        routeId, 
        () => latestLocations.get(busId) || null, 
        () => routeDestCache.get(routeId) || null, 
        ETA_INTERVAL_MS,
        () => latestSpeeds.get(busId) ?? null
      );
    } else if (!currentActiveRoute) {
      activeETATracking.set(busId, routeId);
      startETATracking(
        busId, 
        routeId, 
        () => latestLocations.get(busId) || null, 
        () => routeDestCache.get(routeId) || null, 
        ETA_INTERVAL_MS,
        () => latestSpeeds.get(busId) ?? null
      );
    }

    if (data.lat != null && data.lng != null) {
      const { tripState, currentStopIndex } = computeTripState(
        data.lat, data.lng, 
        data.motionState || "active", 
        data.tripState || "pre_departure", 
        data.currentStopIndex || 0, 
        stops
      );

      if (tripState !== data.tripState || currentStopIndex !== data.currentStopIndex) {
        snapshot.ref.update({ tripState, currentStopIndex }).catch(console.error);
      }

      if (data.tripState !== "completed" && completedTimeouts.has(busId)) {
        clearTimeout(completedTimeouts.get(busId)!);
        completedTimeouts.delete(busId);
      }

      if (tripState === "completed" && data.tripState !== "completed") {
        const completionTimestamp = new Date().toISOString();
        db.collection("completed_trips").add({
          busId,
          driverId: data.driverId || "unknown",
          routeId,
          completedAt: completionTimestamp,
          stopCount: stops.length,
          stopNames: stops.map(s => s.name),
        }).catch(console.warn);

        const timeoutId = setTimeout(() => {
          snapshot.ref.remove().catch(console.error);
          latestLocations.delete(busId);
          latestSpeeds.delete(busId);
          activeETATracking.delete(busId);
          stopETATracking(busId);
          completedTimeouts.delete(busId);
          persistFleetState({ ...fullData, deviceState: "offline", status: "offline", tripState: "completed" }, completionTimestamp);
        }, 30_000);
        
        completedTimeouts.set(busId, timeoutId);
      }

      persistFleetState({ ...fullData, tripState }, new Date().toISOString());
    } else {
      persistFleetState(fullData, new Date().toISOString());
    }
  });

  busesRef.on("child_removed", (snapshot: DataSnapshot) => {
    const data = snapshot.val() || {};
    const { busId, routeId } = extractBusAndRoute(snapshot);
    if (!busId) return;

    const fullData = { ...data, busId, routeId };

    // RTDB is the live-presence source. Preserve the final offline lifecycle
    // state before forgetting a bus removed by the stale sweep.
    persistFleetState({ ...fullData, status: "offline", deviceState: "offline" }, new Date().toISOString());
    latestLocations.delete(busId);
    latestSpeeds.delete(busId);
    activeETATracking.delete(busId);
    stopETATracking(busId);
    
    if (completedTimeouts.has(busId)) {
      clearTimeout(completedTimeouts.get(busId)!);
      completedTimeouts.delete(busId);
    }
  });

  // Hardware trackers cannot register an RTDB onDisconnect handler. Sweep only
  // nodes whose server timestamp has exceeded the client freshness horizon.
  staleSweepInterval = setInterval(async () => {
    try {
      const snapshot = await busesRef.once("value");
      const now = Date.now();
      const removals: Promise<unknown>[] = [];
      snapshot.forEach((child: DataSnapshot) => {
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
}

/**
 * Gracefully stops the trip state engine: detaches listeners, clears the
 * stale-sweep interval and all pending completion timeouts, stops ETA
 * trackers, and flushes any in-flight fleet-state writes. Called on SIGTERM
 * so deploys/scale-downs don't leak timers or truncate Firestore writes.
 */
export async function stopTripStateEngine(): Promise<void> {
  console.log("🛑 Stopping Trip State Engine...");

  if (routeCacheUnsubscribe) {
    routeCacheUnsubscribe();
    routeCacheUnsubscribe = null;
  }
  if (staleSweepInterval) {
    clearInterval(staleSweepInterval);
    staleSweepInterval = null;
  }

  // Detach RTDB listeners.
  try {
    rtdb.ref("activeBuses").off();
  } catch (err) {
    console.warn("[TripState] failed to detach activeBuses listener:", err);
  }

  // Clear pending completion timeouts so they don't fire after shutdown.
  for (const [busId, timeoutId] of completedTimeouts) {
    clearTimeout(timeoutId);
    completedTimeouts.delete(busId);
  }

  // Stop all ETA trackers.
  for (const busId of Array.from(activeETATracking.keys())) {
    stopETATracking(busId);
  }
  activeETATracking.clear();

  // Flush in-flight fleet-state writes so lifecycle state isn't truncated.
  try {
    await Promise.allSettled(Array.from(fleetWriteQueues.values()));
  } catch (err) {
    console.warn("[TripState] error flushing fleet writes:", err);
  }

  console.log("✅ Trip State Engine stopped.");
}
