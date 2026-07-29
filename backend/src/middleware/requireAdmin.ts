import { Request, Response, NextFunction } from "express";
import { verifyRevocationAwareIdToken } from "../services/authTokenVerifier";

/**
 * Express middleware that verifies a Firebase ID token from the Authorization header
 * and checks that the user has the `admin: true` custom claim.
 *
 * Usage:  router.post("/compute-polyline", requireAdmin, handler);
 *
 * Expected header:  Authorization: Bearer <Firebase ID Token>
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header." });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    const decoded = await verifyRevocationAwareIdToken(idToken);

    // Check for admin custom claim
    if (!decoded.admin) {
      res.status(403).json({ error: "Forbidden: Admin access required." });
      return;
    }

    // Attach user info to request for downstream handlers
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}
