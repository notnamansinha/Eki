import { Router, Request, Response } from "express";
import { db } from "../lib/firebaseAdmin";

const router = Router();


import {
  decodePolyline,
  encodePolyline,
  closestPolylineIndex,
} from "../lib/polylineUtils";

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
router.post("/", async (req: Request, res: Response) => {
  const { routeId, startStopId, endStopId, viaStopId } = req.body as {
    routeId?: string;
    startStopId?: string;
    endStopId?: string;
    viaStopId?: string;
  };

  if (!routeId || !startStopId || !endStopId) {
    res.status(400).json({ error: "routeId, startStopId, and endStopId are required" });
    return;
  }

  if (startStopId === endStopId) {
    res.status(400).json({ error: "startStopId and endStopId must be different" });
    return;
  }

  try {
    const doc = await db.collection("routes").doc(routeId).get();
    if (!doc.exists) {
      res.status(404).json({ error: `Route '${routeId}' not found in Firestore` });
      return;
    }
    const route = doc.data() as RouteDoc;

    if (!route.stops || route.stops.length < 2) {
      res.status(422).json({ error: "Route has no stops data. Please re-seed the database." });
      return;
    }

    if (!route.polyline) {
      res.status(422).json({ error: "Route has no stored polyline. Please re-seed the database." });
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

    // ── Decode the pre-stored full route polyline (no API call) ─────────────
    const fullCoords = decodePolyline(route.polyline);

    // Find closest polyline indices for each stop
    const startIdx = closestPolylineIndex(fullCoords, { lat: startStop.lat, lng: startStop.lng });
    const endIdx   = closestPolylineIndex(fullCoords, { lat: endStop.lat,   lng: endStop.lng });

    if (startIdx === endIdx) {
      res.status(400).json({ error: "Start and end stops are too close together on the polyline." });
      return;
    }

    // Ensure we always slice forward (A before B)
    const [loIdx, hiIdx] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const isReversed = startIdx > endIdx;

    let segmentCoords: { lat: number; lng: number }[];
    let stopsOnSegment: Stop[];

    if (viaStop) {
      // A → via → B: compute two slices and concatenate
      const viaIdx = closestPolylineIndex(fullCoords, { lat: viaStop.lat, lng: viaStop.lng });

      // Clamp via within start-end range
      const clampedVia = Math.max(loIdx, Math.min(hiIdx, viaIdx));

      if (isReversed) {
        // Route goes end→via→start in natural order, reverse the whole thing
        segmentCoords = [
          ...fullCoords.slice(clampedVia, endIdx + 1),
          ...fullCoords.slice(startIdx, clampedVia + 1).reverse(),
        ].reverse();
      } else {
        segmentCoords = [
          ...fullCoords.slice(startIdx, clampedVia + 1),
          ...fullCoords.slice(clampedVia, endIdx + 1),
        ];
      }

      // Stops on segment with via (ordered: start → via → stop before via → end)
      stopsOnSegment = stops.filter((s) => {
        const idx = closestPolylineIndex(fullCoords, { lat: s.lat, lng: s.lng });
        return idx >= loIdx && idx <= hiIdx;
      });

    } else {
      // Simple A → B
      const rawSlice = fullCoords.slice(loIdx, hiIdx + 1);
      segmentCoords = isReversed ? [...rawSlice].reverse() : rawSlice;

      // Filter stops that fall within the A→B section (using waypointIndex)
      stopsOnSegment = stops.filter((s) => {
        if (s.waypointIndex === undefined) return false;
        const wi = s.waypointIndex;
        const startWi = startStop.waypointIndex ?? 0;
        const endWi   = endStop.waypointIndex ?? stops.length - 1;
        const [lo, hi] = startWi < endWi ? [startWi, endWi] : [endWi, startWi];
        return wi >= lo && wi <= hi;
      });

      // Sort by direction of travel
      const startWi = startStop.waypointIndex ?? 0;
      const endWi   = endStop.waypointIndex ?? stops.length - 1;
      stopsOnSegment.sort((a, b) => {
        const aWi = a.waypointIndex ?? 0;
        const bWi = b.waypointIndex ?? 0;
        return startWi <= endWi ? aWi - bWi : bWi - aWi;
      });
    }

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
    });

  } catch (err) {
    console.error("❌ /api/plan error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
