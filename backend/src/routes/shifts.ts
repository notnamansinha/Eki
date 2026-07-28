import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";
import { db, rtdb } from "../lib/firebaseAdmin";
import { haversineMeters } from "../lib/geo";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    driverId?: string;
    assignedBusId?: string;
  };
};

async function authorizeDriver(
  req: AuthenticatedRequest,
  busId: unknown,
  routeId: unknown,
) {
  const user = req.user;
  if (
    user?.role !== "driver" ||
    typeof user.driverId !== "string" ||
    typeof user.assignedBusId !== "string" ||
    typeof busId !== "string" ||
    typeof routeId !== "string" ||
    !SAFE_ID.test(busId) ||
    !SAFE_ID.test(routeId) ||
    busId !== user.assignedBusId
  ) {
    return null;
  }

  const [driverDoc, busDoc] = await Promise.all([
    db.collection("drivers").doc(user.driverId).get(),
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
    driver?.authUid !== user.uid ||
    driver?.assignedBusId !== busId ||
    !busDoc.exists ||
    !assignedRoutes.includes(routeId)
  ) {
    return null;
  }
  return { driverId: user.driverId, busId, routeId };
}

router.patch("/delay", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assignment = await authorizeDriver(req, req.body?.busId, req.body?.routeId);
    const delayMinutes = req.body?.delayMinutes;
    if (
      !assignment ||
      typeof delayMinutes !== "number" ||
      !Number.isFinite(delayMinutes) ||
      delayMinutes < 0 ||
      delayMinutes > 1440
    ) {
      res.status(400).json({ error: "Invalid delay update." });
      return;
    }
    const nodeRef = rtdb.ref(`activeBuses/${assignment.busId}_${assignment.routeId}`);
    const current = (await nodeRef.once("value")).val() as Record<string, unknown> | null;
    if (
      !current ||
      current.driverId !== assignment.driverId ||
      current.status !== "active" ||
      typeof current.sessionId !== "string"
    ) {
      res.status(409).json({ error: "No active shift exists for this vehicle and route." });
      return;
    }
    await nodeRef.update({ delayMinutes });
    res.json({ saved: true, delayMinutes });
  } catch (error) {
    console.error("[Shifts] Failed to update delay:", error);
    res.status(500).json({ error: "Unable to update delay." });
  }
});

router.post("/start", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assignment = await authorizeDriver(req, req.body?.busId, req.body?.routeId);
    if (!assignment) {
      res.status(403).json({ error: "Driver is not assigned to this bus and route." });
      return;
    }

    const nodeRef = rtdb.ref(`activeBuses/${assignment.busId}_${assignment.routeId}`);
    const current = (await nodeRef.once("value")).val() as Record<string, unknown> | null;
    if (
      current?.status === "active" &&
      current?.driverId === assignment.driverId &&
      typeof current.sessionId === "string"
    ) {
      await db.collection("ride_sessions").doc(current.sessionId).set({
        id: current.sessionId,
        busId: assignment.busId,
        driverId: assignment.driverId,
        routeId: assignment.routeId,
        status: "active",
        passengers: {},
      }, { merge: true });
      res.json({ sessionId: current.sessionId, resumed: true });
      return;
    }
    if (current?.status === "active" && typeof current?.sessionId === "string") {
      res.status(409).json({ error: "This bus already has an active shift." });
      return;
    }

    const routeDoc = await db.collection("routes").doc(assignment.routeId).get();
    const stops = routeDoc.data()?.stops;
    const origin = Array.isArray(stops) ? stops[0] : null;
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
    if (!Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lng)) {
      res.status(422).json({ error: "This route has no valid origin coordinate." });
      return;
    }
    if (
      haversineMeters(
        { lat: currentLat, lng: currentLng },
        { lat: origin.lat, lng: origin.lng },
      ) > 250
    ) {
      res.status(409).json({ error: "Vehicle must be near the route origin to start a shift." });
      return;
    }

    const sessionRef = db.collection("ride_sessions").doc();
    const startedAt = Date.now();
    await sessionRef.create({
      id: sessionRef.id,
      busId: assignment.busId,
      driverId: assignment.driverId,
      routeId: assignment.routeId,
      startTime: startedAt,
      status: "pending",
      passengers: {},
      stopsReached: {},
    });

    try {
      // Claim the live vehicle atomically. Two near-simultaneous start
      // requests may both pass the initial read, but only one session is
      // allowed to replace a node that has no active session.
      const claim = await nodeRef.transaction((liveValue) => {
        const live = liveValue as Record<string, unknown> | null;
        if (
          live?.status === "active" &&
          typeof live.sessionId === "string" &&
          live.sessionId.length > 0
        ) {
          return;
        }
        return {
          ...(live ?? {}),
          busId: assignment.busId,
          driverId: assignment.driverId,
          routeId: assignment.routeId,
          sessionId: sessionRef.id,
          status: "active",
          deviceState: "online",
          tripState: "in_service",
          hasDepartedOrigin: false,
          currentStopIndex: 0,
          delayMinutes: 0,
          timestamp: { ".sv": "timestamp" },
        };
      });
      if (!claim.committed) {
        const winner = claim.snapshot.val() as Record<string, unknown> | null;
        await sessionRef.set({
          status: "failed",
          endTime: Date.now(),
          failureReason: "shift_conflict",
        }, { merge: true });
        if (
          winner?.driverId === assignment.driverId &&
          typeof winner.sessionId === "string"
        ) {
          res.json({ sessionId: winner.sessionId, resumed: true });
          return;
        }
        res.status(409).json({ error: "This bus already has an active shift." });
        return;
      }
      await sessionRef.set({
        status: "active",
        activatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      await nodeRef.transaction((liveValue) => {
        const live = liveValue as Record<string, unknown> | null;
        if (live?.sessionId !== sessionRef.id) return;
        return {
          ...live,
          status: "offline",
          deviceState: "offline",
          tripState: "ended",
          timestamp: { ".sv": "timestamp" },
        };
      }).catch((rollbackError) => {
        console.error("[Shifts] Failed to roll back live shift claim:", rollbackError);
      });
      await sessionRef.set({
        status: "failed",
        endTime: Date.now(),
        failureReason: "live_state_initialization_failed",
      }, { merge: true });
      throw error;
    }

    res.status(201).json({ sessionId: sessionRef.id, resumed: false });
  } catch (error) {
    console.error("[Shifts] Failed to start shift:", error);
    res.status(500).json({ error: "Unable to start shift." });
  }
});

router.post("/stop", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assignment = await authorizeDriver(req, req.body?.busId, req.body?.routeId);
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    if (!assignment || !SAFE_ID.test(sessionId)) {
      res.status(403).json({ error: "Driver is not authorized to stop this shift." });
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

    const endedAt = Date.now();
    // Persist the durable record first. If the live update fails, the driver
    // remains in tracking mode and can safely retry the idempotent stop call.
    await sessionRef.set({
      status: "completed",
      endTime: endedAt,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await rtdb.ref(`activeBuses/${assignment.busId}_${assignment.routeId}`).update({
      status: "offline",
      deviceState: "offline",
      tripState: "ended",
      timestamp: { ".sv": "timestamp" },
    });
    res.json({ stopped: true });
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

export default router;
