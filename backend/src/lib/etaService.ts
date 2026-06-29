/**
 * ETA Service — Server-Side Route & ETA Calculator
 *
 * ETA is computed from the pre-stored route polyline using pure Haversine
 * math — zero Google Maps Routes API calls at runtime.
 *
 * The full route polyline is fetched from Firestore once at server startup
 * (preloadRoutePolylines) and decoded into in-memory coordinate arrays.
 * Per-ETA computation is O(n) over polyline waypoints — no network cost.
 *
 * Previously: Routes API v2 at $0.008–$0.012/call → $3–$16/day for 10 buses.
 * Now: $0/day ongoing.
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

// ── Pure-JS Google Polyline Decoder ──────────────────────────────────────────
function decodePolyline(encoded: string): LatLng[] {
  const coords: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return coords;
}

// ── Find closest waypoint index on a decoded polyline ────────────────────────
function closestPolylineIndex(coords: LatLng[], target: LatLng): number {
  let minDist = Infinity, minIdx = 0;
  for (let i = 0; i < coords.length; i++) {
    // Use squared Euclidean distance (no sqrt needed for comparison)
    const dLat = coords[i].lat - target.lat;
    const dLng = coords[i].lng - target.lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < minDist) { minDist = d; minIdx = i; }
  }
  return minIdx;
}

/**
 * Compute ETA from bus position to destination using road-following polyline
 * distance — no Google Maps API call. Accuracy ≈ Haversine along road segments,
 * substantially better than straight-line (30–50% on curved urban roads).
 *
 * @param busLocation   Current bus lat/lng
 * @param destination   Destination lat/lng (last stop of route)
 * @param polylineCoords  Decoded polyline waypoints from routePolylineCache
 * @param busSpeedKmh   Bus speed; floored to 20 km/h to prevent infinite ETAs
 */
function computeETAFromPolyline(
  busLocation: LatLng,
  destination: LatLng,
  polylineCoords: LatLng[],
  busSpeedKmh: number = 25
): { etaSeconds: number; distanceMeters: number } {
  if (polylineCoords.length < 2) {
    // Fallback: straight-line estimate at 25 km/h
    const dist = haversineMeters(busLocation, destination);
    return {
      etaSeconds: Math.round((dist / 1000 / 25) * 3600),
      distanceMeters: Math.round(dist),
    };
  }

  const busIdx = closestPolylineIndex(polylineCoords, busLocation);
  const destIdx = closestPolylineIndex(polylineCoords, destination);

  // Walk along the polyline from bus → destination, summing segment distances.
  // If the bus is ahead of the destination on the polyline (route already passed),
  // the ETA is 0 since the stop was missed or completed.
  if (busIdx >= destIdx) {
    return { etaSeconds: 0, distanceMeters: 0 };
  }

  let distMeters = 0;
  for (let i = busIdx; i < destIdx; i++) {
    distMeters += haversineMeters(polylineCoords[i], polylineCoords[i + 1]);
  }

  // Speed floor of 20 km/h prevents unrealistically long ETAs at idle/stopped
  const effectiveSpeed = Math.max(busSpeedKmh, 20);
  const etaSeconds = Math.round((distMeters / 1000 / effectiveSpeed) * 3600);

  return { etaSeconds, distanceMeters: Math.round(distMeters) };
}

// ── Active ETA timers per bus ──
const etaIntervals = new Map<string, NodeJS.Timeout>();
const lastETAResults = new Map<string, ETAUpdate>();

// ── Last bus location at ETA computation time (for distance throttling) ──
const lastETALocation = new Map<string, LatLng>();

// ── Minimum distance bus must move before re-computing ETA (500m) ──
const MIN_MOVEMENT_METERS = 500;

// ── Route polyline cache: routeId → encoded string (from Firestore) ──
const routePolylineCache = new Map<string, string>();

