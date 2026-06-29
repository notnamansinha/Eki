import { Router, Request, Response } from "express";
import { db, auth } from "../lib/firebaseAdmin";
import bcrypt from "bcryptjs";

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

    // Validate input lengths to prevent abuse
    if (typeof deviceId !== "string" || deviceId.length > 128 ||
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
      authenticated = await bcrypt.compare(secret, deviceData.secretHash);
    } else if (deviceData.secret) {
      // Legacy plaintext comparison — remove once all devices are re-seeded
      authenticated = deviceData.secret === secret;
    }

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
router.post("/hash-secret", async (req: Request, res: Response): Promise<any> => {
  const { deviceId, plainSecret, adminSecret } = req.body;

  if (!process.env.ADMIN_API_SECRET || adminSecret !== process.env.ADMIN_API_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!deviceId || !plainSecret) {
    return res.status(400).json({ error: "Missing deviceId or plainSecret" });
  }

  try {
    const hashed = await bcrypt.hash(plainSecret, 12);
    await db.collection("devices").doc(deviceId).update({
      secretHash: hashed,
      // Keep old plaintext secret during transition — remove manually after verifying
    });
    return res.json({ success: true, message: `Secret hashed for device ${deviceId}` });
  } catch (err) {
    console.error("Hash-secret error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
