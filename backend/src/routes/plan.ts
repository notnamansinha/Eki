import { Router, Request, Response } from "express";
import { db } from "../lib/firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

const isSafeId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

import {
  decodePolyline,
  encodePolyline,
} from "../lib/polylineUtils";
import { buildRouteSegment } from "../lib/routeSegment";

interface Stop {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
  waypointIndex?: number;
}

interface RouteDoc {
  id: string;
  name: string;
  color: string;
  stops: Stop[];
  waypoints: { lat: number; lng: number }[];
  polyline: string;
  forwardPolyline?: string;
  reversePolyline?: string;
}

const ROUTE_CACHE_MS = 5 * 60 * 1000;
const routeCache = new Map<string, {
  route: RouteDoc;
  forwardCoords: { lat: number; lng: number }[];
  reverseCoords: { lat: number; lng: number }[];
  expiresAt: number;
}>();

export function invalidatePlanRoute(routeId: string): void {
  routeCache.delete(routeId);
}

async function getCachedRoute(routeId: string) {
  const cached = routeCache.get(routeId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const document = await db.collection("routes").doc(routeId).get();
  if (!document.exists) return null;
  const route = document.data() as RouteDoc;
  const forwardPolyline = route.forwardPolyline ?? route.polyline;
  const value = {
    route,
    forwardCoords: forwardPolyline ? decodePolyline(forwardPolyline) : [],
    reverseCoords: route.reversePolyline ? decodePolyline(route.reversePolyline) : [],
    expiresAt: Date.now() + ROUTE_CACHE_MS,
  };
  if (routeCache.size >= 250) {
    const oldestKey = routeCache.keys().next().value;
    if (oldestKey) routeCache.delete(oldestKey);
  }
  routeCache.set(routeId, value);
  return value;
}



/**
 * POST /api/plan
 *
 * Body: { routeId, startStopId, endStopId, viaStopId? }
 *
 * Returns the ordered stops on the segment A→B (or A→via→B),
 * and the encoded polyline for that segment — sliced from the
 * pre-stored full-route polyline.
 *
 * RUNTIME COST: $0 — reads Firestore cache + pure math.
 * No Google Directions API calls are made.
 */
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { routeId, startStopId, endStopId, viaStopId } = req.body as {
    routeId?: string;
    startStopId?: string;
    endStopId?: string;
    viaStopId?: string;
  };

  if (!isSafeId(routeId) || !isSafeId(startStopId) || !isSafeId(endStopId) ||
      (viaStopId !== undefined && !isSafeId(viaStopId))) {
    res.status(400).json({ error: "Route and stop IDs must use 1-128 letters, numbers, underscores, or hyphens." });
    return;
  }

  if (startStopId === endStopId) {
    res.status(400).json({ error: "startStopId and endStopId must be different" });
    return;
  }

  try {
    const cached = await getCachedRoute(routeId);
    if (!cached) {
      res.status(404).json({ error: `Route '${routeId}' not found in Firestore` });
      return;
    }
    const { route, forwardCoords, reverseCoords } = cached;

    if (!route.stops || route.stops.length < 2) {
      res.status(422).json({ error: "Route has no stops data. Please re-seed the database." });
      return;
    }

    const stops: Stop[] = route.stops;

    // Find the start, end, and via stops
    const startStop = stops.find((s) => s.id === startStopId);
    const endStop = stops.find((s) => s.id === endStopId);
    const viaStop = viaStopId ? stops.find((s) => s.id === viaStopId) : null;

    if (!startStop) {
      res.status(404).json({ error: `Stop '${startStopId}' not found on route '${routeId}'` });
      return;
    }
    if (!endStop) {
      res.status(404).json({ error: `Stop '${endStopId}' not found on route '${routeId}'` });
      return;
    }
    if (viaStopId && !viaStop) {
      res.status(404).json({ error: `Via stop '${viaStopId}' not found on route '${routeId}'` });
      return;
    }

    const startNaturalIndex = stops.indexOf(startStop);
    const endNaturalIndex = stops.indexOf(endStop);
    const direction = startNaturalIndex < endNaturalIndex ? "forward" : "reverse";
    const fullCoords = direction === "forward" ? forwardCoords : reverseCoords;
    if (fullCoords.length < 2) {
      res.status(422).json({
        error: `Route has no stored ${direction} geometry. Load or re-save the route to repair it.`,
      });
      return;
    }

    let segment;
    try {
      segment = buildRouteSegment(fullCoords, stops, startStop, endStop, viaStop);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid route segment.",
      });
      return;
    }
    const segmentCoords = segment.coordinates;
    const stopsOnSegment = segment.stops;

    // ── Re-encode sliced coords (no API call) ────────────────────────────────
    const segmentPolyline = encodePolyline(segmentCoords);

    res.json({
      routeId: route.id,
      routeName: route.name,
      routeColor: route.color,
      startStop,
      endStop,
      viaStop: viaStop || null,
      stopsOnSegment,
      polyline: segmentPolyline,
      totalStops: stopsOnSegment.length,
      direction,
    });

  } catch (err) {
    console.error("❌ /api/plan error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