// ── Decoded polyline cache: routeId → decoded LatLng[] (avoids repeat decoding) ──
const decodedPolylineCache = new Map<string, LatLng[]>();

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
        // Pre-decode now so first ETA computation has zero decode cost
        decodedPolylineCache.set(doc.id, decodePolyline(data.polyline));
        console.log(`📦 Cached + decoded polyline for route: ${doc.id}`);
      }
    });
    console.log(`✅ ETA Service: Pre-loaded ${routePolylineCache.size} route polylines from Firestore`);
  } catch (err) {
    console.error("❌ ETA Service: Failed to pre-load route polylines:", err);
  }
}

/**
 * Returns the cached encoded polyline for a route, or empty string if not found.
 */
export function getCachedPolyline(routeId: string): string {
  return routePolylineCache.get(routeId) || "";
}

/**
 * Returns the cached decoded polyline for a route, or empty array if not found.
 */
export function getCachedDecodedPolyline(routeId: string): LatLng[] {
  return decodedPolylineCache.get(routeId) || [];
}

/**
 * Starts periodic ETA computation for a bus.
 * Computes once immediately, then every intervalMs.
 * Skips computation if bus hasn't moved more than MIN_MOVEMENT_METERS.
 *
 * Uses polyline-based Haversine — zero Google Maps API cost.
 */
export function startETATracking(
  io: Server,
  busId: string,
  routeId: string,
  getLocation: () => LatLng | null,
  getDestination: () => LatLng | null,
  intervalMs: number = 180_000 // Default: 3 minutes
): void {
  // Clear any existing interval for this bus
  stopETATracking(busId);

  const compute = (forceCompute = false) => {
    const loc = getLocation();
    const dest = getDestination();
    if (!loc || !dest) return;

    // ── Distance-based skip: don't recompute if bus hasn't moved enough ──
    const lastLoc = lastETALocation.get(busId);
    if (!forceCompute && lastLoc) {
      const moved = haversineMeters(lastLoc, loc);
      if (moved < MIN_MOVEMENT_METERS) {
        console.log(`⏭️  ETA skip for bus ${busId}: only moved ${Math.round(moved)}m (< ${MIN_MOVEMENT_METERS}m threshold)`);
        return;
      }
    }

    // ── Polyline-based ETA computation (zero API cost) ────────────────────
    const polylineCoords = getCachedDecodedPolyline(routeId);
    const busSpeed = (() => {
      // If we can get bus speed from active buses, use it; otherwise floor at 25
      return 25; // Caller can extend this if they pass speed as a parameter
    })();

    const result = computeETAFromPolyline(loc, dest, polylineCoords, busSpeed);
    const etaMinutes = Math.max(1, Math.ceil(result.etaSeconds / 60));
    const distKm = (result.distanceMeters / 1000).toFixed(1);

    const update: ETAUpdate = {
      busId,
      routeId,
      etaSeconds: result.etaSeconds,
      etaMinutes,
      distanceMeters: result.distanceMeters,
      distanceKm: distKm,
      polyline: routePolylineCache.get(routeId) || "", // Full route polyline
      timestamp: Date.now(),
    };

    lastETAResults.set(busId, update);
    lastETALocation.set(busId, loc); // Record location at time of computation

    // Broadcast to all passengers and admin
    io.to("passengers").emit("bus:eta-update" as any, update);
    io.to("admin").emit("bus:eta-update" as any, update);

    console.log(`📍 ETA update for bus ${busId}: ${etaMinutes} min, ${distKm} km (polyline-based, $0 cost)`);
  };

  // Compute immediately if location already available
  const initialLoc = getLocation();
  if (initialLoc) {
    compute(true);
  } else {
    console.log(`⏳ ETA deferred for bus ${busId}: location not yet available`);
  }

  // Add jitter (±15s) so buses starting together don't fire in lockstep
  const jitter = Math.floor(Math.random() * 30_000) - 15_000;
  const interval = setInterval(() => compute(false), intervalMs + jitter);
  etaIntervals.set(busId, interval);

  console.log(`🚀 ETA tracking started for bus ${busId} (every ${intervalMs / 1000}s, polyline-based, $0/call)`);
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
    lastETALocation.delete(busId);
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
