import { Router, type Request, type Response } from "express";
import { db } from "../lib/firebaseAdmin";
import { requireAdmin } from "../middleware/requireAdmin";
import { invalidatePlanRoute } from "./plan";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/;
const ROUTE_TYPES = new Set(["up", "down", "circular"]);

interface LatLng {
  lat: number;
  lng: number;
}

interface ValidatedStop extends LatLng {
  id: string;
  name: string;
  shortName: string;
}

function isValidLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== "object") return false;
  const { lat, lng } = value as Record<string, unknown>;
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

function validateStops(value: unknown): ValidatedStop[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 27) return null;
  const stops: ValidatedStop[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const stop = entry as Record<string, unknown>;
    const id = typeof stop.id === "string" ? stop.id.trim() : "";
    const name = typeof stop.name === "string" ? stop.name.trim() : "";
    const shortName = typeof stop.shortName === "string" ? stop.shortName.trim() : "";
    if (
      !SAFE_ID.test(id) ||
      ids.has(id) ||
      !name ||
      name.length > 100 ||
      !shortName ||
      shortName.length > 32 ||
      !isValidLatLng(stop)
    ) {
      return null;
    }
    ids.add(id);
    stops.push({ id, name, shortName, lat: stop.lat as number, lng: stop.lng as number });
  }
  return stops;
}

async function computePolyline(waypoints: LatLng[]) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("MAPS_NOT_CONFIGURED");

  const origin = waypoints[0];
  const destination = waypoints[waypoints.length - 1];
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
    languageCode: "en-US",
    units: "METRIC",
  };
  const intermediates = waypoints.slice(1, -1);
  if (intermediates.length > 0) {
    body.intermediates = intermediates.map((waypoint) => ({
      location: { latLng: { latitude: waypoint.lat, longitude: waypoint.lng } },
    }));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const upstreamBody = await response.text();
      console.error(`Routes API HTTP ${response.status}:`, upstreamBody.slice(0, 1_000));
      throw new Error(`MAPS_HTTP_${response.status}`);
    }
    const payload = (await response.json()) as {
      routes?: Array<{
        polyline?: { encodedPolyline?: string };
        distanceMeters?: number;
        duration?: string;
      }>;
    };
    const route = payload.routes?.[0];
    const polyline = route?.polyline?.encodedPolyline;
    if (
      !polyline ||
      polyline.length > 500_000 ||
      !Number.isFinite(route?.distanceMeters) ||
      typeof route?.duration !== "string"
    ) {
      throw new Error("MAPS_INVALID_RESPONSE");
    }
    return {
      polyline,
      distanceMeters: route.distanceMeters as number,
      duration: route.duration,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function geometryError(res: Response): void {
  res.status(process.env.GOOGLE_MAPS_API_KEY ? 502 : 503).json({
    error: "Unable to compute route geometry.",
  });
}

router.post("/compute-polyline", requireAdmin, async (req: Request, res: Response) => {
  const waypoints = req.body?.waypoints;
  if (
    !Array.isArray(waypoints) ||
    waypoints.length < 2 ||
    waypoints.length > 27 ||
    waypoints.some((waypoint) => !isValidLatLng(waypoint))
  ) {
    res.status(400).json({ error: "waypoints must contain 2-27 valid coordinates." });
    return;
  }
  try {
    res.json(await computePolyline(waypoints));
  } catch (error) {
    console.error("[Routes] Geometry computation failed:", error);
    geometryError(res);
  }
});

router.put("/:routeId", requireAdmin, async (req: Request, res: Response) => {
  const routeId = req.params.routeId;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const color = typeof req.body?.color === "string" ? req.body.color : "";
  const type = req.body?.type;
  const mode = req.body?.mode;
  const stops = validateStops(req.body?.stops);
  if (
    !SAFE_ID.test(routeId) ||
    !name ||
    name.length > 100 ||
    !SAFE_COLOR.test(color) ||
    !ROUTE_TYPES.has(type) ||
    (mode !== "create" && mode !== "edit") ||
    !stops
  ) {
    res.status(400).json({ error: "Invalid route data." });
    return;
  }

  try {
    const routeRef = db.collection("routes").doc(routeId);
    const existing = await routeRef.get();
    if (mode === "create" && existing.exists) {
      res.status(409).json({ error: "A route with this ID already exists." });
      return;
    }
    if (mode === "edit" && !existing.exists) {
      res.status(404).json({ error: "The route no longer exists." });
      return;
    }
    const waypoints = stops.map(({ lat, lng }) => ({ lat, lng }));
    const geometry = await computePolyline(waypoints);
    const routeData = {
      id: routeId,
      name,
      color,
      type,
      stops,
      waypoints,
      ...geometry,
    };
    if (mode === "create") {
      await routeRef.create(routeData);
    } else {
      await routeRef.set(routeData);
    }
    invalidatePlanRoute(routeId);
    res.json({ saved: true, routeId, ...geometry });
  } catch (error) {
    console.error("[Routes] Failed to save validated route:", error);
    geometryError(res);
  }
});

router.delete("/:routeId", requireAdmin, async (req: Request, res: Response) => {
  const routeId = req.params.routeId;
  if (!SAFE_ID.test(routeId)) {
    res.status(400).json({ error: "Invalid route ID." });
    return;
  }
  try {
    const [modernAssignments, legacyAssignments] = await Promise.all([
      db.collection("buses").where("assignedRoutes", "array-contains", routeId).limit(1).get(),
      db.collection("buses").where("assignedRouteId", "==", routeId).limit(1).get(),
    ]);
    if (!modernAssignments.empty || !legacyAssignments.empty) {
      res.status(409).json({ error: "Unassign this route from every vehicle before deleting it." });
      return;
    }
    await db.collection("routes").doc(routeId).delete();
    invalidatePlanRoute(routeId);
    res.json({ deleted: true });
  } catch (error) {
    console.error("[Routes] Failed to delete route:", error);
    res.status(500).json({ error: "Unable to delete route." });
  }
});

export default router;
