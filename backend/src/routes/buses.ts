import { Router } from "express";
import { rtdb } from "../lib/firebaseAdmin";
import { requireAdmin } from "../middleware/requireAdmin";
import { requireAuth } from "../middleware/requireAuth";
import type { TripState } from "../types";

const router = Router();

const ALLOWED_TRIP_STATES = new Set<TripState>([
  "pre_departure", "in_service", "completed", "maintenance",
]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

// GET all active buses snapshot for fleet overview
router.get("/", requireAuth, async (_req, res) => {
  try {
    const snapshot = await rtdb.ref("activeBuses").once("value");
    const data = snapshot.val() || {};
    res.json({ buses: Object.values(data) });
  } catch {
    res.status(500).json({ error: "Failed to fetch active buses" });
  }
});

// GET specific bus by ID
router.get("/:busId", requireAuth, async (req, res) => {
  const { busId } = req.params;
  if (!busId || busId.length > 64) {
    res.status(400).json({ error: "Invalid busId" });
    return;
  }
  
  try {
    // Because RTDB path is activeBuses/${busId}_${routeId}, we must search for the busId prefix
    const snapshot = await rtdb.ref("activeBuses").orderByChild("busId").equalTo(busId).once("value");
    const data = snapshot.val();
    if (data) {
      // Returns the first match (a bus should only be active on one route at a time)
      res.json(Object.values(data)[0]);
    } else {
      res.status(404).json({ error: "Bus not found or inactive" });
    }
  } catch {
    res.status(500).json({ error: "Failed to fetch bus" });
  }
});

router.patch("/:busId/:routeId", requireAdmin, async (req, res) => {
  const { busId, routeId } = req.params;
  if (!SAFE_ID.test(busId) || !SAFE_ID.test(routeId)) {
    res.status(400).json({ error: "Invalid bus or route ID." });
    return;
  }
  const patch: Record<string, number> = {};
  const { lat, lng, delayMinutes, currentStopIndex } = req.body ?? {};
  if (lat !== undefined || lng !== undefined) {
    if (
      typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180
    ) {
      res.status(400).json({ error: "Latitude and longitude must be valid coordinates." });
      return;
    }
    patch.lat = lat;
    patch.lng = lng;
  }
  if (delayMinutes !== undefined) {
    if (
      typeof delayMinutes !== "number" ||
      !Number.isFinite(delayMinutes) ||
      delayMinutes < 0 ||
      delayMinutes > 1440
    ) {
      res.status(400).json({ error: "Invalid delay." });
      return;
    }
    patch.delayMinutes = delayMinutes;
  }
  if (currentStopIndex !== undefined) {
    if (!Number.isInteger(currentStopIndex) || currentStopIndex < 0 || currentStopIndex > 10_000) {
      res.status(400).json({ error: "Invalid stop index." });
      return;
    }
    patch.currentStopIndex = currentStopIndex;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No supported fields were supplied." });
    return;
  }
  try {
    const nodeRef = rtdb.ref(`activeBuses/${busId}_${routeId}`);
    const existing = await nodeRef.once("value");
    if (!existing.exists()) {
      res.status(404).json({ error: "Active vehicle was not found." });
      return;
    }
    await nodeRef.update({ ...patch, timestamp: { ".sv": "timestamp" } });
    res.json({ saved: true });
  } catch (error) {
    console.error("[Buses] Admin override failed:", error);
    res.status(500).json({ error: "Unable to update vehicle." });
  }
});

router.post("/:busId/:routeId/offline", requireAdmin, async (req, res) => {
  const { busId, routeId } = req.params;
  if (!SAFE_ID.test(busId) || !SAFE_ID.test(routeId)) {
    res.status(400).json({ error: "Invalid bus or route ID." });
    return;
  }
  try {
    const nodeRef = rtdb.ref(`activeBuses/${busId}_${routeId}`);
    const result = await nodeRef.transaction((current) => {
      if (!current) return;
      return {
        ...current,
        status: "offline",
        deviceState: "offline",
        tripState: "completed",
        timestamp: { ".sv": "timestamp" },
      };
    });
    if (!result.committed) {
      res.status(404).json({ error: "Active vehicle was not found." });
      return;
    }
    res.json({ saved: true });
  } catch (error) {
    console.error("[Buses] Force-offline failed:", error);
    res.status(500).json({ error: "Unable to retire vehicle." });
  }
});

// PATCH bus tripState (admin override) — requires Firebase admin token
// Useful for manually forcing a bus into maintenance or resuming in_service.
router.patch("/:busId", requireAdmin, async (req, res) => {
  const { busId } = req.params;
  if (!busId || busId.length > 64) {
    res.status(400).json({ error: "Invalid busId" });
    return;
  }

  const { tripState } = req.body as { tripState?: TripState };

  if (!tripState || !ALLOWED_TRIP_STATES.has(tripState)) {
    res.status(400).json({
      error: `Invalid tripState. Must be one of: ${[...ALLOWED_TRIP_STATES].join(", ")}`,
    });
    return;
  }

  try {
    const snapshot = await rtdb.ref("activeBuses").orderByChild("busId").equalTo(busId).once("value");
    const data = snapshot.val();
    if (!data) {
      res.status(404).json({ error: "Bus not found" });
      return;
    }
    
    const nodeKey = Object.keys(data)[0];
    await rtdb.ref(`activeBuses/${nodeKey}`).update({ tripState });
    
    res.json({ ...(Object.values(data)[0] as object), tripState });
  } catch {
    res.status(500).json({ error: "Failed to update bus trip state" });
  }
});

export default router;
