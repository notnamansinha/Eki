import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import rateLimit from "express-rate-limit";
import { requireAdmin } from "../middleware/requireAdmin";
import { ipKeyGenerator } from "../lib/rateLimitIdentity";
import { readRateLimitShardFactor, shardedLimit } from "../lib/rateLimitShard";
import { db } from "../lib/firebaseAdmin";
import {
  ingestDeviceTelemetry,
  parseDeviceAuthorization,
  publishDeviceCredentialInvalidation,
  recordTelemetryRejection,
} from "../services/deviceTelemetryService";
import { parseTelemetryValue } from "../services/telemetryPayload";
import {
  ingestDeviceDiagnostics,
  parseDeviceDiagnosticsValue,
} from "../services/deviceDiagnostics";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
// This is the pre-auth DoS limit, so it must not trust a deviceId or Device
// header supplied by the caller. ingestDeviceTelemetry keeps the authoritative
// per-device budget after credential verification.
// Expected replica count for the in-memory pre-auth limiter below; the
// authoritative per-device budget after credential verification is the
// shared RTDB-based HTTPS_DEVICE_RATE_PER_MINUTE, which needs no
// sharding (issue #28).
const RATE_LIMIT_SHARD_FACTOR = readRateLimitShardFactor();
const telemetryLimiter = rateLimit({
  windowMs: 60_000,
  limit: shardedLimit(120, RATE_LIMIT_SHARD_FACTOR),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  handler: (_req, res, _next, options) => {
    const retryAfterMs = options.windowMs;
    res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    res.status(options.statusCode).json({
      error: "Telemetry request limit exceeded.",
      retryAfterMs,
    });
  },
});

/**
 * ESP32 devices send a closed six-field payload over certificate-verified
 * HTTPS. The device secret is transmitted only in the Authorization header,
 * compared against a scrypt verifier, and never returned or logged. Routing
 * identity comes exclusively from the server-side device registry.
 */
router.post(
  "/:deviceId/telemetry",
  telemetryLimiter,
  async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const deviceId = req.params.deviceId;
    const secret = parseDeviceAuthorization(req.get("authorization"));
    let encodedLength = Number.POSITIVE_INFINITY;
    try {
      encodedLength = Buffer.byteLength(JSON.stringify(req.body), "utf8");
    } catch {
      // parseTelemetryValue returns the generic shape error below.
    }
    const parsed =
      encodedLength <= 512
        ? parseTelemetryValue(req.body)
        : { ok: false as const, reason: "payload_size" };
    if (!SAFE_ID.test(deviceId) || !secret || !parsed.ok) {
      recordTelemetryRejection();
      const payloadTooLarge = !parsed.ok && parsed.reason === "payload_size";
      res.status(!secret ? 401 : payloadTooLarge ? 413 : 400).json({
        error: !secret
          ? "Invalid device credentials."
          : payloadTooLarge
            ? "Request body is too large."
            : "Invalid telemetry payload.",
      });
      return;
    }

    try {
      const result = await ingestDeviceTelemetry(
        deviceId,
        secret,
        parsed.value,
      );
      if (!result.ok) {
        if (result.reason === "rate_limit") {
          res.set(
            "Retry-After",
            String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
          );
          res.status(429).json({
            error: "Telemetry rate limit exceeded.",
            retryAfterMs: result.retryAfterMs,
          });
        } else {
          res.status(401).json({ error: "Invalid device credentials." });
        }
        return;
      }
      res.status(result.duplicate ? 200 : 202).json({
        accepted: true,
        duplicate: result.duplicate,
      });
    } catch (error) {
      recordTelemetryRejection();
      console.error("[Devices] HTTPS telemetry ingestion failed:", error);
      res.status(503).json({ error: "Telemetry service unavailable." });
    }
  },
);

router.post(
  "/:deviceId/diagnostics",
  telemetryLimiter,
  async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const deviceId = req.params.deviceId;
    const secret = parseDeviceAuthorization(req.get("authorization"));
    const parsed = parseDeviceDiagnosticsValue(req.body);
    if (!SAFE_ID.test(deviceId) || !secret || !parsed.ok) {
      res.status(!secret ? 401 : 400).json({
        error: !secret
          ? "Invalid device credentials."
          : "Invalid diagnostics payload.",
      });
      return;
    }
    try {
      const accepted = await ingestDeviceDiagnostics(
        deviceId,
        secret,
        parsed.value,
      );
      if (!accepted) {
        res.status(401).json({ error: "Invalid device credentials." });
        return;
      }
      res.status(202).json({ accepted: true });
    } catch (error) {
      console.error("[Devices] Diagnostics ingestion failed:", error);
      res.status(503).json({ error: "Diagnostics service unavailable." });
    }
  },
);

