import { db, rtdb } from "../lib/firebaseAdmin";
import { startETATracking, stopETATracking, haversineMeters } from "../lib/etaService";
import type { TripState, MotionState } from "../types";

interface RouteStop { id: string; lat: number; lng: number; name: string; }
interface BusTripContext {
  stops: RouteStop[];
  tripState: TripState;
  currentStopIndex: number;
  latestLocation?: { lat: number; lng: number };
}

const latestLocations = new Map<string, {lat: number, lng: number}>();
const routeStopsCache = new Map<string, RouteStop[]>();
const routeDestCache = new Map<string, {lat: number, lng: number}>();
const activeETATracking = new Map<string, string>();
const completedTimeouts = new Map<string, NodeJS.Timeout>();

const STOP_GEOFENCE_M = 20;

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
    let closestIdx = currentStopIndex;
    let closestD = Infinity;
    const searchEnd = Math.min(currentStopIndex + 5, stops.length - 2);
    for (let i = currentStopIndex; i <= searchEnd; i++) {
      const dist = haversineMeters({lat, lng}, stops[i]);
      if (dist < closestD) { closestD = dist; closestIdx = i; }
    }
    return { tripState: "in_service", currentStopIndex: closestIdx };
  }

  if (currentTripState === "maintenance") {
    return { tripState: "in_service", currentStopIndex };
  }
  return { tripState: currentTripState, currentStopIndex };
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
    
    await ensureRouteLoaded(data.routeId);
    
    if (!activeETATracking.has(data.busId)) {
      activeETATracking.set(data.busId, data.routeId);
      startETATracking(
        data.busId, 
        data.routeId, 
        () => latestLocations.get(data.busId) || null, 
        () => routeDestCache.get(data.routeId) || null, 
        parseInt(process.env.ETA_INTERVAL_MS || "180000", 10)
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
      db.collection("bus_locations").doc(data.busId).set({ deviceState: "offline", lastSeen: new Date().toISOString() }, { merge: true }).catch(console.warn);
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
        parseInt(process.env.ETA_INTERVAL_MS || "180000", 10)
      );
    } else if (!currentActiveRoute) {
      activeETATracking.set(data.busId, data.routeId);
      startETATracking(
        data.busId, 
        data.routeId, 
        () => latestLocations.get(data.busId) || null, 
        () => routeDestCache.get(data.routeId) || null, 
        parseInt(process.env.ETA_INTERVAL_MS || "180000", 10)
      );
    }

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
        db.collection("bus_locations").doc(data.busId).set({ deviceState: "offline", tripState: "completed", lastSeen: completionTimestamp }, { merge: true }).catch(console.warn);
      }, 30_000);
      
      completedTimeouts.set(data.busId, timeoutId);
    }

    db.collection("bus_locations").doc(data.busId).set({
      ...data, tripState, currentStopIndex, lastSeen: new Date().toISOString()
    }, { merge: true }).catch(console.error);
  });

  busesRef.on("child_removed", (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.busId) return;
    
    latestLocations.delete(data.busId);
    activeETATracking.delete(data.busId);
    stopETATracking(data.busId);
    
    if (completedTimeouts.has(data.busId)) {
      clearTimeout(completedTimeouts.get(data.busId));
      completedTimeouts.delete(data.busId);
    }
  });
}
