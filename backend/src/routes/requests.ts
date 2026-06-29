import { Router } from "express";
import { pendingRequests } from "../sockets/trackingGateway";
import { requireAdmin } from "../middleware/requireAdmin";
import type { PassengerRequest } from "../types";

const router = Router();

const ALLOWED_REQUEST_TYPES = new Set<string>(["pickup", "dropoff"]);
const ALLOWED_REQUEST_STATUSES = new Set<string>(["pending", "accepted", "completed", "cancelled"]);

function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" && isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === "number" && isFinite(lng) && lng >= -180 && lng <= 180
  );
}

function isNonEmptyString(val: unknown, maxLen = 256): val is string {
  return typeof val === "string" && val.trim().length > 0 && val.length <= maxLen;
}

// ── TTL eviction: sweep completed/cancelled requests older than 30 minutes ──
// Runs every 5 minutes to prevent unbounded Map growth on long-running containers.
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes ago
  let evicted = 0;
  for (const [id, req] of pendingRequests) {
    if (req.createdAt < cutoff) {
      pendingRequests.delete(id);
      evicted++;
    }
  }
  if (evicted > 0) {
    console.log(`[Requests] TTL eviction: removed ${evicted} completed/cancelled requests`);
  }
}, 5 * 60 * 1000);

// NOTE: The unauthenticated POST / and GET / routes have been removed to close a major DoS vulnerability.
// Passenger requests must be created exclusively via the authenticated WebSocket (passenger:request)
// which strictly enforces Firebase UID verification (ARCH-04) and rate limiting (ARCH-05).


// Admin patch completion override — SEC-10 fix: requires Firebase admin token
router.patch("/:id", requireAdmin, (req, res) => {
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

  const pReq = pendingRequests.get(id);
  if (!pReq) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  pReq.status = status;
  res.json(pReq);
});

// Cancel a request by ID — SEC-10 fix: requires Firebase admin token
router.delete("/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  if (!isNonEmptyString(id, 128)) {
    res.status(400).json({ error: "Invalid request id" });
    return;
  }
  if (pendingRequests.has(id)) {
    pendingRequests.delete(id);
    res.json({ message: "Deleted successfully" });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

export default router;
