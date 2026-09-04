import { Router } from "express";
import { db } from "../lib/firebaseAdmin";
import { requireAdmin } from "../middleware/requireAdmin";
import { singlePathParam } from "../lib/httpParams";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const ALLOWED_REQUEST_STATUSES = new Set<string>(["pending", "accepted", "completed", "cancelled"]);

// Passenger requests are backend-authoritative: clients have no write surface
// in firestore.rules (issues #72 + #73). Only this admin route manages
// lifecycle overrides through the Admin SDK.


// Admin patch completion override — SEC-10 fix: requires Firebase admin token
router.patch("/:id", requireAdmin, async (req, res) => {
  const id = singlePathParam(req.params.id);
  if (!SAFE_ID.test(id)) {
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
  const id = singlePathParam(req.params.id);
  if (!SAFE_ID.test(id)) {
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
