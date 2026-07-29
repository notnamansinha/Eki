import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import rateLimit from "express-rate-limit";
import { requireAdmin } from "../middleware/requireAdmin";
import { db } from "../lib/firebaseAdmin";
import {
  hashDeviceSecret,
  ingestDeviceTelemetry,
  invalidateDeviceCredentialCache,
  parseDeviceAuthorization,
} from "../services/deviceTelemetryService";
import { parseTelemetryValue } from "../services/telemetryPayload";

const router = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const telemetryLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Telemetry request limit exceeded." },
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
      res.set("Cache-Control", "no-store");
      res.status(!secret ? 401 : 400).json({
        error: !secret ? "Invalid device credentials." : "Invalid telemetry payload.",
      });
      return;
    }

    try {
      const result = await ingestDeviceTelemetry(
        deviceId,
        secret,
        parsed.value,
      );
      res.set("Cache-Control", "no-store");
      if (!result.ok) {
        if (result.reason === "rate_limit") {
          res.status(429).json({ error: "Telemetry rate limit exceeded." });
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
      console.error("[Devices] HTTPS telemetry ingestion failed:", error);
      res.status(503).json({ error: "Telemetry service unavailable." });
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
    const [busDoc, routeDoc, existingDevice] = await Promise.all([
      db.collection("buses").doc(busId).get(),
      db.collection("routes").doc(routeId).get(),
      deviceRef.get(),
    ]);
    const bus = busDoc.data();
    const assignedRoutes = Array.isArray(bus?.assignedRoutes)
      ? bus.assignedRoutes
      : typeof bus?.assignedRouteId === "string"
        ? [bus.assignedRouteId]
        : [];
    if (!busDoc.exists || !routeDoc.exists || !assignedRoutes.includes(routeId)) {
      res.status(400).json({ error: "Device assignment must match an existing bus route." });
      return;
    }
    const previous = existingDevice.data();
    if (
      existingDevice.exists &&
      (previous?.busId !== busId || previous?.routeId !== routeId) &&
      typeof previous?.busId === "string" &&
      typeof previous?.routeId === "string"
    ) {
      const activeRide = await db.collection("active_rides")
        .doc(`${previous.busId}_${previous.routeId}`)
        .get();
      if (activeRide.exists) {
        res.status(409).json({
          error: "An active ride device cannot be reassigned before the final stop.",
        });
        return;
      }
    }
    await deviceRef.set(
      { deviceId, busId, routeId, enabled, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    invalidateDeviceCredentialCache(deviceId);
    res.json({ saved: true });
  } catch (error) {
    console.error("[Devices] Registry update failed:", error);
    res.status(500).json({ error: "Unable to update device registry." });
  }
});

router.post("/hash-secret", requireAdmin, async (req: Request, res: Response) => {
  const { deviceId, plainSecret } = req.body;
  if (
    typeof deviceId !== "string" ||
    !SAFE_ID.test(deviceId) ||
    typeof plainSecret !== "string" ||
    plainSecret.length < 20 ||
    plainSecret.length > 512
  ) {
    res.status(400).json({ error: "Missing or invalid deviceId or plainSecret." });
    return;
  }

  try {
    const deviceRef = db.collection("devices").doc(deviceId);
    const doc = await deviceRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Device not found." });
      return;
    }

    await deviceRef.update({
      secretHash: await hashDeviceSecret(plainSecret),
      secret: FieldValue.delete(),
      credentialRotatedAt: FieldValue.serverTimestamp(),
    });
    invalidateDeviceCredentialCache(deviceId);
    res.json({ success: true });
  } catch (error) {
    console.error("[Devices] Secret inventory update failed:", error);
    res.status(500).json({ error: "Unable to update device credential inventory." });
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
    invalidateDeviceCredentialCache(deviceId);
    res.json({ disabled: true });
  } catch (error) {
    console.error("[Devices] Disable failed:", error);
    res.status(500).json({ error: "Unable to disable device." });
  }
});

export default router;
