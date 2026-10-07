import { createHash } from "node:crypto";
import { endpointSnapshotVersion } from "../lib/endpointSnapshotVersion";
import { Router, type Request, type Response, type NextFunction } from "express";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";
import { db, rtdb } from "../lib/firebaseAdmin";
import { inferRideDirectionFromTelemetry } from "../lib/automaticRideDirection";
import { withoutLiveRouteContext } from "../lib/liveRouteContext";
import { singleRouteParam } from "../lib/requestParams";
import {
  isRideDirection,
  stopsInRideDirection,
} from "../lib/rideDirection";
import {
  deleteTerminalRideHistory,
  RideHistoryConflictError,
} from "../services/rideHistoryDeletion";

const router = Router();
export const rideSessionsRouter = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

class SessionCreationConflict extends Error {}

type SessionProjection = { ref: DocumentReference; data: Record<string, unknown>; merge?: boolean };

// Protect terminal transitions and newer telemetry/delay projections when a
// creation retry races another writer. All reads precede transaction writes.
async function commitCreationProjections(writes: SessionProjection[]) {
  await db.runTransaction(async transaction => {
    const session = await transaction.get(writes[0].ref);
    const stored = session.data();
    if (!session.exists || ["completed", "interrupted", "failed"].includes(stored?.status)) {
      throw new SessionCreationConflict("Session ended while starting; retry the same key.");
    }
    const live = (await rtdb.ref(`activeBuses/${stored!.busId}_${stored!.routeId}`).once("value"))
      .val() as Record<string, unknown> | null;
    if (live?.sessionId !== writes[0].ref.id || live.status !== "active" || live.tripState === "completed") {
      throw new SessionCreationConflict("Live session changed while starting; retry the same key.");
    }
    const active = writes[1] ? await transaction.get(writes[1].ref) : null;
    const activeData = active?.data();
    if (active?.exists && activeData?.sessionId !== writes[0].ref.id) {
      throw new SessionCreationConflict("A different session owns the live projection.");
    }
    const sessionData = { ...writes[0].data };
    if (stored?.status === "active") sessionData.status = "active";
    if (stored?.status === "armed" && sessionData.status === "pending") sessionData.status = "armed";
    if (isRideDirection(stored?.direction)) {
      for (const field of ["direction", "directionState", "directionEndpointVersion", "originStopId", "destinationStopId"]) {
        if (stored[field] !== undefined) sessionData[field] = stored[field];
      }
    }
    for (const field of ["startTime", "activatedAt", "stopsReached"]) {
      if (stored?.[field] !== undefined &&
          (field !== "stopsReached" || Object.keys(stored[field] ?? {}).length > 0)) {
        sessionData[field] = stored[field];
      }
    }
    transaction.set(writes[0].ref, sessionData, { merge: true });
    if (writes[1]) {
      const data = { ...writes[1].data };
      if (activeData && normalizedDelayRevision(activeData.delayUpdatedAt) > normalizedDelayRevision(data.delayUpdatedAt)) {
        data.delayMinutes = activeData.delayMinutes;
        data.delayUpdatedAt = activeData.delayUpdatedAt;
      }
      if (normalizedDelayRevision(live.delayUpdatedAt) > normalizedDelayRevision(data.delayUpdatedAt)) {
        data.delayMinutes = normalizedDelayMinutes(live.delayMinutes);
        data.delayUpdatedAt = normalizedDelayRevision(live.delayUpdatedAt);
      }
      if (activeData?.tripState === "in_service") data.tripState = "in_service";
      if (Number.isInteger(activeData?.currentStopIndex) && Number(activeData?.currentStopIndex) > Number(data.currentStopIndex)) {
        data.currentStopIndex = activeData?.currentStopIndex;
      }
      if (activeData?.hasDepartedOrigin === true) data.hasDepartedOrigin = true;
      transaction.set(writes[1].ref, data, { merge: true });
    }
  });
}

function activeRideId(busId: string, routeId: string): string {
  return `${busId}_${routeId}`;
}

function normalizedDelayRevision(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : 0;
}

function normalizedDelayMinutes(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1440
    ? Number(value)
    : 0;
}

function activeBusLockRef(busId: string) {
  return db.collection("_active_bus_locks").doc(busId);
}

async function releaseActiveBusLock(busId: string, sessionId: string): Promise<void> {
  const lockRef = activeBusLockRef(busId);
  await db.runTransaction(async (transaction) => {
    const lock = await transaction.get(lockRef);
    if (lock.data()?.sessionId === sessionId) transaction.delete(lockRef);
  });
}

