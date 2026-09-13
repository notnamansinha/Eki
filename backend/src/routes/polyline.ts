import { computeOrderedRouteGeometry, MAX_ROUTE_STOPS } from "../lib/orderedRouteGeometry";
import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebaseAdmin";
import { requireAdmin } from "../middleware/requireAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { decodePolyline } from "../lib/polylineUtils";
import { singleRouteParam } from "../lib/requestParams";
import { routeGeometrySignature } from "../lib/routeGeometrySignature";
import {
  decideRouteSaveOperation,
  routeDocumentVersion,
  routeGeometryVersion,
  routeSavePayloadHash,
} from "../lib/routeSaveContract";
import { invalidateTelemetryRoute } from "../services/telemetryRouteService";
import { invalidatePlanRoute } from "./plan";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/;
const ROUTE_TYPES = new Set(["up", "down", "circular"]);
const STORED_POLYLINE_QUALITY = "HIGH_QUALITY";
const ROUTE_SAVE_LEASE_MS = 30_000;
const SAFE_OPERATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
interface DirectionalRouteGeometry {
  polyline: string;
  forwardPolyline: string;
  reversePolyline: string;
  distanceMeters: number;
  forwardDistanceMeters: number;
  reverseDistanceMeters: number;
  duration: string;
  forwardDuration: string;
  reverseDuration: string;
  polylineQuality: typeof STORED_POLYLINE_QUALITY;
}
const geometryComputations = new Map<
  string,
  Promise<DirectionalRouteGeometry>
>();

interface LatLng {
  lat: number;
  lng: number;
}

interface ValidatedStop extends LatLng {
  id: string;
  name: string;
  shortName: string;
}

interface RouteErrorPayload {
  error: string;
  code: string;
  phase: "validation" | "routing" | "persistence";
  outcomeUnknown?: boolean;
  currentVersion?: number;
}

class RouteApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: RouteErrorPayload,
  ) {
    super(payload.error);
  }
}

function sendRouteError(res: Response, error: RouteApiError): void {
  res.status(error.status).json(error.payload);
}

function routeError(
  status: number,
  code: string,
  phase: RouteErrorPayload["phase"],
  error: string,
  extra: Pick<RouteErrorPayload, "outcomeUnknown" | "currentVersion"> = {},
): RouteApiError {
  return new RouteApiError(status, { error, code, phase, ...extra });
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
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_ROUTE_STOPS) return null;
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

function validateWaypoints(value: unknown): LatLng[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > MAX_ROUTE_STOPS ||
    value.some((waypoint) => !isValidLatLng(waypoint))
  ) {
    return null;
  }
  return value.map((waypoint) => ({
    lat: (waypoint as LatLng).lat,
    lng: (waypoint as LatLng).lng,
  }));
}

function routeWaypoints(route: Record<string, unknown>): LatLng[] | null {
  const stops = validateStops(route.stops);
  if (stops) return stops.map(({ lat, lng }) => ({ lat, lng }));
  return validateWaypoints(route.waypoints);
}

function validEncodedPolyline(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500_000) {
    return false;
  }
  try {
    return decodePolyline(value).length >= 2;
  } catch {
    return false;
  }
}

async function computePolyline(waypoints: LatLng[]) {
  const geometry = await computeOrderedRouteGeometry(waypoints, computePolylineChunk);
  return { ...geometry, polylineQuality: STORED_POLYLINE_QUALITY };
}

