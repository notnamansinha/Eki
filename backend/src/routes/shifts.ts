import { startAssignedService, RideSessionStartError, SessionCreationConflict, activeRideId, activeBusLockRef } from "../services/rideSessionStart";
import { Router, type Request, type Response, type NextFunction } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";
import { db, rtdb } from "../lib/firebaseAdmin";
import { withoutLiveRouteContext } from "../lib/liveRouteContext";
import { newerJourneyLocation } from "../services/journeyLocation";
import { singleRouteParam } from "../lib/requestParams";
import {
  isRideDirection,
} from "../lib/rideDirection";
import {
  deleteTerminalRideHistory,
  RideHistoryConflictError,
} from "../services/rideHistoryDeletion";

const router = Router();
export const rideSessionsRouter = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

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
    "gnssGap",
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
    automaticServicePaused: true,
    serviceSetupPending: false,
    automaticServiceState: "paused",
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
      // A cold SDK cache can supply null before the server value is known.
      // Returning null sends the compare-and-set and lets the SDK retry with
      // server data; undefined would abort locally without checking the ride.
      if (value === null) return null;
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
    const assignment = await authorizeOperator(req, req.body?.busId, req.body?.routeId, req.body?.driverId);
    if (!assignment) { res.status(403).json({ error: "Operator is not assigned to this bus and route." }); return; }
    const { created, ...result } = await startAssignedService(assignment, {
      principalScope: req.user!.uid, idempotencyKey: res.locals.idempotencyKey,
    });
    res.status(created ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof RideSessionStartError || error instanceof SessionCreationConflict) {
      res.status(error.statusCode).json({ error: error.message }); return;
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
    let liveAtEnd: Record<string, unknown> | null = null;
    try {
      const value = (await rtdb.ref(`activeBuses/${activeRideId(assignment.busId, assignment.routeId)}`).once("value")).val();
      if (value && typeof value === "object" && !Array.isArray(value)) liveAtEnd = value;
    } catch (error) {
      // History enrichment must not prevent the durable stop/lock release.
      // Keep the previously recorded location when a fresh snapshot is absent.
      console.warn("[Shifts] Final location unavailable during manual stop:", error);
    }
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
      const pauseAutomaticService = lock.data()?.sessionId === sessionId ||
        (!lock.exists && activeRide.data()?.sessionId === sessionId);
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
          ...(liveAtEnd && liveAtEnd.sessionId === sessionId && newerJourneyLocation(liveAtEnd, current.lastKnownLocation)
            ? { lastKnownLocation: newerJourneyLocation(liveAtEnd, current.lastKnownLocation) } : {}),
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
      if (pauseAutomaticService) transaction.set(db.collection("bus_locations").doc(assignment.busId), {
        automaticServicePaused: true,
      }, { merge: true });
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
    const sessionRef = db.collection("ride_sessions").doc(sessionId);
    const deletionRef = db.collection("_ride_history_deletion_jobs").doc(sessionId);
    const messages = sessionRef.collection("messages");
    const archive = sessionRef.collection("archivedMessages");
    let deleted = 0;
    while (true) {
      const snapshot = await messages.limit(200).get();
      if (snapshot.empty) break;
      const cleared = await db.runTransaction(async transaction => {
        const [session, deletion] = await Promise.all([transaction.get(sessionRef), transaction.get(deletionRef)]);
        // A concurrent history deletion must not leave recreated descendants.
        if (!session.exists || deletion.exists) return false;
        snapshot.docs.forEach(message => {
          transaction.set(archive.doc(message.ref.id), message.data(), { merge: true });
          transaction.delete(message.ref);
        });
        return true;
      });
      if (!cleared) break;
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
