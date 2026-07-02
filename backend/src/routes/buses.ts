import { Router } from "express";
import { activeBuses } from "../sockets/trackingGateway";
import { requireAdmin } from "../middleware/requireAdmin";
import type { TripState } from "../types";

const router = Router();

const ALLOWED_TRIP_STATES = new Set<TripState>([
  "pre_departure", "in_service", "completed", "maintenance",
]);

// GET all active buses snapshot for fleet overview
router.get("/", (_req, res) => {
  const busesArray = Array.from(activeBuses.values());
  res.json({ buses: busesArray });
});

// GET specific bus by ID
router.get("/:busId", (req, res) => {
  const { busId } = req.params;
  if (!busId || busId.length > 64) {
    res.status(400).json({ error: "Invalid busId" });
    return;
  }
  const bus = activeBuses.get(busId);
  if (bus) {
    res.json(bus);
  } else {
    res.status(404).json({ error: "Bus not found or inactive" });
  }
});

// PATCH bus tripState (admin override) — requires Firebase admin token
// Useful for manually forcing a bus into maintenance or resuming in_service.
router.patch("/:busId", requireAdmin, (req, res) => {
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

  const bus = activeBuses.get(busId);
  if (!bus) {
    res.status(404).json({ error: "Bus not found" });
    return;
  }

  bus.tripState = tripState;
  res.json(bus);
});

export default router;
