import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/requireAuth";
import { db, rtdb } from "../lib/firebaseAdmin";
import { haversineMeters } from "../lib/geo";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
// A passenger must be within this distance of the hardware-reported bus
// position to board. Browser GPS is typically 10–50 m accurate; the bus fix
// is hardware GNSS, so 150 m firmly excludes remote joins while tolerating
// stop-side GPS scatter.
const JOIN_RADIUS_M = 150;
const MAX_JOIN_FIX_AGE_MS = 60_000;

type AuthenticatedRequest = Request & {
  user?: {
    uid: string;
    role?: string;
    driverId?: string;
    assignedBusId?: string;
  };
};

/**
 * POST /api/sessions/:sessionId/join
 *
 * Server-issued boarding join (SEC: closes the passenger self-join gap).
 * The manifest write is backend-authoritative: the client never writes to
 * ride_sessions. The backend only joins a passenger after verifying they are
 * physically near the bus, using the ESP32 GNSS fix already trusted by the
 * telemetry pipeline — never a client-supplied position.
 */
router.post("/:sessionId/join", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const uid = req.user?.uid;
    if (!SAFE_ID.test(sessionId) || typeof uid !== "string") {
      res.status(400).json({ error: "Invalid session ID." });
      return;
    }

    const { lat, lng, boardingStopId, alightingStopId, userName } = req.body ?? {};
    const hasPosition =
      typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
      typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
    const validStops =
      typeof boardingStopId === "string" && boardingStopId.length > 0 && boardingStopId.length <= 128 &&
      (alightingStopId == null ||
        (typeof alightingStopId === "string" && alightingStopId.length > 0 && alightingStopId.length <= 128));
    const validName = typeof userName === "string" && userName.length > 0 && userName.length <= 100;

    const sessionRef = db.collection("ride_sessions").doc(sessionId);
    const session = await sessionRef.get();
    const data = session.data();
    if (!session.exists || !data) {
      res.status(404).json({ error: "Ride session was not found." });
      return;
    }
    if (!["armed", "active"].includes(String(data.status))) {
      res.status(409).json({ error: "This ride is no longer boarding." });
      return;
    }
    const busId = typeof data.busId === "string" ? data.busId : "";
    const routeId = typeof data.routeId === "string" ? data.routeId : "";
    if (!busId || !routeId) {
      res.status(422).json({ error: "This session has no active vehicle." });
      return;
    }

    const passengers = (data.passengers ?? {}) as Record<string, unknown>;
    const alreadyJoined =
      typeof passengers[uid] === "object" && passengers[uid] !== null;

    if (!validStops || !validName || (!alreadyJoined && !hasPosition)) {
      res.status(400).json({ error: "Invalid boarding details." });
      return;
    }

    if (!alreadyJoined) {
      // Proximity gate uses the ESP32 GNSS fix, not the client's location.
      const live = (
        await rtdb.ref(`activeBuses/${busId}_${routeId}`).once("value")
      ).val() as Record<string, unknown> | null;
      const fixTimestamp = Number(live?.timestamp);
      const busLat = Number(live?.lat);
      const busLng = Number(live?.lng);
      if (
        !Number.isFinite(busLat) ||
        !Number.isFinite(busLng) ||
        !Number.isFinite(fixTimestamp) ||
        Date.now() - fixTimestamp > MAX_JOIN_FIX_AGE_MS
      ) {
        res.status(409).json({
          error: "The bus position is unavailable right now; please try again.",
        });
        return;
      }
      const distanceM = haversineMeters(
        { lat: Number(lat), lng: Number(lng) },
        { lat: busLat, lng: busLng },
      );
      if (distanceM > JOIN_RADIUS_M) {
        res.status(403).json({ error: "You must be near the bus to board." });
        return;
      }
    }

    await sessionRef.update({
      [`passengers.${uid}`]: {
        userId: uid,
        userName,
        boardingStopId,
        alightingStopId: alightingStopId ?? null,
        joinedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.json({ joined: true, sessionId });
  } catch (error) {
    console.error("[Sessions] Failed to join ride:", error);
    res.status(500).json({ error: "Unable to join the ride." });
  }
});

export default router;
