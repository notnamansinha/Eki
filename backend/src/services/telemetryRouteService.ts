import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, rtdb } from "../lib/firebaseAdmin";
import {
  computeRouteGeometry,
  LIVE_REROUTE_TIMEOUT_MS,
} from "../lib/googleMaps";
import {
  decodePolyline,
  type LatLng,
} from "../lib/polylineUtils";
import {
  isRideDirection,
  normalizeRideDirection,
  type RideDirection,
  stopsInRideDirection,
} from "../lib/rideDirection";
import { inferRideDirectionFromTelemetry } from "../lib/automaticRideDirection";
import { recordBackgroundFailure } from "../lib/backgroundFailureTracker";
import { createLatestPendingScheduler } from "../lib/latestPendingScheduler";
import { routeGeometrySignature } from "../lib/routeGeometrySignature";
import { routeDocumentVersion, routeGeometryVersion } from "../lib/routeSaveContract";
import type { DeviceAssignment } from "./deviceTelemetryService";
import type { TelemetryPayload } from "./telemetryPayload";
import {
  evaluateRouteAdherence,
  matchRoutePosition,
  trajectoryHeading,
  type PreviousRouteMatch,
  type RouteAdherenceState,
  type RouteMatch,
} from "./routeMatching";

const ROUTE_CACHE_MS = 5 * 60_000;
const REROUTE_RETRY_MS = 30_000;
const MATCHED_POSITION_CONFIDENCE = 0.45;
const MAX_ENCODED_POLYLINE_LENGTH = 500_000;

interface RouteStop extends LatLng {
  id: string;
}

interface StoredRoute {
  forwardPolyline: string;
  reversePolyline: string;
  forwardCoordinates: LatLng[];
  reverseCoordinates: LatLng[];
  stops: RouteStop[];
  endpointVersion: string;
  geometryVersion: number;
  cacheGeneration: number;
}

interface RouteCacheEntry {
  expiresAt: number;
  value: StoredRoute | null;
}

interface LiveMatchedLocation extends LatLng {
  segmentIndex: number;
  alongRouteDistanceM: number;
  routeVersion: number;
}

const routeCache = new Map<string, RouteCacheEntry>();
const routeLoads = new Map<string, Promise<StoredRoute | null>>();
const routeCacheGenerations = new Map<string, number>();
interface RouteProcessingTask {
  assignment: DeviceAssignment;
  sample: TelemetryPayload;
}

function validLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.lat === "number" &&
    Number.isFinite(candidate.lat) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90 &&
    typeof candidate.lng === "number" &&
    Number.isFinite(candidate.lng) &&
    candidate.lng >= -180 &&
    candidate.lng <= 180
  );
}

function parseStops(value: unknown): RouteStop[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!validLatLng(candidate)) return [];
    const id = (candidate as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0
      ? [{ id, lat: candidate.lat, lng: candidate.lng }]
      : [];
  });
}

function decodeStoredPolyline(value: unknown): { encoded: string; path: LatLng[] } | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ENCODED_POLYLINE_LENGTH
  ) {
    return null;
  }
  try {
    const path = decodePolyline(value);
    return path.length >= 2 ? { encoded: value, path } : null;
  } catch {
    return null;
  }
}

