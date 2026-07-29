import { Request, Response, NextFunction } from "express";
import { verifyRevocationAwareIdToken } from "../services/authTokenVerifier";

/**
 * Express middleware that verifies a Firebase ID token from the Authorization header.
 * Unlike requireAdmin, this allows any authenticated user (e.g. passengers, drivers).
 *
 * Usage:  router.get("/", requireAuth, handler);
 *
 * Expected header:  Authorization: Bearer <Firebase ID Token>
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header." });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    // Check revocation as well as signature/expiry. The shared verifier keeps
    // only a short hashed-token cache to avoid repeated Auth network trips.
    const decoded = await verifyRevocationAwareIdToken(idToken);
    
    // Attach user info to request for downstream handlers
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}
