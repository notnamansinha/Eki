import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../middleware/requireAdmin";
import { db } from "../lib/firebaseAdmin";
import { isSafeDocumentId } from "../lib/documentId";

const router = Router();
export const settingsV2Router = Router();

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    driverId?: string;
    assignedBusId?: string;
    admin?: boolean;
  };
};

const STRING_LIMITS: Record<string, number> = {
  serviceStartTime: 64,
  noBusesMessage: 200,
  noBusesSubMessage: 300,
  announcementText: 500,
};

/**
 * PUT /api/settings
 *
 * Server-authoritative settings save. The admin panel previously wrote
 * `settings/global` from the client; the backend now validates the shape and
 * persists it (admin claim enforced by requireAdmin).
 */
const updateSettings = async (req: AuthenticatedRequest, res: Response) => {
  res.set("Cache-Control", "no-store");
  try {
    const partial = req.body ?? {};
    if (typeof partial !== "object" || Array.isArray(partial) || partial === null) {
      res.status(400).json({ error: "Invalid settings payload." });
      return;
    }

    const allowedKeys = new Set([
      "serviceStartTime",
      "noBusesMessage",
      "noBusesSubMessage",
      "announcementText",
      "announcementActive",
    ]);
    for (const key of Object.keys(partial)) {
      if (!allowedKeys.has(key)) {
        res.status(400).json({ error: `Unknown setting: ${key}` });
        return;
      }
    }
    if (Object.keys(partial).length === 0) {
      res.status(400).json({ error: "At least one setting is required." });
      return;
    }

    const sanitized: Record<string, string | boolean> = {};
    if (Object.hasOwn(partial, "announcementActive")) {
      if (typeof partial.announcementActive !== "boolean") {
        res.status(400).json({ error: "announcementActive must be a boolean." });
        return;
      }
      sanitized.announcementActive = partial.announcementActive;
    }
    // Destination keys come from the server-owned schema, never request keys.
    for (const [key, maximumLength] of Object.entries(STRING_LIMITS)) {
      if (!Object.hasOwn(partial, key)) continue;
      const value = partial[key];
      if (
        typeof value !== "string" ||
        value.length > maximumLength ||
        (key !== "announcementText" && value.trim().length === 0)
      ) {
        res.status(400).json({ error: `Invalid value for ${key}.` });
        return;
      }
      sanitized[key] = value;
    }

    await db.collection("settings").doc("global").set({
      ...sanitized,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.user?.uid ?? "admin",
    }, { merge: true });
    res.json({ saved: true });
  } catch (error) {
    console.error("[Settings] Failed to save settings:", error);
    res.status(500).json({ error: "Unable to save settings." });
  }
};

// The legacy PUT has always applied a partial update. Both paths share validation and persistence.
router.put("/", requireAdmin, updateSettings);
settingsV2Router.patch("/", requireAdmin, updateSettings);

export const MAX_PASSENGER_ROUTES = 50;
/** 24-hour "HH:mm", matching the frontend `STOP_TIME_PATTERN`. */
export const STOP_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type PassengerRouteEntry = { routeId: string; stopTimes: Record<string, string> };
/** Parsed request entry; stop times stay in a Map so request keys never become object properties. */
type PassengerRouteRequest = { routeId: string; stopTimes: Map<string, string> };
type RouteStopRef = { id: string; name: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
};

/** Request-supplied IDs are echoed in errors; keep the message bounded. */
const echo = (value: string) => value.length > 64 ? `${value.slice(0, 61)}...` : value;

const displayName = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

/** Ordered stop IDs and display names from a stored route document. */
function routeStops(data: Record<string, unknown> | undefined): RouteStopRef[] {
  const stops = Array.isArray(data?.stops) ? data.stops : [];
  const result: RouteStopRef[] = [];
  for (const stop of stops) {
    if (!isPlainObject(stop) || typeof stop.id !== "string" || !stop.id) continue;
    result.push({ id: stop.id, name: displayName(stop.name, displayName(stop.shortName, stop.id)) });
  }
  return result;
}

class PassengerRoutesInvalid extends Error {}

