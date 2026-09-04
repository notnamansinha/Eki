import { Router } from "express";
import { rtdb } from "../lib/firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { singlePathParam } from "../lib/httpParams";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

// Live coordinates and lifecycle are read-only here. Device telemetry,
// ordered-stop progression, and completion have dedicated authoritative paths.
router.get("/", requireAuth, async (_req, res) => {
  try {
    const snapshot = await rtdb.ref("activeBuses").once("value");
    const data = snapshot.val() || {};
    res.json({ buses: Object.values(data) });
  } catch {
    res.status(500).json({ error: "Failed to fetch active buses" });
  }
});

router.get("/:busId", requireAuth, async (req, res) => {
  const busId = singlePathParam(req.params.busId);
  if (!SAFE_ID.test(busId)) {
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
    res.json(Object.values(data)[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch bus" });
  }
});

export default router;
