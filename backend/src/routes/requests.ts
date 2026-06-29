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
    if (req.status !== "pending" && req.createdAt < cutoff) {
      pendingRequests.delete(id);
      evicted++;
    }
  }
  if (evicted > 0) {
    console.log(`[Requests] TTL eviction: removed ${evicted} completed/cancelled requests`);
  }
}, 5 * 60 * 1000);

// Create new external pickup request over HTTP
router.post("/", (req, res) => {
  const { passengerId, busId, type, lat, lng } = req.body ?? {};

  // ── Input Validation ──
  if (!isNonEmptyString(passengerId)) {
    res.status(400).json({ error: "passengerId must be a non-empty string" });
    return;
  }
  if (!isNonEmptyString(busId)) {
    res.status(400).json({ error: "busId must be a non-empty string" });
    return;
  }
  if (!ALLOWED_REQUEST_TYPES.has(type)) {
    res.status(400).json({ error: "type must be 'pickup' or 'dropoff'" });
    return;
  }
  if (!isValidLatLng(lat, lng)) {
    res.status(400).json({ error: "lat/lng must be valid finite numbers in range" });
    return;
  }

  // ── Idempotency key: one request per passenger per bus per minute ──
  // Prevents request flooding from rapid-tapping passengers or frontend retries.
  const idempotencyWindow = Math.floor(Date.now() / 60_000); // 1-minute bucket
  const idempotencyKey = `${passengerId}:${busId}:${idempotencyWindow}`;

  // Check if an identical request was already submitted in this window
  const existingRequest = Array.from(pendingRequests.values()).find(
    (r) => (r as any).idempotencyKey === idempotencyKey
  );
  if (existingRequest) {
    // Return the existing request — idempotent success
    res.status(200).json(existingRequest);
    return;
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const newRequest: PassengerRequest & { idempotencyKey: string } = {
    requestId,
    passengerId,
    busId,
    type,
    lat,
    lng,
    status: "pending",
    createdAt: Date.now(),
    idempotencyKey, // Stored for deduplication lookups
  };

  pendingRequests.set(requestId, newRequest);
  res.status(201).json(newRequest);
});

// List all currently pending requests for admin view tracking
// ARCH-09 fix: no caching — this is live state
router.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const reqArray = Array.from(pendingRequests.values());
  res.json({ requests: reqArray });
});

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
