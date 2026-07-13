import { Router } from "express";
import { rtdb } from "../lib/firebaseAdmin";
import { requireAdmin } from "../middleware/requireAdmin";
import type { TripState } from "../types";

const router = Router();

const ALLOWED_TRIP_STATES = new Set<TripState>([
  "pre_departure", "in_service", "completed", "maintenance",
]);

// GET all active buses snapshot for fleet overview
router.get("/", async (_req, res) => {
  try {
    const snapshot = await rtdb.ref("activeBuses").once("value");
    const data = snapshot.val() || {};
    res.json({ buses: Object.values(data) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch active buses" });
  }
});

// GET specific bus by ID
router.get("/:busId", async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bus" });
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
  } catch (err) {
    res.status(500).json({ error: "Failed to update bus trip state" });
  }
});

export default router;
