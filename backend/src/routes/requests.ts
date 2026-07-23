import { Router } from "express";
import { db } from "../lib/firebaseAdmin";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();

const ALLOWED_REQUEST_STATUSES = new Set<string>(["pending", "accepted", "completed", "cancelled"]);

function isNonEmptyString(val: unknown, maxLen = 256): val is string {
  return typeof val === "string" && val.trim().length > 0 && val.length <= maxLen;
}

// Passenger requests must be created exclusively via the authenticated WebSocket (passenger:request)
// which strictly enforces Firebase UID verification (ARCH-04) and rate limiting (ARCH-05).


// Admin patch completion override — SEC-10 fix: requires Firebase admin token
router.patch("/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!isNonEmptyString(id, 128)) {
    res.status(400).json({ error: "Invalid request id" });
    return;
  }

  const { status } = req.body ?? {};
  if (!ALLOWED_REQUEST_STATUSES.has(status)) {
    res.status(400).json({
      error: `status must be one of: ${[...ALLOWED_REQUEST_STATUSES].join(", ")}`,
    });
    return;
  }

  try {
    const docRef = db.collection("passenger_requests").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    await docRef.update({ status });
    res.json({ id, ...doc.data(), status });
  } catch {
    res.status(500).json({ error: "Failed to update request" });
  }
});

// Cancel a request by ID — SEC-10 fix: requires Firebase admin token
router.delete("/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!isNonEmptyString(id, 128)) {
    res.status(400).json({ error: "Invalid request id" });
    return;
  }
  try {
    const docRef = db.collection("passenger_requests").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await docRef.delete();
    res.json({ message: "Deleted successfully" });
  } catch {
    res.status(500).json({ error: "Failed to delete request" });
  }
});

export default router;
