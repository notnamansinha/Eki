import { Router } from "express";
import { activeBuses } from "../sockets/trackingGateway";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();

const ALLOWED_STATUSES = new Set(["active", "idle", "maintenance"]);

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

// PATCH bus status (admin override) — SEC-09 fix: requires Firebase admin token
router.patch("/:busId", requireAdmin, (req, res) => {
  const { busId } = req.params;
  if (!busId || busId.length > 64) {
    res.status(400).json({ error: "Invalid busId" });
    return;
  }

  const { status } = req.body;

  // Allowlist validation — only accept known status strings
  if (!status || !ALLOWED_STATUSES.has(status)) {
    res.status(400).json({
      error: `Invalid status. Must be one of: ${[...ALLOWED_STATUSES].join(", ")}`,
    });
    return;
  }

  const bus = activeBuses.get(busId);
  if (!bus) {
    res.status(404).json({ error: "Bus not found" });
    return;
  }

  bus.status = status;
  res.json(bus);
});

export default router;
