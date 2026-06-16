/**
 * ETA Service — Server-Side Route & ETA Calculator
 *
 * Instead of every passenger calling the Google Maps Directions API independently,
 * the server computes ETA once per active bus on a 30-second interval and
 * broadcasts the result via Socket.io. This reduces API calls from
 * O(passengers × updates) to O(active_buses × 2/min).
 *
 * Also provides cached route polylines from Firestore for zero-cost
 * static route display on clients.
 */

import { Server } from "socket.io";
import { db } from "./firebaseAdmin";

interface LatLng {
  lat: number;
  lng: number;
}

export interface ETAUpdate {
  busId: string;
  routeId: string;
  etaSeconds: number;
  etaMinutes: number;
  distanceMeters: number;
  distanceKm: string;
  polyline: string; // encoded polyline for the active segment
  timestamp: number;
}

// ── Haversine distance (no API call needed) ──
function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ── Active ETA timers per bus ──
const etaIntervals = new Map<string, NodeJS.Timeout>();
const lastETAResults = new Map<string, ETAUpdate>();

// ── Last bus location at ETA computation time (for distance throttling) ──
const lastETALocation = new Map<string, LatLng>();

// ── Minimum distance bus must move before re-computing ETA (500m) ──
const MIN_MOVEMENT_METERS = 500;

// ── Route polyline cache (from Firestore — computed once during seed) ──
const routePolylineCache = new Map<string, string>();

/**
 * Pre-loads all route polylines from Firestore into memory.
 * Call once at server startup.
 */
export async function preloadRoutePolylines(): Promise<void> {
  try {
    const snapshot = await db.collection("routes").get();
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.polyline) {
        routePolylineCache.set(doc.id, data.polyline);
        console.log(`📦 Cached polyline for route: ${doc.id}`);
      }
    });
    console.log(`✅ ETA Service: Pre-loaded ${routePolylineCache.size} route polylines from Firestore`);
  } catch (err) {
    console.error("❌ ETA Service: Failed to pre-load route polylines:", err);
  }
}

/**
 * Returns the cached polyline for a route, or empty string if not found.
 */
export function getCachedPolyline(routeId: string): string {
  return routePolylineCache.get(routeId) || "";
}

/**
 * Computes ETA using Google Maps Routes API v2 (server-side only).
 * Falls back to straight-line estimation if the API call fails.
 */
