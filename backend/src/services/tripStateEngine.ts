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

const busTripContext = new Map<string, BusTripContext>();
const STOP_GEOFENCE_M = 20;

// Removed duplicated haversine math.

async function loadRouteContext(busId: string, routeId: string, location?: { lat: number; lng: number }) {
  if (busTripContext.has(busId)) {
    if (location) {
      busTripContext.get(busId)!.latestLocation = location;
    }
    return;
  }
  try {
    const routeDoc = await db.collection("routes").doc(routeId).get();
    const routeData = routeDoc.data();
    const stops: RouteStop[] = (routeData?.stops ?? []).map((s: any) => ({
      id: s.id ?? "", lat: s.lat ?? 0, lng: s.lng ?? 0, name: s.name ?? "",
    }));

    let recoveredTripState: TripState = "pre_departure";
    let recoveredStopIndex = 0;

    const busDoc = await db.collection("bus_locations").doc(busId).get();
    const busData = busDoc.data();
    if (busData && (busData.tripState === "in_service" || busData.tripState === "maintenance")) {
      recoveredTripState = busData.tripState as TripState;
      recoveredStopIndex = typeof busData.currentStopIndex === "number" ? busData.currentStopIndex : 0;
    }

    let latestLocation = location;
    if (!latestLocation && busData && busData.lat != null && busData.lng != null) {
      latestLocation = { lat: busData.lat, lng: busData.lng };
    }

    busTripContext.set(busId, { stops, tripState: recoveredTripState, currentStopIndex: recoveredStopIndex, latestLocation });
    console.log(`[TripState] Bus ${busId} context loaded — ${stops.length} stops, state: ${recoveredTripState}`);

    if (routeData?.waypoints && routeData.waypoints.length >= 2) {
      const lastWp = routeData.waypoints[routeData.waypoints.length - 1];
      const destination = { lat: lastWp.lat, lng: lastWp.lng };
      // Pass a dummy getLocation function that fetches the latest location from busTripContext if needed,
      // or just rely on RTDB coordinates.
      startETATracking(busId, routeId, () => busTripContext.get(busId)?.latestLocation || null, () => destination, parseInt(process.env.ETA_INTERVAL_MS || "180000", 10));
    }
  } catch (err) {
    console.error(`[TripState] Failed to load route context for bus ${busId}:`, err);
  }
}

function computeTripState(busId: string, lat: number, lng: number, motionState: MotionState): { tripState: TripState; currentStopIndex: number } {
  const ctx = busTripContext.get(busId);
  if (!ctx || ctx.stops.length === 0) return { tripState: "in_service", currentStopIndex: 0 };
  if (motionState === "uncertain") return { tripState: "maintenance", currentStopIndex: ctx.currentStopIndex };

  const { stops, tripState: current, currentStopIndex } = ctx;
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];

  if (current === "pre_departure") {
    const d = haversineMeters({lat, lng}, firstStop);
    if (d <= STOP_GEOFENCE_M) {
      ctx.tripState = "in_service";
      return { tripState: "in_service", currentStopIndex: 0 };
    }
    return { tripState: "pre_departure", currentStopIndex };
  }

  if (current === "in_service") {
    const d = haversineMeters({lat, lng}, lastStop);
    if (d <= STOP_GEOFENCE_M) {
      ctx.tripState = "completed";
      return { tripState: "completed", currentStopIndex: stops.length - 1 };
    }
    let closestIdx = currentStopIndex;
    let closestD = Infinity;
    const searchEnd = Math.min(currentStopIndex + 5, stops.length - 2);
    for (let i = currentStopIndex; i <= searchEnd; i++) {
      const dist = haversineMeters({lat, lng}, stops[i]);
      if (dist < closestD) { closestD = dist; closestIdx = i; }
    }
    ctx.currentStopIndex = closestIdx;
    return { tripState: "in_service", currentStopIndex: ctx.currentStopIndex };
  }

  if (current === "maintenance") {
    ctx.tripState = "in_service";
    return { tripState: "in_service", currentStopIndex };
  }
  return { tripState: current, currentStopIndex };
}

export function startTripStateEngine() {
  console.log("🚀 Trip State Engine started, listening to RTDB /activeBuses");
  const busesRef = rtdb.ref("activeBuses");

  busesRef.on("child_added", async (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.busId || !data.routeId) return;
    const loc = data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : undefined;
    await loadRouteContext(data.busId, data.routeId, loc);
  });

  busesRef.on("child_changed", async (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.busId || !data.routeId || data.lat == null || data.lng == null) return;

    const loc = { lat: data.lat, lng: data.lng };

    await loadRouteContext(data.busId, data.routeId, loc);

    // If driver marked offline via frontend, handle cleanup
    if (data.status === "offline") {
      busTripContext.delete(data.busId);
      stopETATracking(data.busId);
      db.collection("bus_locations").doc(data.busId).set({ deviceState: "offline", lastSeen: new Date().toISOString() }, { merge: true }).catch(console.warn);
      snapshot.ref.remove().catch(console.error);
      return;
    }

    const { tripState, currentStopIndex } = computeTripState(data.busId, data.lat, data.lng, data.motionState || "active");

    if (tripState !== data.tripState || currentStopIndex !== data.currentStopIndex) {
      snapshot.ref.update({ tripState, currentStopIndex }).catch(console.error);
    }

    if (tripState === "completed" && data.tripState !== "completed") {
      const completionTimestamp = new Date().toISOString();
      const ctx = busTripContext.get(data.busId);
      const routeStops = ctx?.stops ?? [];
      
      db.collection("completed_trips").add({
        busId: data.busId,
        driverId: data.driverId || "unknown",
        routeId: data.routeId,
        completedAt: completionTimestamp,
        stopCount: routeStops.length,
        stopNames: routeStops.map(s => s.name),
      }).catch(console.warn);

      setTimeout(() => {
        snapshot.ref.remove().catch(console.error);
        busTripContext.delete(data.busId);
        stopETATracking(data.busId);
        db.collection("bus_locations").doc(data.busId).set({ deviceState: "offline", tripState: "completed", lastSeen: completionTimestamp }, { merge: true }).catch(console.warn);
      }, 30_000);
    }

    db.collection("bus_locations").doc(data.busId).set({
      ...data,
      tripState,
      currentStopIndex,
      lastSeen: new Date().toISOString()
    }, { merge: true }).catch(console.error);
  });
}