/** Structural validation only; route/stop existence is checked against Firestore afterwards. */
function parsePassengerRoutesBody(body: unknown): PassengerRouteRequest[] {
  if (!isPlainObject(body) || !hasExactKeys(body, ["routes"]) || !Array.isArray(body.routes)) {
    throw new PassengerRoutesInvalid("Request body must be exactly { routes: [...] }.");
  }
  if (body.routes.length > MAX_PASSENGER_ROUTES) {
    throw new PassengerRoutesInvalid(`At most ${MAX_PASSENGER_ROUTES} routes can be shown to passengers.`);
  }
  const seen = new Set<string>();
  const entries: PassengerRouteRequest[] = [];
  body.routes.forEach((entry, index) => {
    const position = `Route entry ${index + 1}`;
    if (!isPlainObject(entry) || !hasExactKeys(entry, ["routeId", "stopTimes"])) {
      throw new PassengerRoutesInvalid(`${position} must contain exactly routeId and stopTimes.`);
    }
    if (!isSafeDocumentId(entry.routeId)) {
      throw new PassengerRoutesInvalid(`${position} has an invalid route ID.`);
    }
    if (seen.has(entry.routeId)) {
      throw new PassengerRoutesInvalid(`Route ${entry.routeId} is listed more than once.`);
    }
    seen.add(entry.routeId);
    if (!isPlainObject(entry.stopTimes)) {
      throw new PassengerRoutesInvalid(`${position} stopTimes must be an object of stop ID to time.`);
    }
    const stopTimes = new Map<string, string>();
    for (const [stopId, time] of Object.entries(entry.stopTimes)) {
      if (typeof time !== "string") {
        throw new PassengerRoutesInvalid(`${position} has a non-text time for stop ${echo(stopId)}.`);
      }
      stopTimes.set(stopId, time);
    }
    entries.push({ routeId: entry.routeId, stopTimes });
  });
  return entries;
}

/** Check approvals against the stored routes; returns the record to persist. */
async function resolvePassengerRoutes(entries: PassengerRouteRequest[]): Promise<PassengerRouteEntry[]> {
  if (entries.length === 0) return [];
  const snapshots = await db.getAll(...entries.map(entry => db.collection("routes").doc(entry.routeId)));
  return entries.map((entry, index) => {
    const snapshot = snapshots[index];
    if (!snapshot?.exists) {
      throw new PassengerRoutesInvalid(`Route ${entry.routeId} no longer exists. Reload and try again.`);
    }
    const data = snapshot.data();
    const routeName = displayName(data?.name, entry.routeId);
    const stops = routeStops(data);
    const stopIds = new Set(stops.map(stop => stop.id));
    for (const stopId of entry.stopTimes.keys()) {
      if (!stopIds.has(stopId)) {
        throw new PassengerRoutesInvalid(`Route ${routeName} has no stop ${echo(stopId)}. Reload and try again.`);
      }
    }
    // Destination keys and order come from the stored route, never the request.
    const stopTimes: Record<string, string> = {};
    for (const stop of stops) {
      const time = entry.stopTimes.get(stop.id);
      if (time === undefined) {
        throw new PassengerRoutesInvalid(`Missing time for stop ${stop.name} on route ${routeName}.`);
      }
      if (!STOP_TIME_PATTERN.test(time)) {
        throw new PassengerRoutesInvalid(`Invalid time for stop ${stop.name} on route ${routeName}; use 24-hour HH:mm.`);
      }
      stopTimes[stop.id] = time;
    }
    return { routeId: entry.routeId, stopTimes };
  });
}

/**
 * PUT /api/v2/settings/passenger-routes
 *
 * Full replacement of the admin-approved passenger route list and per-stop
 * times stored at `settings/passengerRoutes`. Every approved route must still
 * exist and carry exactly one valid "HH:mm" time per current stop, so a saved
 * schedule never references deleted stops or silently omits one.
 */
const updatePassengerRoutes = async (req: AuthenticatedRequest, res: Response) => {
  res.set("Cache-Control", "no-store");
  try {
    const routes = await resolvePassengerRoutes(parsePassengerRoutesBody(req.body));
    // Full replace (no merge) so routes and stops removed by the admin stay removed.
    await db.collection("settings").doc("passengerRoutes").set({
      routes,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.user?.uid ?? "admin",
    });
    res.json({ saved: true });
  } catch (error) {
    if (error instanceof PassengerRoutesInvalid) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error("[Settings] Failed to save passenger routes:", error);
    res.status(500).json({ error: "Unable to save passenger routes." });
  }
};

export const passengerRoutesSettingsRouter = Router();
passengerRoutesSettingsRouter.put("/", requireAdmin, updatePassengerRoutes);

export default router;