async function computeETAFromAPI(
  busLocation: LatLng,
  destination: LatLng,
  intermediates: LatLng[] = []
): Promise<{ etaSeconds: number; distanceMeters: number; polyline: string }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    // Fallback: estimate based on straight-line distance at ~25 km/h avg speed
    const dist = haversineMeters(busLocation, destination);
    return {
      etaSeconds: Math.round((dist / 1000 / 25) * 3600),
      distanceMeters: Math.round(dist),
      polyline: "",
    };
  }

  try {
    const url = "https://routes.googleapis.com/directions/v2:computeRoutes";
    const body: Record<string, any> = {
      origin: {
        location: {
          latLng: { latitude: busLocation.lat, longitude: busLocation.lng },
        },
      },
      destination: {
        location: {
          latLng: { latitude: destination.lat, longitude: destination.lng },
        },
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: false,
      languageCode: "en-US",
      units: "METRIC",
    };

    // Only add intermediates if they exist
    if (intermediates.length > 0) {
      body.intermediates = intermediates.map((wp) => ({
        location: {
          latLng: { latitude: wp.lat, longitude: wp.lng },
        },
      }));
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Routes API error: ${response.status}`);
    }

    const data = (await response.json()) as any;
    if (!data.routes || data.routes.length === 0) {
      throw new Error("No routes returned");
    }

    const route = data.routes[0];
    const durationStr = route.duration || "0s";
    const seconds = parseInt(durationStr.replace("s", ""), 10) || 0;

    return {
      etaSeconds: seconds,
      distanceMeters: route.distanceMeters || 0,
      polyline: route.polyline?.encodedPolyline || "",
    };
  } catch (err) {
    console.warn("⚠️ ETA API call failed, using fallback:", (err as Error).message);
    // Fallback: straight-line estimate
    const dist = haversineMeters(busLocation, destination);
    return {
      etaSeconds: Math.round((dist / 1000 / 25) * 3600),
      distanceMeters: Math.round(dist),
      polyline: "",
    };
  }
}

/**
 * Starts periodic ETA computation for a bus.
 * Computes once immediately, then every INTERVAL_MS.
 * Skips API call if bus hasn't moved more than MIN_MOVEMENT_METERS.
 */
export function startETATracking(
  io: Server,
  busId: string,
  routeId: string,
  getLocation: () => LatLng | null,
  getDestination: () => LatLng | null,
  intervalMs: number = 180_000 // Default: 3 minutes (was 30s)
): void {
  // Clear any existing interval for this bus
  stopETATracking(busId);

  const compute = async (forceCompute = false) => {
    const loc = getLocation();
    const dest = getDestination();
    if (!loc || !dest) return;

    // ── Distance-based skip: don't call API if bus hasn't moved enough ──
    const lastLoc = lastETALocation.get(busId);
    if (!forceCompute && lastLoc) {
      const moved = haversineMeters(lastLoc, loc);
      if (moved < MIN_MOVEMENT_METERS) {
        console.log(`⏭️  ETA skip for bus ${busId}: only moved ${Math.round(moved)}m (< ${MIN_MOVEMENT_METERS}m threshold)`);
        return;
      }
    }

    const result = await computeETAFromAPI(loc, dest);
    const etaMinutes = Math.max(1, Math.ceil(result.etaSeconds / 60));
    const distKm = (result.distanceMeters / 1000).toFixed(1);

    const update: ETAUpdate = {
      busId,
      routeId,
      etaSeconds: result.etaSeconds,
      etaMinutes,
      distanceMeters: result.distanceMeters,
      distanceKm: distKm,
      polyline: result.polyline,
      timestamp: Date.now(),
    };

    lastETAResults.set(busId, update);
    lastETALocation.set(busId, loc); // Record location at time of API call

    // Broadcast to all passengers
    io.to("passengers").emit("bus:eta-update" as any, update);
    // Also send to admin
    io.to("admin").emit("bus:eta-update" as any, update);

    console.log(
      `📍 ETA update for bus ${busId}: ${etaMinutes} min, ${distKm} km`
    );
  };

  // Compute immediately ONLY if we already have a valid location
  // (guards against calling the Routes API on null coords at bus start)
  const initialLoc = getLocation();
  if (initialLoc) {
    compute(true);
  } else {
    console.log(`⏳ ETA deferred for bus ${busId}: location not yet available`);
  }

  // Add jitter (±15s) so buses starting together don't fire in lockstep
  const jitter = Math.floor(Math.random() * 30_000) - 15_000;
  // Then on interval (subject to distance threshold)
  const interval = setInterval(() => compute(false), intervalMs + jitter);
  etaIntervals.set(busId, interval);

  console.log(
    `🚀 ETA tracking started for bus ${busId} (every ${intervalMs / 1000}s, min movement: ${MIN_MOVEMENT_METERS}m)`
  );
}

/**
 * Stops ETA tracking for a bus.
 */
export function stopETATracking(busId: string): void {
  const existing = etaIntervals.get(busId);
  if (existing) {
    clearInterval(existing);
    etaIntervals.delete(busId);
    lastETAResults.delete(busId);
    lastETALocation.delete(busId); // Clear location reference
    console.log(`🛑 ETA tracking stopped for bus ${busId}`);
  }
}

/**
 * Returns the last computed ETA for a bus (for new passenger joins).
 */
export function getLastETA(busId: string): ETAUpdate | undefined {
  return lastETAResults.get(busId);
}

/**
 * Returns all active ETA results (for admin dashboard / new joins).
 */
export function getAllETAs(): ETAUpdate[] {
  return Array.from(lastETAResults.values());
}
