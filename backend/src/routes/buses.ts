import { Router } from "express";
import { rtdb } from "../lib/firebaseAdmin";
import { singleRouteParam } from "../lib/requestParams";
import { publicLiveBus } from "../services/liveBusProjection";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

// Live coordinates and lifecycle are read-only here. Device telemetry,
// ordered-stop progression, and completion have dedicated authoritative paths.
router.get("/", requireAuth, async (_req, res) => {
  try {
    const snapshot = await rtdb.ref("activeBuses").once("value");
    const data = snapshot.val() || {};
    res.json({ buses: Object.values(data).map(publicLiveBus).filter(Boolean) });
  } catch {
    res.status(500).json({ error: "Failed to fetch active buses" });
  }
});

router.get("/:busId", requireAuth, async (req, res) => {
  const busId = singleRouteParam(req.params.busId);
  if (busId === null || !SAFE_ID.test(busId)) {
    res.status(400).json({ error: "Invalid busId" });
    return;
  }

  try {
    const snapshot = await rtdb.ref("activeBuses")
      .orderByChild("busId")
      .equalTo(busId)
      .once("value");
    const data = snapshot.val();
    if (!data) {
      res.status(404).json({ error: "Bus not found or inactive" });
      return;
    }
    const bus = Object.values(data).map(publicLiveBus).find(Boolean);
    if (!bus) { res.status(404).json({ error: "Bus not found or inactive" }); return; }
    res.json(bus);
  } catch {
    res.status(500).json({ error: "Failed to fetch bus" });
  }
});

export default router;