function retireRideLifecycle(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const retired = withoutLiveRouteContext(value);
  for (const field of [
    "sessionId",
    "driverId",
    "direction",
    "directionState",
    "directionEndpointVersion",
    "directionFirestoreSynced",
    "originStopId",
    "destinationStopId",
    "tripState",
    "currentStopIndex",
    "hasDepartedOrigin",
    "delayMinutes",
    "delayUpdatedAt",
    "automaticTurnaround",
    "previousSessionId",
    "completedAt",
    "turnaroundEligibleAt",
    "turnaroundSampledAt",
    "turnaroundClaimId",
    "turnaroundClaimedAt",
    "passengers",
    "stopsReached",
  ]) {
    delete retired[field];
  }
  return {
    ...retired,
    status: "offline",
    lifecycleUpdatedAt: { ".sv": "timestamp" },
  };
}

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    admin?: boolean;
    driverId?: string;
    assignedBusId?: string;
  };
};

type Assignment = { driverId: string; busId: string; routeId: string };
const requestAssignments = new WeakMap<Request, Map<string, Promise<Assignment | null>>>();
async function authorizeOperator(req: AuthenticatedRequest, busId: unknown, routeId: unknown, requestedDriverId: unknown) {
  // Only reuse checks inside this request. Each later request reads current
  // assignment documents; reassignment/revocation never waits for a TTL.
  const key = JSON.stringify([req.user, busId, routeId, requestedDriverId]);
  let checks = requestAssignments.get(req);
  if (!checks) { checks = new Map(); requestAssignments.set(req, checks); }
  const existing = checks.get(key); if (existing) return existing;
  const check = readOperatorAssignment(req, busId, routeId, requestedDriverId);
  checks.set(key, check); return check;
}

async function readOperatorAssignment(
  req: AuthenticatedRequest,
  busId: unknown,
  routeId: unknown,
  requestedDriverId: unknown,
) {
  const user = req.user;
  const isAdmin = user?.role === "admin" || user?.admin === true;
  const driverId = isAdmin ? requestedDriverId : user?.driverId;
  if (
    (!isAdmin && user?.role !== "driver") ||
    typeof driverId !== "string" ||
    !SAFE_ID.test(driverId) ||
    typeof busId !== "string" ||
    typeof routeId !== "string" ||
    !SAFE_ID.test(busId) ||
    !SAFE_ID.test(routeId) ||
    (!isAdmin && (
      typeof user?.assignedBusId !== "string" ||
      busId !== user.assignedBusId
    ))
  ) {
    return null;
  }

  const [driverDoc, busDoc] = await Promise.all([
    db.collection("drivers").doc(driverId).get(),
    db.collection("buses").doc(busId).get(),
  ]);
  const driver = driverDoc.data();
  const bus = busDoc.data();
  const assignedRoutes = Array.isArray(bus?.assignedRoutes)
    ? bus.assignedRoutes
    : typeof bus?.assignedRouteId === "string"
      ? [bus.assignedRouteId]
      : [];

  if (
    !driverDoc.exists ||
    (!isAdmin && driver?.authUid !== user?.uid) ||
    driver?.assignedBusId !== busId ||
    !busDoc.exists ||
    !assignedRoutes.includes(routeId)
  ) {
    return null;
  }
  return { driverId, busId, routeId };
}

