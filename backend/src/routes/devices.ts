import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { Router, type Request, type Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../middleware/requireAdmin";
import { db } from "../lib/firebaseAdmin";

const router = Router();
const scryptAsync = promisify(scrypt);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Device telemetry is MQTT-only. There is deliberately no browser/firmware
 * HTTP authentication endpoint and no Firebase device token minting endpoint.
 * The MQTT broker authenticates each device and limits it by ACL to:
 *   eki/v1/telemetry/<deviceId>
 *
 * This admin endpoint stores the application-side registry and a one-way
 * verifier for credential inventory/rotation checks. The broker credential
 * must also be provisioned in the broker's own secret store.
 */
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
    const [busDoc, routeDoc] = await Promise.all([
      db.collection("buses").doc(busId).get(),
      db.collection("routes").doc(routeId).get(),
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
    await db.collection("devices").doc(deviceId).set(
      { deviceId, busId, routeId, enabled, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
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

    const salt = randomBytes(16).toString("hex");
    const derivedKey = (await scryptAsync(plainSecret, salt, 64) as Buffer).toString("hex");
    await deviceRef.update({
      secretHash: `${salt}:${derivedKey}`,
      secret: FieldValue.delete(),
      credentialRotatedAt: FieldValue.serverTimestamp(),
    });
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
    res.json({ disabled: true });
  } catch (error) {
    console.error("[Devices] Disable failed:", error);
    res.status(500).json({ error: "Unable to disable device." });
  }
});

export default router;