router.get(
  "/:deviceId/diagnostics",
  requireAdmin,
  async (req: Request, res: Response) => {
    const deviceId = req.params.deviceId;
    if (!SAFE_ID.test(deviceId)) {
      res.status(400).json({ error: "Invalid device ID." });
      return;
    }
    try {
      const snapshot = await db.collection("_device_diagnostics").doc(deviceId).get();
      if (!snapshot.exists) {
        res.status(404).json({ error: "No diagnostics have been received." });
        return;
      }
      res.set("Cache-Control", "no-store");
      res.json(snapshot.data());
    } catch (error) {
      console.error("[Devices] Diagnostics lookup failed:", error);
      res.status(503).json({ error: "Diagnostics service unavailable." });
    }
  },
);

router.put("/:deviceId", requireAdmin, async (req: Request, res: Response) => {
  const deviceId = req.params.deviceId;
  const busId = req.body?.busId;
  const routeId = req.body?.routeId;
  const enabled = req.body?.enabled !== false;
  if (
    !SAFE_ID.test(deviceId) ||
    typeof busId !== "string" ||
    !SAFE_ID.test(busId) ||
    typeof routeId !== "string" ||
    !SAFE_ID.test(routeId)
  ) {
    res.status(400).json({ error: "Invalid device, bus, or route ID." });
    return;
  }

  try {
    const deviceRef = db.collection("devices").doc(deviceId);
    const result = await db.runTransaction(async (transaction) => {
      const busRef = db.collection("buses").doc(busId);
      const routeRef = db.collection("routes").doc(routeId);
      const targetRideRef = db.collection("active_rides").doc(`${busId}_${routeId}`);
      const targetLockRef = db.collection("_active_bus_locks").doc(busId);
      const targetDevicesQuery = db.collection("devices")
        .where("busId", "==", busId)
        .where("routeId", "==", routeId);
      const [busDoc, routeDoc, existingDevice, targetRide, targetLock, targetDevices] =
        await Promise.all([
          transaction.get(busRef),
          transaction.get(routeRef),
          transaction.get(deviceRef),
          transaction.get(targetRideRef),
          transaction.get(targetLockRef),
          transaction.get(targetDevicesQuery),
        ]);
      const bus = busDoc.data();
      const assignedRoutes = Array.isArray(bus?.assignedRoutes)
        ? bus.assignedRoutes
        : typeof bus?.assignedRouteId === "string"
          ? [bus.assignedRouteId]
          : [];
      if (!busDoc.exists || !routeDoc.exists || !assignedRoutes.includes(routeId)) {
        return "invalid_assignment" as const;
      }

      const previous = existingDevice.data();
      const assignmentChanged =
        !existingDevice.exists ||
        previous?.busId !== busId ||
        previous?.routeId !== routeId;
      const targetOwnedByAnotherDevice = targetDevices.docs.some(
        (candidate) => candidate.id !== deviceId,
      );
      if (
        targetOwnedByAnotherDevice ||
        (assignmentChanged && (targetRide.exists || targetLock.exists))
      ) {
        return "target_conflict" as const;
      }

      if (
        existingDevice.exists &&
        assignmentChanged &&
        typeof previous?.busId === "string" &&
        typeof previous?.routeId === "string"
      ) {
        const [previousRide, previousLock] = await Promise.all([
          transaction.get(
            db.collection("active_rides").doc(`${previous.busId}_${previous.routeId}`),
          ),
          transaction.get(db.collection("_active_bus_locks").doc(previous.busId)),
        ]);
        if (previousRide.exists || previousLock.exists) {
          return "active_previous_ride" as const;
        }
      }

      transaction.set(
        deviceRef,
        { deviceId, busId, routeId, enabled, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return "saved" as const;
    });
    if (result === "invalid_assignment") {
      res.status(400).json({ error: "Device assignment must match an existing bus route." });
      return;
    }
    if (result === "target_conflict") {
      res.status(409).json({
        error: "The target bus route already has an active ride or registered device.",
      });
      return;
    }
    if (result === "active_previous_ride") {
      res.status(409).json({
        error: "An active ride device cannot be reassigned before the final stop.",
      });
      return;
    }
    await publishDeviceCredentialInvalidation(deviceId);
    res.json({ saved: true });
  } catch (error) {
    console.error("[Devices] Registry update failed:", error);
    res.status(500).json({ error: "Unable to update device registry." });
  }
});

router.post("/:deviceId/disable", requireAdmin, async (req: Request, res: Response) => {
  const deviceId = req.params.deviceId;
  if (!SAFE_ID.test(deviceId)) {
    res.status(400).json({ error: "Invalid device ID." });
    return;
  }
  try {
    await db.collection("devices").doc(deviceId).set(
      { enabled: false, disabledAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await publishDeviceCredentialInvalidation(deviceId);
    res.json({ disabled: true });
  } catch (error) {
    console.error("[Devices] Disable failed:", error);
    res.status(500).json({ error: "Unable to disable device." });
  }
});

export default router;
