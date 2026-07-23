import { Router, Request, Response } from "express";
import { db, auth } from "../lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import rateLimit from "express-rate-limit";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();
const scryptAsync = promisify(scrypt);
const deviceAuthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many device authentication attempts. Please retry shortly." },
});

/**
 * POST /api/devices/auth
 *
 * Authenticates an ESP32 hardware device using deviceId + secret.
 * Returns a Firebase Custom Token valid for 1 hour.
 *
 * Security hardening applied:
 *  1. The custom token includes `deviceId` as a claim so RTDB rules can
 *     lock writes to /activeBuses/<deviceId>_* paths only.
 *  2. Secrets are derived with scrypt and compared in constant time.
 *     Plaintext credentials are never accepted.
 */
router.post("/auth", deviceAuthLimiter, async (req: Request, res: Response): Promise<any> => {
  try {
    const { deviceId, secret } = req.body;

    if (!deviceId || !secret) {
      return res.status(400).json({ error: "Missing deviceId or secret" });
    }

    // Validate input lengths and characters to prevent path injection abuse
    if (typeof deviceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId) ||
        typeof secret !== "string" || secret.length > 512) {
      return res.status(400).json({ error: "Invalid deviceId or secret format" });
    }

    const deviceDoc = await db.collection("devices").doc(deviceId).get();

    if (!deviceDoc.exists) {
      // Use same error message as wrong secret to prevent device enumeration
      return res.status(401).json({ error: "Invalid device credentials" });
    }

    const deviceData = deviceDoc.data()!;

    // ── Secret verification ────────────────────────────────────────────────
    // Verify the scrypt-derived secretHash value.
    let authenticated = false;
    if (deviceData.secretHash) {
      const parts = deviceData.secretHash.split(":");
      if (parts.length === 2) {
        const [salt, key] = parts;
        const derivedKey = await scryptAsync(secret, salt, 64) as Buffer;
        const storedKey = Buffer.from(key, "hex");
        if (derivedKey.length === storedKey.length) {
          authenticated = timingSafeEqual(derivedKey, storedKey);
        }
      }
    }

    if (!authenticated) {
      return res.status(401).json({ error: "Invalid device credentials" });
    }

    // ── Mint Custom Token with deviceId claim ─────────────────────────────
    // The `deviceId` claim is checked in RTDB rules:
    //   $busKey.matches(auth.token.deviceId + '_.*')
    // This prevents a compromised bus_02 from overwriting bus_01's RTDB path.
    const assignedRouteId = deviceData.routeId;
    if (typeof assignedRouteId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(assignedRouteId)) {
      console.error(`Device ${deviceId} has no valid routeId assignment.`);
      return res.status(403).json({ error: "Device is not assigned to a valid route" });
    }

    const customToken = await auth.createCustomToken(deviceId, {
      role: "device",
      deviceId,
      routeId: assignedRouteId,
    });

    return res.json({ token: customToken, expiresIn: 3600 });
  } catch (error) {
    console.error("Device auth error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/devices/hash-secret
 *
 * Utility endpoint (admin-only) to hash a plaintext secret and update the
 * device document. Call this once per device to migrate from plaintext secrets.
 *
 * Body: { deviceId, plainSecret }
 * Protected by a verified Firebase administrator ID token.
 */
router.post("/hash-secret", requireAdmin, async (req: Request, res: Response): Promise<any> => {
  const { deviceId, plainSecret } = req.body;

  if (typeof deviceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId) ||
      typeof plainSecret !== "string" || plainSecret.length < 16 || plainSecret.length > 512) {
    return res.status(400).json({ error: "Missing or invalid deviceId or plainSecret" });
  }

  try {
    const deviceRef = db.collection("devices").doc(deviceId);
    const doc = await deviceRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: "Device not found" });
    }

    const salt = randomBytes(16).toString("hex");
    const derivedKey = (await scryptAsync(plainSecret, salt, 64) as Buffer).toString("hex");
    const hashed = `${salt}:${derivedKey}`;
    await deviceRef.update({
      secretHash: hashed,
      // Securely delete the plaintext credential from the database after migration
      secret: FieldValue.delete(),
    });
    return res.json({ success: true, message: `Secret hashed for device ${deviceId}` });
  } catch (err) {
    console.error("Hash-secret error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
