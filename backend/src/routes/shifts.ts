import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";
import { db, rtdb } from "../lib/firebaseAdmin";
import { haversineMeters } from "../lib/geo";
import { inferRideDirectionAtEndpoint } from "../lib/automaticRideDirection";
import { withoutLiveRouteContext } from "../lib/liveRouteContext";
import {
  normalizeRideDirection,
  stopsInRideDirection,
} from "../lib/rideDirection";
import { STOP_GEOFENCE_M } from "../services/tripStateReducer";
import {
  deleteTerminalRideHistory,
  RideHistoryConflictError,
} from "../services/rideHistoryDeletion";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

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

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    admin?: boolean;
    driverId?: string;
    assignedBusId?: string;
  };
};

async function authorizeOperator(
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

router.patch("/delay", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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
        !SAFE_ID.test(current.sessionId)
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
});

router.post("/start", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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

    const nodeRef = rtdb.ref(`activeBuses/${assignment.busId}_${assignment.routeId}`);
    const current = (await nodeRef.once("value")).val() as Record<string, unknown> | null;
    if (
      current?.status === "active" &&
      current?.tripState !== "completed" &&
      current?.driverId === assignment.driverId &&
      typeof current.sessionId === "string" &&
      SAFE_ID.test(current.sessionId)
    ) {
      const direction = normalizeRideDirection(current.direction);
      const sessionStatus =
        current.tripState === "pre_departure" ? "armed" : "active";
      const lockRef = activeBusLockRef(assignment.busId);
      const lockClaimed = await db.runTransaction(async (transaction) => {
        const lock = await transaction.get(lockRef);
        if (lock.exists && lock.data()?.sessionId !== current.sessionId) return false;
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
      await Promise.all([
        db.collection("ride_sessions").doc(current.sessionId).set({
          id: current.sessionId,
          busId: assignment.busId,
          driverId: assignment.driverId,
          routeId: assignment.routeId,
          status: sessionStatus,
          direction,
          originStopId: typeof current.originStopId === "string" ? current.originStopId : null,
          destinationStopId: typeof current.destinationStopId === "string" ? current.destinationStopId : null,
        }, { merge: true }),
        db.collection("active_rides")
          .doc(activeRideId(assignment.busId, assignment.routeId))
          .set({
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
          }, { merge: true }),
      ]);
      res.json({ sessionId: current.sessionId, resumed: true, direction });
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
      telemetryTimestamp > Date.now() + 10_000 ||
      current?.motionState !== "stopped"
    ) {
      res.status(409).json({
        error: "A fresh stopped hardware GNSS fix is required before starting a shift.",
      });
      return;
    }
    const requestedDirection = inferRideDirectionAtEndpoint(
      naturalStops,
      { lat: currentLat, lng: currentLng },
      STOP_GEOFENCE_M,
    );
    if (!requestedDirection) {
      res.status(409).json({
        error: `The bus must be stopped within ${STOP_GEOFENCE_M} metres of exactly one route endpoint before its direction can be inferred.`,
      });
      return;
    }
    const stops = stopsInRideDirection(naturalStops, requestedDirection);
    const origin = stops[0] ?? null;
    const destination = stops.at(-1) ?? null;
    if (!Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lng)) {
      res.status(422).json({ error: "This route has no valid origin coordinate." });
      return;
    }
    const arrivedAtOrigin = haversineMeters(
      { lat: currentLat, lng: currentLng },
      { lat: origin.lat, lng: origin.lng },
    ) <= STOP_GEOFENCE_M;
    const initialTripState =
      arrivedAtOrigin ? "in_service" : "pre_departure";
    const proposedSessionRef = db.collection("ride_sessions").doc();
    const lockRef = activeBusLockRef(assignment.busId);
    const proposedArmedAt = Date.now();
    const lockClaim = await db.runTransaction(async (transaction) => {
      const lock = await transaction.get(lockRef);
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
        const existingDirection = normalizeRideDirection(session?.direction);
        if (existingDirection !== requestedDirection) return null;
        return {
          sessionId: lockData.sessionId,
          armedAt: typeof session?.armedAt === "number" ? session.armedAt : proposedArmedAt,
          status: sessionStatus,
          created: false,
          direction: existingDirection,
        };
      }
      transaction.create(proposedSessionRef, {
        id: proposedSessionRef.id,
        busId: assignment.busId,
        driverId: assignment.driverId,
        routeId: assignment.routeId,
        direction: requestedDirection,
        originStopId: typeof origin.id === "string" ? origin.id : null,
        destinationStopId: typeof destination.id === "string" ? destination.id : null,
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
    let claimedTripState = initialTripState;
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
          originStopId: typeof origin.id === "string" ? origin.id : null,
          destinationStopId: typeof destination.id === "string" ? destination.id : null,
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
        if (
          winner?.driverId === assignment.driverId &&
          winner.sessionId === sessionRef.id
        ) {
          res.json({
            sessionId: winner.sessionId,
            resumed: true,
            direction: normalizeRideDirection(winner.direction),
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
      batch.set(sessionRef, {
        status: claimedTripState === "in_service" ? "active" : "armed",
        armedAt,
        direction,
        originStopId: typeof origin.id === "string" ? origin.id : null,
        destinationStopId: typeof destination.id === "string" ? destination.id : null,
        ...(claimedTripState === "in_service" && lockClaim.created
          ? {
              startTime: armedAt,
              activatedAt: FieldValue.serverTimestamp(),
              stopsReached: {
                0: {
                  stopIndex: 0,
                  stopId: typeof origin.id === "string" ? origin.id : "",
                  stopName: typeof origin.name === "string" ? origin.name : "",
                  timestamp: FieldValue.serverTimestamp(),
                },
              },
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(activeRideRef, {
        sessionId: sessionRef.id,
        busId: assignment.busId,
        driverId: assignment.driverId,
        routeId: assignment.routeId,
        status: "active",
        direction,
        originStopId: typeof origin.id === "string" ? origin.id : null,
        destinationStopId: typeof destination.id === "string" ? destination.id : null,
        tripState: claimedTripState,
        currentStopIndex: claimedStopIndex,
        hasDepartedOrigin: claimedHasDepartedOrigin,
        delayMinutes: claimedDelayMinutes,
        delayUpdatedAt: claimedDelayUpdatedAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
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
    });
  } catch (error) {
    console.error("[Shifts] Failed to start shift:", error);
    res.status(500).json({ error: "Unable to start shift." });
  }
});

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
    res.status(409).json({
      error: "This ride ends automatically after the final ordered stop.",
    });
  } catch (error) {
    console.error("[Shifts] Failed to stop shift:", error);
    res.status(500).json({ error: "Unable to stop shift." });
  }
});

router.delete("/:sessionId/messages", requireAdmin, async (req, res) => {
  const sessionId = req.params.sessionId;
  if (!SAFE_ID.test(sessionId)) {
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
});

router.delete("/:sessionId/history", requireAdmin, async (req, res) => {
  const sessionId = req.params.sessionId;
  if (!SAFE_ID.test(sessionId)) {
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
});

export default router;
