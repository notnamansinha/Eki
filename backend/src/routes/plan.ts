import { Router, Request, Response } from "express";
import { db } from "../lib/firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();
export const segmentRoutes = Router();

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

// Stored geometry that cannot be decoded is treated like missing geometry, so
// the planner answers with the repairable 422 instead of a generic 500.
const safeDecode = (value: unknown): { lat: number; lng: number }[] => {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    return decodePolyline(value);
  } catch {
    return [];
  }
};

async function getCachedRoute(routeId: string) {
  const cached = routeCache.get(routeId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const document = await db.collection("routes").doc(routeId).get();
  if (!document.exists) return null;
  const route = document.data() as RouteDoc;
  const forwardCoords = safeDecode(route.forwardPolyline ?? route.polyline);
  const decodedReverse = safeDecode(route.reversePolyline);
  const value = {
    route,
    forwardCoords,
    // Legacy route documents predate directional reverse geometry. Fall back to
    // the reversed forward (A→Z handled as Z→A) polyline so a reverse trip on a
    // historical route never 422s purely because reversePolyline is absent or
    // unusable.
    reverseCoords: decodedReverse.length >= 2
      ? decodedReverse
      : [...forwardCoords].reverse(),
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
type PlanInput = {
  routeId?: string;
  startStopId?: string;
  endStopId?: string;
  viaStopId?: string;
};

const planSegment = async (res: Response, input: PlanInput) => {
  res.set("Cache-Control", "no-store");
  const { routeId, startStopId, endStopId, viaStopId } = input;

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
      res.status(422).json({ error: "This route has no stops configured yet." });
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
    // The directional geometry is drawn in travel order, so the stops are
    // projected onto it in that same order and the segment is a forward slice.
    const travelStops = direction === "forward" ? stops : [...stops].reverse();
    if (fullCoords.length < 2) {
      res.status(422).json({
        error: `Route has no stored ${direction} geometry. Load or re-save the route to repair it.`,
      });
      return;
    }

    let segment;
    try {
      segment = buildRouteSegment(fullCoords, travelStops, startStop, endStop, viaStop);
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
};

router.post("/", requireAuth, (req: Request, res: Response) => {
  void planSegment(res, req.body ?? {});
});

segmentRoutes.get("/:routeId/segments", requireAuth, (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  const allowed = new Set(["from", "to", "via"]);
  const { from, to, via } = req.query;
  if (Object.keys(req.query).some((key) => !allowed.has(key)) ||
      typeof from !== "string" || typeof to !== "string" ||
      (via !== undefined && typeof via !== "string")) {
    res.status(400).json({ error: "Invalid route segment query parameter." });
    return;
  }
  void planSegment(res, {
    routeId: typeof req.params.routeId === "string" ? req.params.routeId : undefined,
    startStopId: from,
    endStopId: to,
    viaStopId: via,
  });
});

export default router;
