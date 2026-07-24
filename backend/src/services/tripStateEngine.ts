import { db, rtdb } from "../lib/firebaseAdmin";
import { startETATracking, stopETATracking } from "../lib/etaService";
import { reduceTripState } from "./tripStateReducer";

interface RouteStop { id: string; lat: number; lng: number; name: string; }
const latestLocations = new Map<string, {lat: number, lng: number}>();
const routeStopsCache = new Map<string, RouteStop[]>();
const routeDestCache = new Map<string, {lat: number, lng: number}>();
const activeETATracking = new Map<string, string>();
const completedTimeouts = new Map<string, NodeJS.Timeout>();
const persistedFleetState = new Map<string, string>();
const fleetWriteQueues = new Map<string, Promise<void>>();

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

async function ensureRouteLoaded(routeId: string): Promise<RouteStop[]> {
  if (routeStopsCache.has(routeId)) return routeStopsCache.get(routeId)!;
  try {
    const routeDoc = await db.collection("routes").doc(routeId).get();
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

export function startTripStateEngine() {
  console.log("🚀 Trip State Engine started, listening to RTDB /activeBuses");
  const busesRef = rtdb.ref("activeBuses");

  busesRef.on("child_added", async (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.busId || !data.routeId) return;
    
    if (data.lat != null && data.lng != null) {
      latestLocations.set(data.busId, { lat: data.lat, lng: data.lng });
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
        ETA_INTERVAL_MS
      );
    }
  });

  busesRef.on("child_changed", async (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.busId || !data.routeId || data.lat == null || data.lng == null) return;

    latestLocations.set(data.busId, { lat: data.lat, lng: data.lng });
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
      snapshot.ref.remove().catch(console.error);
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
        ETA_INTERVAL_MS
      );
    } else if (!currentActiveRoute) {
      activeETATracking.set(data.busId, data.routeId);
      startETATracking(
        data.busId, 
        data.routeId, 
        () => latestLocations.get(data.busId) || null, 
        () => routeDestCache.get(data.routeId) || null, 
        ETA_INTERVAL_MS
      );
    }

    const { tripState, currentStopIndex, hasDepartedOrigin } = reduceTripState({
      lat: data.lat,
      lng: data.lng,
      motionState: data.motionState || "moving",
      currentTripState: data.tripState || "pre_departure",
      currentStopIndex: data.currentStopIndex || 0,
      stops,
      hasDepartedOrigin: data.hasDepartedOrigin === true,
    });

    if (
      tripState !== data.tripState ||
      currentStopIndex !== data.currentStopIndex ||
      hasDepartedOrigin !== (data.hasDepartedOrigin === true)
    ) {
      snapshot.ref
        .update({ tripState, currentStopIndex, hasDepartedOrigin })
        .catch(console.error);
    }

    if (data.tripState !== "completed" && completedTimeouts.has(data.busId)) {
      clearTimeout(completedTimeouts.get(data.busId));
      completedTimeouts.delete(data.busId);
    }

    if (tripState === "completed" && data.tripState !== "completed") {
      const completionTimestamp = new Date().toISOString();
      db.collection("completed_trips").add({
        busId: data.busId,
        driverId: data.driverId || "unknown",
        routeId: data.routeId,
        completedAt: completionTimestamp,
        stopCount: stops.length,
        stopNames: stops.map(s => s.name),
      }).catch(console.warn);

      const timeoutId = setTimeout(() => {
        snapshot.ref.remove().catch(console.error);
        latestLocations.delete(data.busId);
        activeETATracking.delete(data.busId);
        stopETATracking(data.busId);
        completedTimeouts.delete(data.busId);
        persistFleetState({ ...data, deviceState: "offline", status: "offline", tripState: "completed" }, completionTimestamp);
      }, 30_000);
      
      completedTimeouts.set(data.busId, timeoutId);
    }

    persistFleetState({ ...data, tripState }, new Date().toISOString());
  });

  busesRef.on("child_removed", (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.busId) return;

    // RTDB is the live-presence source. Preserve the final offline lifecycle
    // state before forgetting a bus removed by the stale sweep.
    persistFleetState({ ...data, status: "offline", deviceState: "offline" }, new Date().toISOString());
    latestLocations.delete(data.busId);
    activeETATracking.delete(data.busId);
    stopETATracking(data.busId);
    
    if (completedTimeouts.has(data.busId)) {
      clearTimeout(completedTimeouts.get(data.busId));
      completedTimeouts.delete(data.busId);
    }
  });

  // Hardware trackers cannot register an RTDB onDisconnect handler. Sweep only
  // nodes whose server timestamp has exceeded the client freshness horizon.
  setInterval(async () => {
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
}
