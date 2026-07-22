import { Router, Request, Response } from "express";
import { db, auth } from "../lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();

/**
 * POST /api/devices/auth
 *
 * Authenticates an ESP32 hardware device using deviceId + secret.
 * Returns a Firebase Custom Token valid for 1 hour.
 *
 * Security hardening applied:
 *  1. The custom token includes `deviceId` as a claim so RTDB rules can
 *     lock writes to /activeBuses/<deviceId>_* paths only.
 *  2. Secrets are compared using bcrypt (timing-safe). Plaintext fallback
 *     is preserved during migration window; re-seed devices to use hashes.
 */
router.post("/auth", async (req: Request, res: Response): Promise<any> => {
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
    // Prefer bcrypt hash comparison (secretHash field).
    // Fall back to plaintext comparison if secretHash is not yet set
    // (migration window — re-seed devices with hashed secrets when possible).
    let authenticated = false;
    if (deviceData.secretHash) {
      const parts = deviceData.secretHash.split(":");
      if (parts.length === 2) {
        const [salt, key] = parts;
        const derivedKey = scryptSync(secret, salt, 64);
        const storedKey = Buffer.from(key, "hex");
        if (derivedKey.length === storedKey.length) {
          authenticated = timingSafeEqual(derivedKey, storedKey);
        }
      }
    }

    // Plaintext device credentials are deliberately rejected.
      // Legacy plaintext comparison — remove once all devices are re-seeded
    // Legacy plaintext values are not accepted.

    if (!authenticated) {
      return res.status(401).json({ error: "Invalid device credentials" });
    }

    // ── Mint Custom Token with deviceId claim ─────────────────────────────
    // The `deviceId` claim is checked in RTDB rules:
    //   $busKey.matches(auth.token.deviceId + '_.*')
    // This prevents a compromised bus_02 from overwriting bus_01's RTDB path.
    const customToken = await auth.createCustomToken(deviceId, {
      role: "device",
      deviceId: deviceId,  // Injected for RTDB path-level isolation
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
 * Body: { deviceId, adminSecret }
 * (Protected by ADMIN_API_SECRET — not exposed publicly)
 */
router.post("/hash-secret", requireAdmin, async (req: Request, res: Response): Promise<any> => {
  const { deviceId, plainSecret } = req.body;

  if (typeof deviceId !== "string" || !plainSecret || typeof plainSecret !== "string" || plainSecret.length > 512) {
    return res.status(400).json({ error: "Missing or invalid deviceId or plainSecret" });
  }

  try {
    const deviceRef = db.collection("devices").doc(deviceId);
    const doc = await deviceRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: "Device not found" });
    }

    const salt = randomBytes(16).toString("hex");
    const derivedKey = scryptSync(plainSecret, salt, 64).toString("hex");
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