async function loadStoredRouteUncached(
  routeId: string,
  forceFresh = false,
): Promise<StoredRoute | null> {
  const cacheGeneration = routeCacheGenerations.get(routeId) ?? 0;
  const cached = routeCache.get(routeId);
  if (!forceFresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const snapshot = await db.collection("routes").doc(routeId).get();
  const data = snapshot.data() as Record<string, unknown> | undefined;
  let value: StoredRoute | null = null;
  if (snapshot.exists && data) {
    const stops = parseStops(data.stops);
    let forward = decodeStoredPolyline(data.forwardPolyline ?? data.polyline);
    let reverse = decodeStoredPolyline(data.reversePolyline);
    if (stops.length >= 2 && (!forward || !reverse)) {
      const compute = async (orderedStops: readonly RouteStop[]) => {
        const origin = orderedStops[0];
        const destination = orderedStops[orderedStops.length - 1];
        return computeRouteGeometry(
          origin,
          destination,
          orderedStops.slice(1, -1),
        );
      };
      const [forwardRepair, reverseRepair] = await Promise.all([
        forward ? Promise.resolve(null) : compute(stops),
        reverse ? Promise.resolve(null) : compute([...stops].reverse()),
      ]);
      if (forwardRepair) {
        forward = decodeStoredPolyline(forwardRepair.encodedPolyline);
      }
      if (reverseRepair) {
        reverse = decodeStoredPolyline(reverseRepair.encodedPolyline);
      }
      if (
        forward &&
        reverse &&
        telemetryRouteSnapshotIsCurrent(routeId, cacheGeneration)
      ) {
        const repairedForward = forward;
        const repairedReverse = reverse;
        const expectedConfigVersion = routeDocumentVersion(data);
        const expectedSignature = routeGeometrySignature(stops);
        const repaired = await db.runTransaction(async (transaction) => {
          const current = await transaction.get(snapshot.ref);
          const currentData = current.data() as Record<string, unknown> | undefined;
          const currentStops = parseStops(currentData?.stops);
          if (
            !current.exists ||
            routeDocumentVersion(currentData) !== expectedConfigVersion ||
            currentStops.length < 2 ||
            routeGeometrySignature(currentStops) !== expectedSignature
          ) return false;
          transaction.set(snapshot.ref, {
            ...routeRepairSnapshotWrite({
              forward: repairedForward,
              reverse: repairedReverse,
              forwardRepair,
              reverseRepair,
            }),
            geometrySignature: expectedSignature,
            geometryVersion: routeGeometryVersion(currentData) + 1,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          return true;
        });
        if (!repaired) return null;
      }
    }
    if (forward && reverse && stops.length >= 2) {
      value = {
        forwardPolyline: forward.encoded,
        reversePolyline: reverse.encoded,
        forwardCoordinates: forward.path,
        reverseCoordinates: reverse.path,
        stops,
        // Bind pending direction to both the persisted geometry revision and
        // an exact route-shaping signature (legacy documents are revision 0).
        endpointVersion: `${routeGeometryVersion(data)}:${routeGeometrySignature(stops)}`,
        geometryVersion: routeGeometryVersion(data),
        cacheGeneration,
      };
    }
  }
  if ((routeCacheGenerations.get(routeId) ?? 0) === cacheGeneration) {
    routeCache.set(routeId, { value, expiresAt: Date.now() + ROUTE_CACHE_MS });
  }
  return value;
}

async function loadStoredRoute(
  routeId: string,
  forceFresh = false,
): Promise<StoredRoute | null> {
  if (forceFresh) return loadStoredRouteUncached(routeId, true);
  const cached = routeCache.get(routeId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = routeLoads.get(routeId);
  if (pending) return pending;
  const load = loadStoredRouteUncached(routeId).finally(() => {
    if (routeLoads.get(routeId) === load) routeLoads.delete(routeId);
  });
  routeLoads.set(routeId, load);
  return load;
}

/** Invalidate matcher data and make already-running work fail its version guard. */
export function invalidateTelemetryRoute(routeId: string): void {
  routeCacheGenerations.set(routeId, (routeCacheGenerations.get(routeId) ?? 0) + 1);
  routeCache.delete(routeId);
  routeLoads.delete(routeId);
}

export function telemetryRouteSnapshotIsCurrent(
  routeId: string,
  cacheGeneration: number,
): boolean {
  return (routeCacheGenerations.get(routeId) ?? 0) === cacheGeneration;
}

/**
 * Watch route documents on every API replica so edits invalidate local matcher
 * caches even when another replica accepted the admin request.
 */
export function startTelemetryRouteWatcher(): () => void {
  const initialDelayMs = 1_000;
  const maximumDelayMs = 30_000;
  let stopped = false;
  let unsubscribe: (() => void) | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectDelayMs = initialDelayMs;

  const attach = () => {
    if (stopped) return;
    unsubscribe = db.collection("routes").onSnapshot(
      (snapshot) => {
        reconnectDelayMs = initialDelayMs;
        for (const change of snapshot.docChanges()) {
          invalidateTelemetryRoute(change.doc.id);
        }
      },
      (error) => {
        unsubscribe = null;
        console.error("[Routes] Matcher cache watcher failed:", error);
        if (stopped || reconnectTimer) return;
        const retryInMs = reconnectDelayMs;
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, maximumDelayMs);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          attach();
        }, retryInMs);
        reconnectTimer.unref();
      },
    );
  };
  attach();

  return () => {
    stopped = true;
    unsubscribe?.();
    unsubscribe = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };
}

function validRouteState(value: unknown): RouteAdherenceState | undefined {
  return value === "ON_ROUTE" ||
    value === "POSSIBLE_OFF_ROUTE" ||
    value === "OFF_ROUTE" ||
    value === "REROUTING" ||
    value === "ON_NEW_ROUTE"
    ? value
    : undefined;
}

function previousMatch(
  value: unknown,
  routeVersion: number,
): PreviousRouteMatch | null {
  if (!value || typeof value !== "object") return null;
  const match = value as Partial<LiveMatchedLocation>;
  return Number.isInteger(match.segmentIndex) &&
    Number.isFinite(match.alongRouteDistanceM) &&
    match.routeVersion === routeVersion
    ? {
        segmentIndex: Number(match.segmentIndex),
        alongRouteDistanceM: Number(match.alongRouteDistanceM),
      }
    : null;
}

export function telemetryIsCurrent(
  live: Record<string, unknown> | null,
  sample: TelemetryPayload,
): boolean {
  return live?.timestamp === sample.timestamp && live?.seq === sample.seq;
}

export function nextMatchedTelemetryValue(
  current: Record<string, unknown> | null,
  sample: TelemetryPayload,
  matchedUpdate: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return telemetryIsCurrent(current, sample)
    ? { ...current, ...matchedUpdate }
    : undefined;
}

function resolvedDirection(value: unknown): RideDirection | null {
  return isRideDirection(value) ? value : null;
}

/**
 * Only telemetry-resolved, session-bound directions need the one-time
 * Firestore projection repair. Directions created by the shift endpoint are
 * already persisted atomically and therefore have no explicit false marker.
 */
export function directionProjectionNeedsSync(
  live: Record<string, unknown>,
): boolean {
  return live.directionFirestoreSynced === false &&
    typeof live.sessionId === "string" &&
    typeof live.driverId === "string";
}

function directionResolutionIsEligible(
  live: Record<string, unknown>,
  assignment: DeviceAssignment,
): boolean {
  if (
    live.busId !== assignment.busId ||
    live.routeId !== assignment.routeId ||
    live.tripState === "completed" ||
    resolvedDirection(live.direction)
  ) {
    return false;
  }
  // A device-only node is eligible. A session-bound node remains eligible
  // only before departure, so an active ride can never have its direction
  // changed by later endpoint telemetry.
  return typeof live.sessionId !== "string" ||
    (live.status === "active" && live.tripState === "pre_departure");
}

async function persistResolvedSessionDirection(
  assignment: DeviceAssignment,
  live: Record<string, unknown>,
  route: StoredRoute,
  direction: RideDirection,
): Promise<boolean> {
  if (typeof live.sessionId !== "string" || typeof live.driverId !== "string") return false;
  const sessionRef = db.collection("ride_sessions").doc(live.sessionId);
  const lockRef = db.collection("_active_bus_locks").doc(assignment.busId);
  const stops = stopsInRideDirection(route.stops, direction);
  const origin = stops[0];
  const destination = stops.at(-1);
  if (!origin || !destination) return false;

  const persisted = await db.runTransaction(async (transaction) => {
    const [session, lock] = await Promise.all([
      transaction.get(sessionRef),
      transaction.get(lockRef),
    ]);
    const sessionData = session.data();
    const sessionDirection = resolvedDirection(sessionData?.direction);
    if (
      !session.exists ||
      lock.data()?.sessionId !== live.sessionId ||
      sessionData?.busId !== assignment.busId ||
      sessionData?.routeId !== assignment.routeId ||
      sessionData?.driverId !== live.driverId ||
      (sessionData?.status !== "pending" &&
        sessionData?.status !== "armed" &&
        sessionData?.status !== "active") ||
      (sessionDirection && sessionDirection !== direction)
    ) {
      return false;
    }
    const lockData = lock.data();
    const alreadySynchronized =
      sessionDirection === direction &&
      sessionData?.directionState === "resolved" &&
      sessionData?.directionEndpointVersion === route.endpointVersion &&
      sessionData?.originStopId === origin.id &&
      sessionData?.destinationStopId === destination.id &&
      lockData?.direction === direction;
    if (alreadySynchronized) return true;
    transaction.set(sessionRef, {
      direction,
      directionState: "resolved",
      directionEndpointVersion: route.endpointVersion,
      originStopId: origin.id,
      destinationStopId: destination.id,
      ...(sessionData?.directionResolvedAt == null
        ? { directionResolvedAt: FieldValue.serverTimestamp() }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(lockRef, {
      direction,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
  return persisted;
}

async function markDirectionProjectionSynchronized(
  assignment: DeviceAssignment,
  live: Record<string, unknown>,
  route: StoredRoute,
  direction: RideDirection,
): Promise<void> {
  const nodeKey = `${assignment.busId}_${assignment.routeId}`;
  await rtdb.ref(`activeBuses/${nodeKey}`).transaction((current) => {
    const currentLive = current as Record<string, unknown> | null;
    if (
      !currentLive ||
      currentLive.sessionId !== live.sessionId ||
      resolvedDirection(currentLive.direction) !== direction ||
      currentLive.directionEndpointVersion !== route.endpointVersion ||
      currentLive.directionFirestoreSynced !== false
    ) {
      return;
    }
    return { ...currentLive, directionFirestoreSynced: true };
  });
}

async function resolvePendingDirection(
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
  route: StoredRoute,
): Promise<{ live: Record<string, unknown>; direction: RideDirection | null } | null> {
  const nodeKey = `${assignment.busId}_${assignment.routeId}`;
  const now = Date.now();
  const transaction = await rtdb.ref(`activeBuses/${nodeKey}`).transaction((current) => {
    const live = current as Record<string, unknown> | null;
    if (!live || !telemetryIsCurrent(live, sample)) return;
    const existingDirection = resolvedDirection(live.direction);
    if (existingDirection) return;
    if (!directionResolutionIsEligible(live, assignment)) return;
    const direction = inferRideDirectionFromTelemetry(route.stops, {
      now,
      timestamp: Number(live.timestamp),
      motionState: live.motionState,
      gpsHdop: live.gpsHdop,
      position: { lat: Number(live.lat), lng: Number(live.lng) },
    });
    if (!direction) {
      return live.directionState === "pending"
        ? undefined
        : { ...live, direction: null, directionState: "pending" };
    }
    const stops = stopsInRideDirection(route.stops, direction);
    const origin = stops[0];
    const destination = stops.at(-1);
    if (!origin || !destination) return;
    return {
      ...live,
      direction,
      directionState: "resolved",
      directionEndpointVersion: route.endpointVersion,
      originStopId: origin.id,
      destinationStopId: destination.id,
      directionResolvedAt: { ".sv": "timestamp" },
      directionFirestoreSynced:
        typeof live.sessionId !== "string" || typeof live.driverId !== "string",
    };
  });
  const live = transaction.snapshot.val() as Record<string, unknown> | null;
  if (!live || !telemetryIsCurrent(live, sample)) return null;
  return { live, direction: resolvedDirection(live.direction) };
}

function recentTrajectory(value: unknown, current: LatLng, sample: TelemetryPayload) {
  const history = Array.isArray(value)
    ? value.flatMap((candidate) => {
        const record = candidate as Record<string, unknown>;
        if (!validLatLng(candidate)) return [];
        return Number.isSafeInteger(record.seq) && Number.isFinite(record.sampledAt)
          ? [{
              lat: candidate.lat,
              lng: candidate.lng,
              seq: Number(record.seq),
              sampledAt: Number(record.sampledAt),
            }]
          : [];
      })
    : [];
  return [
    ...history.filter((point) => point.sampledAt < sample.timestamp).slice(-3),
    { ...current, seq: sample.seq, sampledAt: sample.timestamp },
  ];
}

function encodedGeometry(
  route: StoredRoute,
  direction: "forward" | "reverse",
): { path: LatLng[]; polyline: string } {
  if (direction === "forward") {
    return {
      path: route.forwardCoordinates,
      polyline: route.forwardPolyline,
    };
  }
  return {
    path: route.reverseCoordinates,
    polyline: route.reversePolyline,
  };
}

const geometryCache = new Map<string, { path: LatLng[]; polyline: string }>();
const GEOMETRY_CACHE_MAX = 50;

/**
 * Resolve the active geometry for the current route version. Reroute geometry
 * lives in a version-keyed sibling node (`activeRouteGeometry`) rather than the
 * high-frequency `activeBuses` child, so clients never receive the full polyline
 * on every accepted fix. It is cached here to avoid re-reading it each second;
 * configured geometry is always derived from the cached route document.
 */
async function loadActiveGeometry(
  nodeKey: string,
  live: Record<string, unknown>,
  route: StoredRoute,
  direction: "forward" | "reverse",
): Promise<{ path: LatLng[]; polyline: string; source: "configured" | "dynamic-reroute" }> {
  if (
    live.routeSource === "dynamic-reroute" &&
    live.routeDirection === direction &&
    Number.isSafeInteger(live.routeVersion) &&
    Number(live.routeVersion) > 0
  ) {
    const version = Number(live.routeVersion);
    const cacheKey = `${nodeKey}:${version}`;
    const cached = geometryCache.get(cacheKey);
    if (cached) return { ...cached, source: "dynamic-reroute" };
    const snapshot = await rtdb.ref(`activeRouteGeometry/${nodeKey}/${version}`).once("value");
    const value = snapshot.val() as { polyline?: unknown } | null;
    if (
      value &&
      typeof value.polyline === "string" &&
      value.polyline.length <= MAX_ENCODED_POLYLINE_LENGTH
    ) {
      try {
        const path = decodePolyline(value.polyline);
        if (path.length >= 2) {
          if (geometryCache.size >= GEOMETRY_CACHE_MAX) {
            const oldestKey = geometryCache.keys().next().value;
            if (oldestKey) geometryCache.delete(oldestKey);
          }
          geometryCache.set(cacheKey, { path, polyline: value.polyline });
          return { path, polyline: value.polyline, source: "dynamic-reroute" };
        }
      } catch {
        // Fall back to the configured route geometry below.
      }
    }
  }
  return { ...encodedGeometry(route, direction), source: "configured" };
}

function matchedLocation(
  match: RouteMatch,
  sample: TelemetryPayload,
  routeVersion: number,
) {
  return {
    lat: match.point.lat,
    lng: match.point.lng,
    segmentIndex: match.segmentIndex,
    segmentFraction: match.segmentFraction,
    alongRouteDistanceM: Math.round(match.alongRouteDistanceM),
    distanceToRouteM: Number(match.distanceToRouteM.toFixed(1)),
    headingDifference: match.headingDifference === null
      ? null
      : Number(match.headingDifference.toFixed(1)),
    matchConfidence: match.matchConfidence,
    seq: sample.seq,
    sampledAt: sample.timestamp,
    routeVersion,
  };
}

export function remainingRerouteStops(
  stops: readonly RouteStop[],
  direction: "forward" | "reverse",
  currentStopIndex: number,
): RouteStop[] {
  const ordered = stopsInRideDirection(stops, direction);
  const safeIndex = Math.max(
    0,
    Math.min(Math.trunc(currentStopIndex), ordered.length - 1),
  );
  // In service, index zero is the origin. A moving off-route bus should route
  // toward the next required stop, not turn back to its completed origin.
  return ordered.slice(safeIndex === 0 && ordered.length > 1 ? 1 : safeIndex);
}

export function rerouteContextIsCurrent(
  live: Record<string, unknown> | null,
  expected: {
    requestId: string;
    routeVersion: number;
    sessionId: string;
    direction: "forward" | "reverse";
  },
): boolean {
  return Boolean(
    live &&
    live.rerouteRequestId === expected.requestId &&
    live.routeVersion === expected.routeVersion &&
    live.sessionId === expected.sessionId &&
    normalizeRideDirection(live.direction) === expected.direction,
  );
}

async function activateReroute(
  nodeKey: string,
  requestId: string,
  expectedVersion: number,
  expectedSessionId: string,
  direction: "forward" | "reverse",
  routeId: string,
  sample: TelemetryPayload,
  geometry: Awaited<ReturnType<typeof computeRouteGeometry>>,
): Promise<void> {
  const path = decodePolyline(geometry.encodedPolyline);
  const match = matchRoutePosition(
    { lat: sample.lat, lng: sample.lng },
    path,
    sample.speed >= 3 ? sample.heading : undefined,
  );
  // Store the full reroute geometry once in a version-keyed sibling node so
  // the live activeBuses child carries only pointer fields and is not
  // rewritten with the encoded polyline on every accepted fix.
  await rtdb.ref(`activeRouteGeometry/${nodeKey}/${expectedVersion + 1}`).set({
    polyline: geometry.encodedPolyline,
    routeId,
    direction,
    source: "dynamic-reroute",
    routeVersion: expectedVersion + 1,
  });
  await rtdb.ref(`activeBuses/${nodeKey}`).transaction((current) => {
    const live = current as Record<string, unknown> | null;
    if (!rerouteContextIsCurrent(live, {
      requestId,
      routeVersion: expectedVersion,
      sessionId: expectedSessionId,
      direction,
    })) {
      return;
    }
    const routeVersion = expectedVersion + 1;
    return {
      ...live,
      activeRouteId: `${routeId}:reroute:${routeVersion}`,
      routeVersion,
      routeSource: "dynamic-reroute",
      routeDirection: direction,
      routeState: "ON_NEW_ROUTE",
      offRouteSampleCount: 0,
      rerouteRequestId: null,
      rerouteCompletedAt: { ".sv": "timestamp" },
      ...(match && telemetryIsCurrent(live, sample)
        ? {
            matchedLocation: matchedLocation(match, sample, routeVersion),
            matchConfidence: match.matchConfidence,
            distanceToActiveRoute: Number(match.distanceToRouteM.toFixed(1)),
          }
        : {
            matchedLocation: null,
            matchConfidence: 0,
            distanceToActiveRoute: null,
          }),
    };
  });
}

async function requestReroute(
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
  route: StoredRoute,
  direction: "forward" | "reverse",
  expectedVersion: number,
): Promise<void> {
  const nodeKey = `${assignment.busId}_${assignment.routeId}`;
  const requestId = `${sample.timestamp}-${sample.seq}-${randomBytes(6).toString("hex")}`;
  const now = Date.now();
  const started = await rtdb.ref(`activeBuses/${nodeKey}`).transaction((current) => {
    const live = current as Record<string, unknown> | null;
    const lastAttemptAt = Number(live?.lastRerouteAttemptAt);
    if (
      !live ||
      live.routeState !== "OFF_ROUTE" ||
      live.routeVersion !== expectedVersion ||
      live.status !== "active" ||
      live.tripState !== "in_service" ||
      (Number.isFinite(lastAttemptAt) && now - lastAttemptAt < REROUTE_RETRY_MS)
    ) {
      return;
    }
    return {
      ...live,
      routeState: "REROUTING",
      rerouteRequestId: requestId,
      lastRerouteAttemptAt: now,
      rerouteError: null,
    };
  });
  if (!started.committed) return;

  const live = started.snapshot.val() as Record<string, unknown>;
  try {
    if (typeof live.sessionId !== "string") {
      throw new Error("Active trip has no rerouting session.");
    }
    const remainingStops = remainingRerouteStops(
      route.stops,
      direction,
      Number.isInteger(live.currentStopIndex) ? Number(live.currentStopIndex) : 0,
    );
    if (remainingStops.length === 0 || remainingStops.length > 26) {
      throw new Error("Active trip has no valid rerouting itinerary.");
    }
    const destination = remainingStops[remainingStops.length - 1];
    const intermediates = remainingStops.slice(0, -1);
    const geometry = await computeRouteGeometry(
      { lat: sample.lat, lng: sample.lng },
      destination,
      intermediates,
      {
        routingPreference: "TRAFFIC_AWARE",
        timeoutMs: LIVE_REROUTE_TIMEOUT_MS,
      },
    );
    if (!telemetryRouteSnapshotIsCurrent(assignment.routeId, route.cacheGeneration)) {
      throw new Error("Route configuration changed while rerouting.");
    }
    await activateReroute(
      nodeKey,
      requestId,
      expectedVersion,
      live.sessionId,
      direction,
      assignment.routeId,
      sample,
      geometry,
    );
  } catch (error) {
    await rtdb.ref(`activeBuses/${nodeKey}`).transaction((current) => {
      const currentLive = current as Record<string, unknown> | null;
      if (!rerouteContextIsCurrent(currentLive, {
        requestId,
        routeVersion: expectedVersion,
        sessionId: live.sessionId as string,
        direction,
      })) return;
      return {
        ...currentLive,
        routeState: "OFF_ROUTE",
        rerouteRequestId: null,
        rerouteError: "Route calculation failed; retrying with live telemetry.",
        rerouteFailedAt: { ".sv": "timestamp" },
      };
    });
    throw error;
  }
}

async function processTelemetryRoute(
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
): Promise<void> {
  const nodeKey = `${assignment.busId}_${assignment.routeId}`;
  const snapshot = await rtdb.ref(`activeBuses/${nodeKey}`).once("value");
  const initialLive = snapshot.val() as Record<string, unknown> | null;
  if (!telemetryIsCurrent(initialLive, sample)) return;
  if (initialLive?.tripState === "completed") return;
  // Direction is bound to admin-managed endpoints, so a pending node must not
  // use a cached route snapshot while an administrator can still edit it.
  const route = await loadStoredRoute(
    assignment.routeId,
    !resolvedDirection(initialLive?.direction),
  );
  if (
    !route ||
    !telemetryRouteSnapshotIsCurrent(assignment.routeId, route.cacheGeneration)
  ) return;

  const resolution = await resolvePendingDirection(assignment, sample, route);
  if (!resolution?.direction) return;
  const { direction, live } = resolution;
  if (directionProjectionNeedsSync(live)) {
    const synchronized = await persistResolvedSessionDirection(
      assignment,
      live,
      route,
      direction,
    );
    if (!synchronized) return;
    await markDirectionProjectionSynchronized(assignment, live, route, direction);
  }

  const routeSessionId =
    typeof live?.sessionId === "string" ? live.sessionId : "device-only";
  const contextChanged =
    live?.routeDirection !== direction ||
    live?.routeSessionId !== routeSessionId ||
    live?.routeGeometryVersion !== route.geometryVersion;
  const previousVersion = Number(live?.routeVersion);
  const routeVersion = Number.isSafeInteger(previousVersion) && previousVersion > 0
    ? previousVersion + (contextChanged ? 1 : 0)
    : 1;
  const geometry = contextChanged
    ? { ...encodedGeometry(route, direction), source: "configured" as const }
    : await loadActiveGeometry(nodeKey, live as Record<string, unknown>, route, direction);
  const prior = contextChanged
    ? null
    : previousMatch(live?.matchedLocation, routeVersion);
  const acceptedPoint = {
    lat: Number(live?.lat),
    lng: Number(live?.lng),
  };
  if (!validLatLng(acceptedPoint)) return;
  const acceptedSample: TelemetryPayload = {
    ...sample,
    lat: acceptedPoint.lat,
    lng: acceptedPoint.lng,
    speed: Number.isFinite(Number(live?.speed)) ? Number(live?.speed) : sample.speed,
    heading: Number.isFinite(Number(live?.heading)) ? Number(live?.heading) : sample.heading,
    motionState:
      live?.motionState === "moving" ||
      live?.motionState === "stopped" ||
      live?.motionState === "uncertain"
        ? live.motionState
        : sample.motionState,
  };
  const trajectory = recentTrajectory(
    live?.routeMatchHistory,
    acceptedPoint,
    acceptedSample,
  );
  const effectiveHeading = trajectoryHeading(trajectory) ?? acceptedSample.heading;
  const match = matchRoutePosition(
    acceptedPoint,
    geometry.path,
    acceptedSample.speed >= 3 && acceptedSample.motionState === "moving"
      ? effectiveHeading
      : undefined,
    prior,
  );
  const adherence = evaluateRouteAdherence(
    contextChanged ? undefined : validRouteState(live?.routeState),
    contextChanged || !Number.isInteger(live?.offRouteSampleCount)
      ? 0
      : Number(live?.offRouteSampleCount),
    match,
    isReliableMovingSample(acceptedSample),
  );

  const transaction = await rtdb.ref(`activeBuses/${nodeKey}`).transaction((current) => {
    const currentLive = current as Record<string, unknown> | null;
    if (!telemetryRouteSnapshotIsCurrent(assignment.routeId, route.cacheGeneration)) {
      return;
    }
    return nextMatchedTelemetryValue(currentLive, sample, {
      activeRouteId:
        geometry.source === "configured"
          ? `${assignment.routeId}:configured:${direction}`
          : typeof currentLive?.activeRouteId === "string"
            ? currentLive.activeRouteId
            : `${assignment.routeId}:reroute:${routeVersion}`,
      routeVersion,
      routeSource: geometry.source,
      routeDirection: direction,
      routeSessionId,
      routeGeometryVersion: route.geometryVersion,
      routeState: adherence.routeState,
      ...(contextChanged
        ? { rerouteRequestId: null, rerouteError: null }
        : {}),
      routeMatchHistory: trajectory,
      offRouteSampleCount: adherence.offRouteSampleCount,
      mapMatchUpdatedAt: { ".sv": "timestamp" },
      matchConfidence: match?.matchConfidence ?? 0,
      distanceToActiveRoute:
        match ? Number(match.distanceToRouteM.toFixed(1)) : null,
      matchedLocation:
        match && match.matchConfidence >= MATCHED_POSITION_CONFIDENCE
          ? matchedLocation(match, acceptedSample, routeVersion)
          : null,
    });
  });

  const committed = transaction.snapshot.val() as Record<string, unknown> | null;
  if (
    transaction.committed &&
    adherence.shouldReroute &&
    committed?.status === "active" &&
    committed?.tripState === "in_service"
  ) {
    await requestReroute(
      assignment,
      acceptedSample,
      route,
      direction,
      routeVersion,
    );
  }
}

interface RouteRepairGeometry {
  distanceMeters: number;
  duration: string;
}

/**
 * Write payload for a stored-route geometry snapshot. Legacy geometry is
 * preserved as-is, but the HIGH_QUALITY marker and required distance/duration
 * fields are only stamped when BOTH directions were freshly computed. A
 * forward value that merely decodes legacy data keeps its geometry but never
 * claims cache quality or fabricates metrics.
 */
export function routeRepairSnapshotWrite(params: {
  forward: { encoded: string };
  reverse: { encoded: string };
  forwardRepair: RouteRepairGeometry | null;
  reverseRepair: RouteRepairGeometry | null;
}): Record<string, unknown> {
  return {
    polyline: params.forward.encoded,
    forwardPolyline: params.forward.encoded,
    reversePolyline: params.reverse.encoded,
    ...(params.forwardRepair && params.reverseRepair
      ? { polylineQuality: "HIGH_QUALITY" }
      : {}),
    ...(params.forwardRepair
      ? {
          distanceMeters: params.forwardRepair.distanceMeters,
          forwardDistanceMeters: params.forwardRepair.distanceMeters,
          duration: params.forwardRepair.duration,
          forwardDuration: params.forwardRepair.duration,
        }
      : {}),
    ...(params.reverseRepair
      ? {
          reverseDistanceMeters: params.reverseRepair.distanceMeters,
          reverseDuration: params.reverseRepair.duration,
        }
      : {}),
  };
}

/**
 * A fix may confirm deviation only when it carries a valid HDOP. Compatibility
 * schemas that map to gpsHdop null must never count a moving sample as
 * reliable — a verifiable fix quality gate is required before rerouting.
 */
export function isReliableMovingSample(acceptedSample: TelemetryPayload): boolean {
  return (
    acceptedSample.motionState === "moving" &&
    acceptedSample.speed >= 3 &&
    typeof acceptedSample.gpsHdop === "number" &&
    acceptedSample.gpsHdop >= 0 &&
    acceptedSample.gpsHdop <= 4
  );
}

const routeProcessingScheduler = createLatestPendingScheduler<
  string,
  RouteProcessingTask
>(
  async (_nodeKey, task) => {
    await processTelemetryRoute(task.assignment, task.sample);
  },
  (nodeKey, error) => {
    recordBackgroundFailure(
      "devices.routeMatching",
      "Telemetry route matching",
      `[Routes] Matching/rerouting failed for ${nodeKey}:`,
      error,
    );
  },
);

/**
 * Keep at most one in-flight and one latest-pending matcher task per live node.
 * Telemetry ingestion and lifecycle listeners remain outside this coalescing
 * queue, so departure/completion transitions are not discarded.
 */
export function scheduleTelemetryRouteProcessing(
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
): void {
  routeProcessingScheduler.schedule(
    `${assignment.busId}_${assignment.routeId}`,
    { assignment, sample },
  );
}

/** Operational counters exposed through the authenticated health endpoint. */
export function getRouteProcessingStatus() {
  return routeProcessingScheduler.snapshot();
}