async function computePolylineChunk(waypoints: LatLng[]) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw routeError(
      503,
      "ROUTING_NOT_CONFIGURED",
      "routing",
      "Route calculation is not configured on the server.",
    );
  }

  const origin = waypoints[0];
  const destination = waypoints[waypoints.length - 1];
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: "DRIVE",
    // This geometry is computed only when a route is created or edited, then
    // cached in Firestore for every live render. Prefer Google's highest
    // quality traffic-aware road choice without adding per-view API calls.
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    polylineQuality: STORED_POLYLINE_QUALITY,
    polylineEncoding: "ENCODED_POLYLINE",
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
      throw routeError(
        response.status === 429 ? 503 : 502,
        response.status === 429 ? "ROUTING_RATE_LIMITED" : "ROUTING_UPSTREAM_FAILURE",
        "routing",
        response.status === 429
          ? "Route calculation is busy. Wait briefly and retry."
          : "The upstream route service failed.",
      );
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
      throw routeError(
        502,
        "ROUTING_INVALID_RESPONSE",
        "routing",
        "The upstream route service returned invalid geometry.",
      );
    }
    return {
      polyline,
      distanceMeters: route.distanceMeters as number,
      duration: route.duration,
      polylineQuality: STORED_POLYLINE_QUALITY,
    } as const;
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof RouteApiError)) {
      throw routeError(
        504,
        "ROUTING_TIMEOUT",
        "routing",
        "Route calculation took too long. Please retry.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Compute legal road geometry independently for each travel direction. */
async function computeDirectionalPolylines(
  waypoints: LatLng[],
): Promise<DirectionalRouteGeometry> {
  const [forward, reverse] = await Promise.all([
    computePolyline(waypoints),
    computePolyline([...waypoints].reverse()),
  ]);
  return {
    polyline: forward.polyline,
    forwardPolyline: forward.polyline,
    reversePolyline: reverse.polyline,
    distanceMeters: forward.distanceMeters,
    forwardDistanceMeters: forward.distanceMeters,
    reverseDistanceMeters: reverse.distanceMeters,
    duration: forward.duration,
    forwardDuration: forward.duration,
    reverseDuration: reverse.duration,
    polylineQuality: STORED_POLYLINE_QUALITY,
  };
}

function computePolylineOnce(routeId: string, waypoints: LatLng[]) {
  const key = `${routeId}:${JSON.stringify(waypoints)}`;
  const existing = geometryComputations.get(key);
  if (existing) return existing;
  const computation = computeDirectionalPolylines(waypoints).finally(() => {
    if (geometryComputations.get(key) === computation) {
      geometryComputations.delete(key);
    }
  });
  geometryComputations.set(key, computation);
  return computation;
}

function geometryError(res: Response): void {
  sendRouteError(
    res,
    routeError(
      process.env.GOOGLE_MAPS_API_KEY ? 502 : 503,
      process.env.GOOGLE_MAPS_API_KEY
        ? "ROUTING_UPSTREAM_FAILURE"
        : "ROUTING_NOT_CONFIGURED",
      "routing",
      "Unable to compute route geometry.",
    ),
  );
}

function validDistance(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validDuration(value: unknown): value is string {
  return typeof value === "string" && /^\d+(?:\.\d+)?s$/.test(value);
}

function reusableDirectionalGeometry(
  route: Record<string, unknown>,
  signature: string,
): DirectionalRouteGeometry | null {
  if (
    route.geometrySignature !== signature ||
    route.polylineQuality !== STORED_POLYLINE_QUALITY ||
    !validEncodedPolyline(route.forwardPolyline) ||
    !validEncodedPolyline(route.reversePolyline) ||
    !validDistance(route.forwardDistanceMeters) ||
    !validDistance(route.reverseDistanceMeters) ||
    !validDuration(route.forwardDuration) ||
    !validDuration(route.reverseDuration)
  ) return null;

  return {
    polyline: route.forwardPolyline,
    forwardPolyline: route.forwardPolyline,
    reversePolyline: route.reversePolyline,
    distanceMeters: route.forwardDistanceMeters,
    forwardDistanceMeters: route.forwardDistanceMeters,
    reverseDistanceMeters: route.reverseDistanceMeters,
    duration: route.forwardDuration,
    forwardDuration: route.forwardDuration,
    reverseDuration: route.reverseDuration,
    polylineQuality: STORED_POLYLINE_QUALITY,
  };
}

router.post("/compute-polyline", requireAdmin, async (req: Request, res: Response) => {
  const waypoints = req.body?.waypoints;
  if (
    !Array.isArray(waypoints) ||
    waypoints.length < 2 ||
    waypoints.length > MAX_ROUTE_STOPS ||
    waypoints.some((waypoint) => !isValidLatLng(waypoint))
  ) {
    res.status(400).json({ error: "waypoints must contain 2-100 valid coordinates." });
    return;
  }
  try {
    res.json(await computePolyline(waypoints));
  } catch (error) {
    console.error("[Routes] Geometry computation failed:", error);
    if (error instanceof RouteApiError) sendRouteError(res, error);
    else geometryError(res);
  }
});

/**
 * Returns cached road geometry for a saved route, repairing legacy route
 * documents through Routes API when their encoded polyline is absent/invalid.
 * Any signed-in map viewer may read it; callers cannot supply arbitrary
 * billable waypoints because coordinates are loaded from Firestore by ID.
 */
router.get("/:routeId/geometry", requireAuth, async (req: Request, res: Response) => {
  const routeId = singleRouteParam(req.params.routeId);
  if (routeId === null || !SAFE_ID.test(routeId)) {
    res.status(400).json({ error: "Invalid route ID." });
    return;
  }

  try {
    const routeRef = db.collection("routes").doc(routeId);
    const snapshot = await routeRef.get();
    if (!snapshot.exists) {
      res.status(404).json({ error: "Route not found." });
      return;
    }
    const route = snapshot.data() as Record<string, unknown>;
    if (
      route.polylineQuality === STORED_POLYLINE_QUALITY &&
      validEncodedPolyline(route.forwardPolyline) &&
      validEncodedPolyline(route.reversePolyline)
    ) {
      res.json({
        polyline: route.forwardPolyline,
        forwardPolyline: route.forwardPolyline,
        reversePolyline: route.reversePolyline,
        distanceMeters: route.distanceMeters,
        forwardDistanceMeters: route.forwardDistanceMeters,
        reverseDistanceMeters: route.reverseDistanceMeters,
        duration: route.duration,
        forwardDuration: route.forwardDuration,
        reverseDuration: route.reverseDuration,
        polylineQuality: route.polylineQuality,
        configVersion: routeDocumentVersion(route),
        geometryVersion: routeGeometryVersion(route),
        cached: true,
      });
      return;
    }

    const waypoints = routeWaypoints(route);
    if (!waypoints) {
      res.status(422).json({ error: "Route has no valid coordinates." });
      return;
    }
    const expectedVersion = routeDocumentVersion(route);
    const geometrySignature = routeGeometrySignature(waypoints);
    const geometry = await computePolylineOnce(routeId, waypoints);
    const geometryVersion = routeGeometryVersion(route) + 1;
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(routeRef);
      const currentData = current.data() as Record<string, unknown> | undefined;
      const currentWaypoints = currentData ? routeWaypoints(currentData) : null;
      if (
        !current.exists ||
        routeDocumentVersion(currentData) !== expectedVersion ||
        !currentWaypoints ||
        routeGeometrySignature(currentWaypoints) !== geometrySignature
      ) {
        throw routeError(
          409,
          "STALE_ROUTE_VERSION",
          "persistence",
          "The route changed while legacy geometry was being repaired. Retry the request.",
          { currentVersion: routeDocumentVersion(currentData) },
        );
      }
      transaction.set(routeRef, {
        ...geometry,
        geometrySignature,
        geometryVersion,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    invalidatePlanRoute(routeId);
    invalidateTelemetryRoute(routeId);
    res.json({
      ...geometry,
      configVersion: expectedVersion,
      geometryVersion,
      cached: false,
    });
  } catch (error) {
    console.error("[Routes] Failed to load route geometry:", error);
    if (error instanceof RouteApiError) sendRouteError(res, error);
    else geometryError(res);
  }
});

/** Reconcile a save whose browser request ended before its outcome was known. */
router.get(
  "/:routeId/save-operations/:saveId",
  requireAdmin,
  async (req: Request, res: Response) => {
    const routeId = singleRouteParam(req.params.routeId);
    const saveId = singleRouteParam(req.params.saveId);
    if (
      routeId === null ||
      saveId === null ||
      !SAFE_ID.test(routeId) ||
      !SAFE_OPERATION_ID.test(saveId)
    ) {
      sendRouteError(
        res,
        routeError(400, "INVALID_SAVE_OPERATION", "validation", "Invalid save operation."),
      );
      return;
    }
    try {
      const snapshot = await db.collection("_route_save_operations").doc(saveId).get();
      const operation = snapshot.data() as Record<string, unknown> | undefined;
      if (!snapshot.exists || operation?.routeId !== routeId) {
        sendRouteError(
          res,
          routeError(404, "SAVE_OPERATION_NOT_FOUND", "validation", "Save operation not found."),
        );
        return;
      }
      if (operation.status === "succeeded") {
        res.json(operation.result);
        return;
      }
      if (operation.status === "failed") {
        res.status(Number(operation.httpStatus) || 409).json(operation.error);
        return;
      }
      res.status(202).json({ status: "processing", saveId, retryAfterMs: 1_000 });
    } catch (error) {
      console.error("[Routes] Failed to reconcile route save:", error);
      sendRouteError(
        res,
        routeError(
          503,
          "ROUTE_RECONCILIATION_FAILED",
          "persistence",
          "The save outcome could not be checked. Retry with the same operation.",
          { outcomeUnknown: true },
        ),
      );
    }
  },
);

router.put("/:routeId", requireAdmin, async (req: Request, res: Response) => {
  const routeId = singleRouteParam(req.params.routeId);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const color = typeof req.body?.color === "string" ? req.body.color : "";
  const type = req.body?.type;
  const mode = req.body?.mode;
  const saveId = typeof req.body?.saveId === "string" ? req.body.saveId : "";
  const expectedVersion = req.body?.expectedVersion;
  const stops = validateStops(req.body?.stops);
  if (
    routeId === null ||
    !SAFE_ID.test(routeId) ||
    !name ||
    name.length > 100 ||
    !SAFE_COLOR.test(color) ||
    !ROUTE_TYPES.has(type) ||
    (mode !== "create" && mode !== "edit") ||
    !SAFE_OPERATION_ID.test(saveId) ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    (mode === "create" && expectedVersion !== 0) ||
    !stops
  ) {
    sendRouteError(
      res,
      routeError(
        400,
        "INVALID_ROUTE_DATA",
        "validation",
        "Invalid route data, operation ID, or expected version.",
      ),
    );
    return;
  }

  const operationRef = db.collection("_route_save_operations").doc(saveId);
  const routeRef = db.collection("routes").doc(routeId);
  const activeRidesQuery = db.collection("active_rides")
    .where("routeId", "==", routeId)
    .limit(1);
  const payloadHash = routeSavePayloadHash({
    routeId,
    mode,
    expectedVersion,
    name,
    color,
    type,
    stops,
  });
  const leaseOwner = randomBytes(16).toString("hex");
  let claimed = false;

  const recordFailure = async (failure: RouteApiError) => {
    try {
      await db.runTransaction(async (transaction) => {
        const operation = await transaction.get(operationRef);
        const data = operation.data() as Record<string, unknown> | undefined;
        if (
          data?.status !== "processing" ||
          data?.leaseOwner !== leaseOwner ||
          data?.payloadHash !== payloadHash
        ) return;
        transaction.set(operationRef, {
          status: "failed",
          error: failure.payload,
          httpStatus: failure.status,
          completedAt: FieldValue.serverTimestamp(),
          leaseUntil: 0,
        }, { merge: true });
      });
    } catch (recordError) {
      console.error("[Routes] Failed to persist route-save failure:", recordError);
    }
  };

  try {
    const claim = await db.runTransaction(async (transaction) => {
      const [operation, route, activeRides] = await Promise.all([
        transaction.get(operationRef),
        transaction.get(routeRef),
        transaction.get(activeRidesQuery),
      ]);
      const operationData = operation.data() as Record<string, unknown> | undefined;
      const decision = decideRouteSaveOperation(operationData, payloadHash, Date.now());
      if (decision.kind !== "claim") return decision;

      if (mode === "create" && route.exists) return { kind: "already-exists" } as const;
      if (mode === "edit" && !route.exists) return { kind: "not-found" } as const;
      const currentVersion = routeDocumentVersion(
        route.data() as Record<string, unknown> | undefined,
      );
      if (currentVersion !== expectedVersion) {
        return { kind: "stale", currentVersion } as const;
      }
      if (mode === "edit" && !activeRides.empty) return { kind: "active-ride" } as const;

      transaction.set(operationRef, {
        routeId,
        payloadHash,
        status: "processing",
        leaseOwner,
        leaseUntil: Date.now() + ROUTE_SAVE_LEASE_MS,
        attemptCount: Number(operationData?.attemptCount ?? 0) + 1,
        createdAt: operation.exists
          ? operationData?.createdAt ?? FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        kind: "claimed",
        existingRoute: route.data() as Record<string, unknown> | undefined,
      } as const;
    });

    if (claim.kind === "conflict") {
      throw routeError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "validation",
        "This save operation ID is already bound to different route content.",
      );
    }
    if (claim.kind === "processing") {
      res.status(202).json({
        status: "processing",
        saveId,
        retryAfterMs: 1_000,
      });
      return;
    }
    if (claim.kind === "replay") {
      res.json(claim.result);
      return;
    }
    if (claim.kind === "failed") {
      const failure = claim.error as RouteErrorPayload | undefined;
      throw new RouteApiError(
        claim.httpStatus,
        failure?.code && failure.error && failure.phase
          ? failure
          : {
              error: "The previous save attempt failed. Start a new save operation.",
              code: "ROUTE_SAVE_FAILED",
              phase: "persistence",
            },
      );
    }
    if (claim.kind === "already-exists") {
      throw routeError(409, "ROUTE_ALREADY_EXISTS", "validation", "A route with this ID already exists.");
    }
    if (claim.kind === "not-found") {
      throw routeError(404, "ROUTE_NOT_FOUND", "validation", "The route no longer exists.");
    }
    if (claim.kind === "stale") {
      throw routeError(
        409,
        "STALE_ROUTE_VERSION",
        "validation",
        "The route changed after this editor was opened. Reload before saving.",
        { currentVersion: claim.currentVersion },
      );
    }
    if (claim.kind === "active-ride") {
      throw routeError(
        409,
        "ACTIVE_RIDE_ROUTE_EDIT",
        "validation",
        "An active ride route cannot be edited before its final stop.",
      );
    }

    claimed = true;
    const waypoints = stops.map(({ lat, lng }) => ({ lat, lng }));
    const geometrySignature = routeGeometrySignature(waypoints);
    const reusedGeometry = claim.existingRoute
      ? reusableDirectionalGeometry(claim.existingRoute, geometrySignature)
      : null;
    const geometry = reusedGeometry ?? await computeDirectionalPolylines(waypoints);
    const nextConfigVersion = expectedVersion + 1;
    const nextGeometryVersion = reusedGeometry
      ? routeGeometryVersion(claim.existingRoute)
      : routeGeometryVersion(claim.existingRoute) + 1;
    const routeData = {
      id: routeId,
      name,
      color,
      type,
      stops,
      waypoints,
      ...geometry,
      geometrySignature,
      configVersion: nextConfigVersion,
      geometryVersion: nextGeometryVersion,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const result = {
      saved: true,
      status: "succeeded",
      saveId,
      routeId,
      configVersion: nextConfigVersion,
      geometryVersion: nextGeometryVersion,
      geometryReused: Boolean(reusedGeometry),
      ...geometry,
    };

    await db.runTransaction(async (transaction) => {
      const [operation, route, activeRides] = await Promise.all([
        transaction.get(operationRef),
        transaction.get(routeRef),
        transaction.get(activeRidesQuery),
      ]);
      const operationData = operation.data() as Record<string, unknown> | undefined;
      if (
        operationData?.status !== "processing" ||
        operationData?.leaseOwner !== leaseOwner ||
        operationData?.payloadHash !== payloadHash
      ) {
        throw routeError(
          409,
          "ROUTE_SAVE_LEASE_LOST",
          "persistence",
          "The save lease expired before commit. Retry to reconcile the final state.",
          { outcomeUnknown: true },
        );
      }
      if (
        (mode === "create" && route.exists) ||
        (mode === "edit" && !route.exists) ||
        routeDocumentVersion(route.data() as Record<string, unknown> | undefined) !== expectedVersion
      ) {
        throw routeError(
          409,
          "STALE_ROUTE_VERSION",
          "persistence",
          "The route changed while geometry was being calculated. Reload before saving.",
          {
            currentVersion: routeDocumentVersion(
              route.data() as Record<string, unknown> | undefined,
            ),
          },
        );
      }
      if (mode === "edit" && !activeRides.empty) {
        throw routeError(
          409,
          "ACTIVE_RIDE_ROUTE_EDIT",
          "persistence",
          "A ride started while this route was being saved; the route was not changed.",
        );
      }
      if (mode === "create") transaction.create(routeRef, routeData);
      else transaction.set(routeRef, routeData);
      transaction.set(operationRef, {
        status: "succeeded",
        result,
        completedAt: FieldValue.serverTimestamp(),
        leaseUntil: 0,
      }, { merge: true });
    });
    invalidatePlanRoute(routeId);
    invalidateTelemetryRoute(routeId);
    res.json(result);
  } catch (error) {
    console.error("[Routes] Failed to save validated route:", error);
    const failure = error instanceof RouteApiError
      ? error
      : routeError(
          503,
          "ROUTE_PERSISTENCE_FAILED",
          "persistence",
          "The route save could not be confirmed. Retry with the same operation.",
          { outcomeUnknown: true },
        );
    if (claimed) await recordFailure(failure);
    sendRouteError(res, failure);
  }
});

router.delete("/:routeId", requireAdmin, async (req: Request, res: Response) => {
  const routeId = singleRouteParam(req.params.routeId);
  if (routeId === null || !SAFE_ID.test(routeId)) {
    res.status(400).json({ error: "Invalid route ID." });
    return;
  }
  try {
    const routeRef = db.collection("routes").doc(routeId);
    const modernAssignmentsQuery = db.collection("buses")
      .where("assignedRoutes", "array-contains", routeId).limit(1);
    const legacyAssignmentsQuery = db.collection("buses")
      .where("assignedRouteId", "==", routeId).limit(1);
    const activeRidesQuery = db.collection("active_rides")
      .where("routeId", "==", routeId).limit(1);
    const devicesQuery = db.collection("devices")
      .where("routeId", "==", routeId).limit(1);
    const outcome = await db.runTransaction(async (transaction) => {
      const [route, modernAssignments, legacyAssignments, activeRides, devices] =
        await Promise.all([
          transaction.get(routeRef),
          transaction.get(modernAssignmentsQuery),
          transaction.get(legacyAssignmentsQuery),
          transaction.get(activeRidesQuery),
          transaction.get(devicesQuery),
        ]);
      if (!route.exists) return "not-found" as const;
      if (
        !modernAssignments.empty ||
        !legacyAssignments.empty ||
        !activeRides.empty ||
        !devices.empty
      ) return "bound" as const;
      transaction.delete(routeRef);
      return "deleted" as const;
    });
    if (outcome === "not-found") {
      sendRouteError(
        res,
        routeError(404, "ROUTE_NOT_FOUND", "validation", "The route no longer exists."),
      );
      return;
    }
    if (outcome === "bound") {
      res.status(409).json({
        error: "Unassign this route from every vehicle and device before deleting it.",
        code: "ROUTE_IN_USE",
        phase: "validation",
      });
      return;
    }
    invalidatePlanRoute(routeId);
    invalidateTelemetryRoute(routeId);
    res.json({ deleted: true });
  } catch (error) {
    console.error("[Routes] Failed to delete route:", error);
    sendRouteError(
      res,
      routeError(
        503,
        "ROUTE_DELETE_FAILED",
        "persistence",
        "Unable to confirm route deletion. Retry after refreshing.",
        { outcomeUnknown: true },
      ),
    );
  }
});

export default router;