async function updateDelay(req: AuthenticatedRequest, res: Response) {
  try {
    const assignment = await authorizeOperator(
      req,
      req.body?.busId,
      req.body?.routeId,
      req.body?.driverId,
    );
    const delayMinutes = req.body?.delayMinutes;
    if (
      !assignment ||
      !Number.isSafeInteger(delayMinutes) ||
      delayMinutes < 0 ||
      delayMinutes > 1440
    ) {
      res.status(400).json({ error: "Invalid delay update." });
      return;
    }
    const nodeRef = rtdb.ref(`activeBuses/${assignment.busId}_${assignment.routeId}`);
    const requestedAt = Date.now();
    const liveUpdate = await nodeRef.transaction((value) => {
      const current = value as Record<string, unknown> | null;
      if (
        !current ||
        current.busId !== assignment.busId ||
        current.routeId !== assignment.routeId ||
        current.driverId !== assignment.driverId ||
        current.status !== "active" ||
        (current.tripState !== "pre_departure" && current.tripState !== "in_service") ||
        typeof current.sessionId !== "string" ||
        !SAFE_ID.test(current.sessionId) ||
        (res.locals.expectedSessionId && current.sessionId !== res.locals.expectedSessionId)
      ) {
        return;
      }
      const previousRevision =
        Number.isSafeInteger(current.delayUpdatedAt) &&
        Number(current.delayUpdatedAt) >= 0 &&
        Number(current.delayUpdatedAt) < Number.MAX_SAFE_INTEGER
          ? Number(current.delayUpdatedAt)
          : 0;
      return {
        ...current,
        delayMinutes,
        // RTDB transactions retry on contention. Advancing from the live
        // revision makes ordering monotonic even if backend clocks differ.
        delayUpdatedAt: Math.max(requestedAt, previousRevision + 1),
      };
    });
    const committed = liveUpdate.snapshot.val() as Record<string, unknown> | null;
    if (
      !liveUpdate.committed ||
      !committed ||
      committed.driverId !== assignment.driverId ||
      committed.status !== "active" ||
      (committed.tripState !== "pre_departure" && committed.tripState !== "in_service") ||
      typeof committed.sessionId !== "string" ||
      !SAFE_ID.test(committed.sessionId) ||
      typeof committed.delayUpdatedAt !== "number"
    ) {
      res.status(409).json({ error: "No active shift exists for this vehicle and route." });
      return;
    }
    const sessionId = committed.sessionId;
    const delayUpdatedAt = committed.delayUpdatedAt;
    const activeRideRef = db.collection("active_rides")
      .doc(activeRideId(assignment.busId, assignment.routeId));
    let durable = false;
    try {
      durable = await db.runTransaction(async (transaction) => {
        const activeRide = await transaction.get(activeRideRef);
        const activeRideData = activeRide.data();
        if (
          !activeRide.exists ||
          activeRideData?.status !== "active" ||
          activeRideData?.sessionId !== sessionId
        ) {
          return false;
        }
        const durableRevision =
          Number.isSafeInteger(activeRideData.delayUpdatedAt) &&
          Number(activeRideData.delayUpdatedAt) >= 0
            ? Number(activeRideData.delayUpdatedAt)
            : 0;
        if (durableRevision > delayUpdatedAt) return false;
        transaction.set(activeRideRef, {
          delayMinutes,
          delayUpdatedAt,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return true;
      });
      if (!durable) {
        console.warn(
          `[Shifts] Skipped stale delay mirror for ${assignment.busId}/${assignment.routeId} session ${sessionId}.`,
        );
      }
    } catch (error) {
      console.error(
        `[Shifts] Failed to persist delay for ${assignment.busId}/${assignment.routeId} session ${sessionId}:`,
        error,
      );
    }
    res.json({ saved: true, delayMinutes, delayUpdatedAt, durable });
  } catch (error) {
    console.error("[Shifts] Failed to update delay:", error);
    res.status(500).json({ error: "Unable to update delay." });
  }
}

async function startShift(req: AuthenticatedRequest, res: Response) {
  try {
    const assignment = await authorizeOperator(
      req,
      req.body?.busId,
      req.body?.routeId,
      req.body?.driverId,
    );
    if (!assignment) {
      res.status(403).json({ error: "Operator is not assigned to this bus and route." });
      return;
    }

    const key = res.locals.idempotencyKey as string | undefined;
    const keyRef = key ? db.collection("_ride_session_creation_keys").doc(
      createHash("sha256").update(`${req.user!.uid}\0${key}`).digest("hex"),
    ) : null;
    const matchesAssignment = (value: Record<string, unknown>) =>
      value.busId === assignment.busId && value.routeId === assignment.routeId &&
      value.driverId === assignment.driverId;
    const bindingData = (sessionId: string) => ({
      ...assignment, sessionId, createdAt: FieldValue.serverTimestamp(),
    });
    const priorBinding = keyRef ? await keyRef.get() : null;
    const prior = priorBinding?.data();
    if (priorBinding?.exists && (!prior || !matchesAssignment(prior))) {
      res.status(409).json({ error: "Idempotency key belongs to a different assignment." });
      return;
    }
    const pinnedSessionId = prior?.sessionId as string | undefined;
    if (pinnedSessionId) {
      const pinned = await db.collection("ride_sessions").doc(pinnedSessionId).get();
      if (!pinned.exists) {
        res.status(410).json({ error: "The session for this idempotency key was deleted." });
        return;
      }
      const data = pinned.data();
      if (["completed", "interrupted", "failed"].includes(data?.status)) {
        const direction = isRideDirection(data?.direction) ? data.direction : null;
        res.json({ sessionId: pinnedSessionId, resumed: true, direction, pending: !direction });
        return;
      }
    }
    const nodeRef = rtdb.ref(`activeBuses/${assignment.busId}_${assignment.routeId}`);
    const current = (await nodeRef.once("value")).val() as Record<string, unknown> | null;
    if (keyRef && pinnedSessionId && pinnedSessionId === current?.sessionId && current?.tripState === "completed") {
      res.status(409).json({ error: "The original session is awaiting completion recovery." });
      return;
    }
    if (pinnedSessionId && current?.status === "active" &&
        current.tripState !== "completed" && current.sessionId !== pinnedSessionId) {
      res.status(409).json({ error: "The original session is awaiting lifecycle recovery." });
      return;
    }
    if (
      current?.status === "active" &&
      current?.tripState !== "completed" &&
      current?.driverId === assignment.driverId &&
      typeof current.sessionId === "string" &&
      SAFE_ID.test(current.sessionId)
    ) {
      const direction = isRideDirection(current.direction) ? current.direction : null;
      const sessionStatus = direction
        ? current.tripState === "pre_departure" ? "armed" : "active"
        : "pending";
      const lockRef = activeBusLockRef(assignment.busId);
      const lockClaimed = await db.runTransaction(async (transaction) => {
        const binding = keyRef ? await transaction.get(keyRef) : null;
        const lock = await transaction.get(lockRef);
        const session = await transaction.get(db.collection("ride_sessions").doc(current.sessionId as string));
        if (binding?.exists && (!matchesAssignment(binding.data()!) || binding.data()?.sessionId !== current.sessionId)) return false;
        if ((keyRef && !session.exists) || (session.exists && ["completed", "interrupted", "failed"].includes(session.data()?.status))) return false;
        if (lock.exists && lock.data()?.sessionId !== current.sessionId) return false;
        if (keyRef && !binding?.exists) transaction.create(keyRef, bindingData(current.sessionId as string));
        transaction.set(lockRef, {
          busId: assignment.busId,
          routeId: assignment.routeId,
          driverId: assignment.driverId,
          sessionId: current.sessionId,
          direction,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (!lockClaimed) {
        res.status(409).json({ error: "This bus already has an active shift on another route." });
        return;
      }
      const projections = [
        { ref: db.collection("ride_sessions").doc(current.sessionId), data: {
          id: current.sessionId,
          busId: assignment.busId,
          driverId: assignment.driverId,
          routeId: assignment.routeId,
          status: sessionStatus,
          direction,
          directionState: direction ? "resolved" : "pending",
          originStopId: typeof current.originStopId === "string" ? current.originStopId : null,
          destinationStopId: typeof current.destinationStopId === "string" ? current.destinationStopId : null,
        } },
        ...(direction ? [{ ref: db.collection("active_rides")
          .doc(activeRideId(assignment.busId, assignment.routeId)), data: {
            sessionId: current.sessionId,
            busId: assignment.busId,
            driverId: assignment.driverId,
            routeId: assignment.routeId,
            status: "active",
            direction,
            originStopId: typeof current.originStopId === "string" ? current.originStopId : null,
            destinationStopId: typeof current.destinationStopId === "string" ? current.destinationStopId : null,
            tripState:
              current.tripState === "in_service"
                ? "in_service"
                : "pre_departure",
            currentStopIndex: Number.isInteger(current.currentStopIndex)
              ? current.currentStopIndex
              : 0,
            hasDepartedOrigin: current.hasDepartedOrigin === true,
            delayMinutes: normalizedDelayMinutes(current.delayMinutes),
            delayUpdatedAt: normalizedDelayRevision(current.delayUpdatedAt),
            updatedAt: FieldValue.serverTimestamp(),
          } }] : []),
      ];
      if (keyRef) {
        await commitCreationProjections(projections);
      } else {
        await Promise.all(projections.map(projection => projection.ref.set(projection.data, { merge: true })));
      }
      res.json({
        sessionId: current.sessionId,
        resumed: true,
        direction,
        pending: !direction,
      });
      return;
    }
    // A completed ride is terminal: the live node still reports
    // status="active" until the engine's 30s cleanup, but it must never be
    // resurrected. Fall through to a fresh start below.
    if (
      current?.status === "active" &&
      current?.tripState !== "completed" &&
      typeof current?.sessionId === "string" &&
      SAFE_ID.test(current.sessionId)
    ) {
      res.status(409).json({ error: "This bus already has an active shift." });
      return;
    }

    const routeDoc = await db.collection("routes").doc(assignment.routeId).get();
    const routeStops = routeDoc.data()?.stops;
    const naturalStops = Array.isArray(routeStops) ? routeStops : [];
    if (naturalStops.length < 2) {
      res.status(422).json({ error: "This route requires at least two valid ordered stops." });
      return;
    }
    const telemetryTimestamp = Number(current?.timestamp);
    const currentLat = Number(current?.lat);
    const currentLng = Number(current?.lng);
    if (
      !Number.isFinite(currentLat) ||
      !Number.isFinite(currentLng) ||
      !Number.isFinite(telemetryTimestamp) ||
      Date.now() - telemetryTimestamp > 60_000 ||
      telemetryTimestamp > Date.now() + 10_000
    ) {
      res.status(409).json({
        error: "A fresh hardware GNSS fix is required before starting a shift.",
      });
      return;
    }
    const routeEndpointVersion = endpointSnapshotVersion(naturalStops);
    if (routeEndpointVersion === null) {
      res.status(422).json({
        error: "This route requires at least two valid ordered stops.",
      });
      return;
    }
    const inferredDirection = inferRideDirectionFromTelemetry(
      naturalStops,
      {
        now: Date.now(),
        timestamp: telemetryTimestamp,
        motionState: current?.motionState,
        gpsHdop: current?.gpsHdop,
        position: { lat: currentLat, lng: currentLng },
      },
    );
    // New sessions must never inherit the completed or provisional direction.
    const requestedDirection = inferredDirection;
    const stops = requestedDirection
      ? stopsInRideDirection(naturalStops, requestedDirection)
      : [];
    const origin = stops[0] ?? null;
    const destination = stops.at(-1) ?? null;
    const proposedSessionRef = db.collection("ride_sessions").doc();
    const lockRef = activeBusLockRef(assignment.busId);
    const proposedArmedAt = Date.now();
    const lockClaim = await db.runTransaction(async (transaction) => {
      const binding = keyRef ? await transaction.get(keyRef) : null;
      const lock = await transaction.get(lockRef);
      if (binding?.exists && (!matchesAssignment(binding.data()!) ||
          binding.data()?.sessionId !== lock.data()?.sessionId)) return null;
      if (pinnedSessionId && lock.data()?.sessionId !== pinnedSessionId) return null;
      if (keyRef && lock.exists && current?.tripState === "completed" && lock.data()?.sessionId === current.sessionId) return null;
      if (lock.exists) {
        const lockData = lock.data();
        if (
          lockData?.driverId !== assignment.driverId ||
          lockData?.routeId !== assignment.routeId ||
          typeof lockData.sessionId !== "string" ||
          !SAFE_ID.test(lockData.sessionId)
        ) {
          return null;
        }
        const existingSession = await transaction.get(
          db.collection("ride_sessions").doc(lockData.sessionId),
        );
        const session = existingSession.data();
        const sessionStatus = session?.status;
        if (
          !existingSession.exists ||
          (sessionStatus !== "pending" &&
            sessionStatus !== "armed" &&
            sessionStatus !== "active")
        ) {
          return null;
        }
        const existingDirection = isRideDirection(session?.direction)
          ? session.direction
          : null;
        if (existingDirection && requestedDirection && existingDirection !== requestedDirection) {
          return null;
        }
        const direction = existingDirection ?? requestedDirection;
        const resolvedStops = direction
          ? stopsInRideDirection(naturalStops, direction)
          : [];
        const resolvedOrigin = resolvedStops[0] ?? null;
        const resolvedDestination = resolvedStops.at(-1) ?? null;
        if (keyRef && !binding?.exists) transaction.create(keyRef, bindingData(lockData.sessionId));
        if (direction && !existingDirection) {
          transaction.set(db.collection("ride_sessions").doc(lockData.sessionId), {
            direction,
            directionState: "resolved",
            directionEndpointVersion: routeEndpointVersion,
            originStopId: typeof resolvedOrigin?.id === "string" ? resolvedOrigin.id : null,
            destinationStopId:
              typeof resolvedDestination?.id === "string" ? resolvedDestination.id : null,
            directionResolvedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          transaction.set(lockRef, {
            direction,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        return {
          sessionId: lockData.sessionId,
          armedAt: typeof session?.armedAt === "number" ? session.armedAt : proposedArmedAt,
          status: sessionStatus,
          created: false,
          direction,
        };
      }
      if (keyRef) transaction.create(keyRef, bindingData(proposedSessionRef.id));
      transaction.create(proposedSessionRef, {
        id: proposedSessionRef.id,
        busId: assignment.busId,
        driverId: assignment.driverId,
        routeId: assignment.routeId,
        direction: requestedDirection,
        directionState: requestedDirection ? "resolved" : "pending",
        directionEndpointVersion: requestedDirection ? routeEndpointVersion : null,
        originStopId: typeof origin?.id === "string" ? origin.id : null,
        destinationStopId: typeof destination?.id === "string" ? destination.id : null,
        armedAt: proposedArmedAt,
        status: "pending",
        passengers: {},
        stopsReached: {},
      });
      transaction.create(lockRef, {
        busId: assignment.busId,
        routeId: assignment.routeId,
        driverId: assignment.driverId,
        sessionId: proposedSessionRef.id,
        direction: requestedDirection,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        sessionId: proposedSessionRef.id,
        armedAt: proposedArmedAt,
        status: "pending" as const,
        created: true,
        direction: requestedDirection,
      };
    });
    if (!lockClaim) {
      res.status(409).json({ error: "This bus already has an active shift on another route." });
      return;
    }
    const sessionRef = db.collection("ride_sessions").doc(lockClaim.sessionId);
    const armedAt = lockClaim.armedAt;
    const direction = lockClaim.direction;
    const claimedStops = direction
      ? stopsInRideDirection(naturalStops, direction)
      : [];
    const claimedOrigin = claimedStops[0] ?? null;
    const claimedDestination = claimedStops.at(-1) ?? null;
    let claimedTripState = direction ? "in_service" : "pre_departure";
    let claimedStopIndex = 0;
    let claimedHasDepartedOrigin = false;
    let claimedDelayMinutes = 0;
    let claimedDelayUpdatedAt = 0;
    if (!lockClaim.created && lockClaim.status !== "pending") {
      const recovery = await db.collection("active_rides")
        .doc(activeRideId(assignment.busId, assignment.routeId))
        .get();
      const recoveryData = recovery.data();
      if (!recovery.exists || recoveryData?.sessionId !== sessionRef.id) {
        res.status(409).json({
          error: "The existing ride is awaiting lifecycle recovery. Retry after telemetry reconnects.",
        });
        return;
      }
      claimedTripState = recoveryData.tripState === "in_service"
        ? "in_service"
        : "pre_departure";
      claimedStopIndex = Number.isInteger(recoveryData.currentStopIndex)
        ? recoveryData.currentStopIndex
        : 0;
      claimedHasDepartedOrigin = recoveryData.hasDepartedOrigin === true;
      claimedDelayMinutes = normalizedDelayMinutes(recoveryData.delayMinutes);
      claimedDelayUpdatedAt = normalizedDelayRevision(recoveryData.delayUpdatedAt);
    }

    try {
      // Claim the live vehicle atomically. Two near-simultaneous start
      // requests may both pass the initial read, but only one session is
      // allowed to replace a node that has no active session. A completed
      // node is terminal and may be claimed by a fresh session (the engine
      // cancels its pending completion cleanup once tripState changes).
      const claim = await nodeRef.transaction((liveValue) => {
        const live = liveValue as Record<string, unknown> | null;
        if (keyRef && live?.sessionId === sessionRef.id && live.tripState === "completed") return;
        if (
          live?.status === "active" &&
          live?.tripState !== "completed" &&
          typeof live.sessionId === "string" &&
          live.sessionId.length > 0
        ) {
          return;
        }
        return {
          ...withoutLiveRouteContext(live),
          busId: assignment.busId,
          driverId: assignment.driverId,
          routeId: assignment.routeId,
          direction,
          directionState: direction ? "resolved" : "pending",
          directionEndpointVersion: direction ? routeEndpointVersion : null,
          originStopId: typeof claimedOrigin?.id === "string" ? claimedOrigin.id : null,
          destinationStopId:
            typeof claimedDestination?.id === "string" ? claimedDestination.id : null,
          sessionId: sessionRef.id,
          status: "active",
          deviceState: "online",
          tripState: claimedTripState,
          hasDepartedOrigin: claimedHasDepartedOrigin,
          currentStopIndex: claimedStopIndex,
          delayMinutes: claimedDelayMinutes,
          delayUpdatedAt: claimedDelayUpdatedAt,
          automaticTurnaround: false,
          previousSessionId: null,
          completedAt: null,
          turnaroundEligibleAt: null,
          turnaroundClaimId: null,
          turnaroundClaimedAt: null,
          lifecycleUpdatedAt: { ".sv": "timestamp" },
        };
      });
      if (!claim.committed) {
        const winner = claim.snapshot.val() as Record<string, unknown> | null;
        if (keyRef && winner?.sessionId === sessionRef.id && winner.tripState === "completed") {
          res.status(409).json({ error: "The original session is awaiting completion recovery." });
          return;
        }
        if (
          winner?.driverId === assignment.driverId &&
          winner.sessionId === sessionRef.id
        ) {
          res.json({
            sessionId: winner.sessionId,
            resumed: true,
            direction: isRideDirection(winner.direction) ? winner.direction : null,
            pending: !isRideDirection(winner.direction),
          });
          return;
        }
        // A reused claim belongs to an existing session. This request did not
        // create that lock, so it must not fail the session or release its
        // lock merely because a different live session won the RTDB race.
        if (lockClaim.created) {
          await sessionRef.set({
            status: "failed",
            endTime: Date.now(),
            failureReason: "shift_conflict",
          }, { merge: true });
          await releaseActiveBusLock(assignment.busId, sessionRef.id);
        }
        res.status(409).json({ error: "This bus already has an active shift." });
        return;
      }
      const activeRideRef = db.collection("active_rides")
        .doc(activeRideId(assignment.busId, assignment.routeId));
      const batch = db.batch();
      const projectionWrites: { ref: typeof sessionRef; data: Record<string, unknown>; merge?: boolean }[] = [];
      const writeProjection = (ref: typeof sessionRef, data: Record<string, unknown>, options?: { merge: boolean }) => {
        projectionWrites.push({ ref, data, merge: options?.merge });
        if (options) batch.set(ref, data, options);
        else batch.set(ref, data);
      };
      writeProjection(sessionRef, {
        status: direction
          ? (claimedTripState === "in_service" ? "active" : "armed")
          : "pending",
        armedAt,
        direction,
        directionState: direction ? "resolved" : "pending",
        directionEndpointVersion: direction ? routeEndpointVersion : null,
        originStopId: typeof claimedOrigin?.id === "string" ? claimedOrigin.id : null,
        destinationStopId:
          typeof claimedDestination?.id === "string" ? claimedDestination.id : null,
        ...(direction && claimedTripState === "in_service" && lockClaim.created
          ? {
              startTime: armedAt,
              activatedAt: FieldValue.serverTimestamp(),
              stopsReached: {
                0: {
                  stopIndex: 0,
                  stopId: typeof claimedOrigin?.id === "string" ? claimedOrigin.id : "",
                  stopName: typeof claimedOrigin?.name === "string" ? claimedOrigin.name : "",
                  timestamp: FieldValue.serverTimestamp(),
                },
              },
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (direction) {
        writeProjection(activeRideRef, {
          sessionId: sessionRef.id,
          busId: assignment.busId,
          driverId: assignment.driverId,
          routeId: assignment.routeId,
          status: "active",
          direction,
          originStopId: typeof claimedOrigin?.id === "string" ? claimedOrigin.id : null,
          destinationStopId:
            typeof claimedDestination?.id === "string" ? claimedDestination.id : null,
          tripState: claimedTripState,
          currentStopIndex: claimedStopIndex,
          hasDepartedOrigin: claimedHasDepartedOrigin,
          delayMinutes: claimedDelayMinutes,
          delayUpdatedAt: claimedDelayUpdatedAt,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      if (keyRef) {
        await commitCreationProjections(projectionWrites);
      } else {
        await batch.commit();
      }
    } catch (error) {
      // Preserve the RTDB claim, pending session and bus lock on an ambiguous
      // Firestore failure. A retry enters the idempotent resume branch and
      // repairs the durable projections; eager rollback could undo a commit
      // whose response was lost.
      throw error;
    }

    res.status(lockClaim.created ? 201 : 200).json({
      sessionId: sessionRef.id,
      resumed: !lockClaim.created,
      direction,
      pending: !direction,
    });
  } catch (error) {
    if (error instanceof SessionCreationConflict) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error("[Shifts] Failed to start shift:", error);
    res.status(500).json({ error: "Unable to start shift." });
  }
}

router.post("/stop", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assignment = await authorizeOperator(
      req,
      req.body?.busId,
      req.body?.routeId,
      req.body?.driverId,
    );
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    if (!assignment || !SAFE_ID.test(sessionId)) {
      res.status(403).json({ error: "Operator is not authorized to stop this shift." });
      return;
    }

    const sessionRef = db.collection("ride_sessions").doc(sessionId);
    const session = await sessionRef.get();
    const data = session.data();
    if (
      !session.exists ||
      data?.driverId !== assignment.driverId ||
      data?.busId !== assignment.busId ||
      data?.routeId !== assignment.routeId
    ) {
      res.status(404).json({ error: "Active shift was not found." });
      return;
    }

    if (data?.status === "completed") {
      res.json({ stopped: true, alreadyCompleted: true });
      return;
    }
    const activeRideRef = db.collection("active_rides")
      .doc(activeRideId(assignment.busId, assignment.routeId));
    const lockRef = activeBusLockRef(assignment.busId);
    const endedAt = Date.now();
    const outcome = await db.runTransaction(async (transaction) => {
      const [currentSession, activeRide, lock] = await Promise.all([
        transaction.get(sessionRef),
        transaction.get(activeRideRef),
        transaction.get(lockRef),
      ]);
      const current = currentSession.data();
      if (
        !currentSession.exists ||
        current?.driverId !== assignment.driverId ||
        current?.busId !== assignment.busId ||
        current?.routeId !== assignment.routeId
      ) {
        return "missing" as const;
      }
      if (current.status === "completed") return "completed" as const;
      if (current.status !== "interrupted") {
        if (
          current.status !== "pending" &&
          current.status !== "armed" &&
          current.status !== "active"
        ) {
          return "terminal" as const;
        }
        transaction.set(sessionRef, {
          status: "interrupted",
          endTime: endedAt,
          interruptionReason: "manual_end_early",
          interruptedBy: req.user?.uid ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      if (activeRide.data()?.sessionId === sessionId) {
        transaction.delete(activeRideRef);
      }
      if (lock.data()?.sessionId === sessionId) {
        transaction.delete(lockRef);
      }
      return current.status === "interrupted"
        ? "already-interrupted" as const
        : "interrupted" as const;
    });

    if (outcome === "missing") {
      res.status(404).json({ error: "Active shift was not found." });
      return;
    }
    if (outcome === "completed") {
      res.json({ stopped: true, alreadyCompleted: true });
      return;
    }
    if (outcome === "terminal") {
      res.status(409).json({ error: "This ride is already in a terminal state." });
      return;
    }

    const nodeRef = rtdb.ref(
      `activeBuses/${activeRideId(assignment.busId, assignment.routeId)}`,
    );
    await nodeRef.transaction((currentValue) => {
      if (!currentValue || typeof currentValue !== "object") return;
      const current = currentValue as Record<string, unknown>;
      if (current.sessionId !== sessionId) return;
      return retireRideLifecycle(current);
    });
    res.json({
      stopped: true,
      interrupted: true,
      alreadyInterrupted: outcome === "already-interrupted",
    });
  } catch (error) {
    console.error("[Shifts] Failed to stop shift:", error);
    res.status(500).json({ error: "Unable to stop shift." });
  }
});

async function clearMessages(req: Request, res: Response) {
  const sessionId = singleRouteParam(req.params.sessionId);
  if (sessionId === null || !SAFE_ID.test(sessionId)) {
    res.status(400).json({ error: "Invalid session ID." });
    return;
  }
  try {
    const messages = db.collection("ride_sessions").doc(sessionId).collection("messages");
    let deleted = 0;
    while (true) {
      const snapshot = await messages.limit(400).get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((message) => batch.delete(message.ref));
      await batch.commit();
      deleted += snapshot.size;
    }
    res.json({ deleted });
  } catch (error) {
    console.error("[Shifts] Failed to clear messages:", error);
    res.status(500).json({ error: "Unable to clear messages." });
  }
}

async function deleteHistory(req: Request, res: Response) {
  const sessionId = singleRouteParam(req.params.sessionId);
  if (sessionId === null || !SAFE_ID.test(sessionId)) {
    res.status(400).json({ error: "Invalid session ID." });
    return;
  }
  try {
    const result = await deleteTerminalRideHistory(db, sessionId);
    res.json({ deleted: true, ...result });
  } catch (error) {
    if (error instanceof RideHistoryConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error("[Shifts] Failed to delete ride history:", error);
    res.status(500).json({ error: "Unable to delete ride history." });
  }
}

function privateResponse(_req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store");
  next();
}

function creationContract(req: Request, res: Response, next: NextFunction) {
  const key = req.get("Idempotency-Key");
  if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    res.status(400).json({ error: "A valid Idempotency-Key is required." });
    return;
  }
  res.locals.idempotencyKey = key;
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 300 && typeof body?.sessionId === "string") {
      res.location(`/api/v2/ride-sessions/${body.sessionId}`);
    }
    return json(body);
  };
  next();
}

async function sessionDelayContract(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const sessionId = singleRouteParam(req.params.sessionId);
  if (!sessionId || !SAFE_ID.test(sessionId) || !req.body ||
      Object.keys(req.body).some(key => key !== "delayMinutes")) {
    res.status(400).json({ error: "Only delayMinutes and a valid session ID are accepted." });
    return;
  }
  try {
    const session = await db.collection("ride_sessions").doc(sessionId).get();
    if (!session.exists) {
      res.status(404).json({ error: "Ride session was not found." });
      return;
    }
    const data = session.data()!;
    const assignment = await authorizeOperator(req, data.busId, data.routeId, data.driverId);
    if (!assignment || assignment.driverId !== data.driverId) {
      res.status(403).json({ error: "Operator is not assigned to this session." });
      return;
    }
    if (!["pending", "armed", "active"].includes(data.status)) {
      res.status(409).json({ error: "This ride is already in a terminal state." });
      return;
    }
    res.locals.expectedSessionId = sessionId;
    req.body = { ...req.body, ...assignment };
    next();
  } catch (error) { next(error); }
}

async function readSession(req: AuthenticatedRequest, res: Response) {
  const sessionId = singleRouteParam(req.params.sessionId);
  if (!sessionId || !SAFE_ID.test(sessionId)) {
    res.status(400).json({ error: "Invalid session ID." });
    return;
  }
  try {
    const session = await db.collection("ride_sessions").doc(sessionId).get();
    if (!session.exists) {
      res.status(404).json({ error: "Ride session was not found." });
      return;
    }
    const data = session.data()!;
    const user = req.user!;
    const admin = user.role === "admin" || user.admin === true;
    const member = Object.prototype.hasOwnProperty.call(data.passengers ?? {}, user.uid) &&
      data.passengers[user.uid]?.userId === user.uid;
    const operator = !admin && !member && user.role === "driver" && user.driverId === data.driverId &&
      !!await authorizeOperator(req, data.busId, data.routeId, data.driverId);
    if (!admin && !member && !operator) {
      res.status(403).json({ error: "Ride session membership is required." });
      return;
    }
    res.json({ sessionId, busId: data.busId, routeId: data.routeId,
      status: data.status, direction: isRideDirection(data.direction) ? data.direction : null });
  } catch (error) {
    console.error("[Shifts] Failed to read session:", error);
    res.status(500).json({ error: "Unable to read ride session." });
  }
}

router.patch("/delay", requireAuth, updateDelay);
router.post("/start", requireAuth, startShift);
router.delete("/:sessionId/messages", requireAdmin, clearMessages);
router.delete("/:sessionId/history", requireAdmin, deleteHistory);
rideSessionsRouter.post("/", privateResponse, requireAuth, creationContract, startShift);
rideSessionsRouter.get("/:sessionId", privateResponse, requireAuth, readSession);
rideSessionsRouter.patch("/:sessionId", privateResponse, requireAuth, sessionDelayContract, updateDelay);
rideSessionsRouter.delete("/:sessionId/messages", privateResponse, requireAdmin, clearMessages);
rideSessionsRouter.delete("/:sessionId", privateResponse, requireAdmin, deleteHistory);

export default router;
