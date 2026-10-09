import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getAppCheck } from "firebase-admin/app-check";
import { firebaseAdminApp } from "../lib/firebaseAdmin";
import { createBoundedSingleFlight } from "../lib/boundedSingleFlight";

const verifications = createBoundedSingleFlight<void>({ maxFills: 64, maxWaitersPerFill: 32, responseMs: 2000 });
const invalidCodes = new Set(["app-check/invalid-argument", "app-check/invalid-token", "app-check/app-check-token-expired"]);
export function requiresBrowserAttestation(method: string, path: string): boolean {
  if (method === "OPTIONS" || method === "HEAD") return false;
  if ((method === "POST" && /^\/api\/devices\/[A-Za-z0-9_-]{1,128}\/(telemetry|diagnostics)$/.test(path)) ||
      (method === "GET" && /^\/api\/devices\/[A-Za-z0-9_-]{1,128}\/firmware$/.test(path))) return false;
  return !["GET", "HEAD"].includes(method) || /^\/api\/(places|plan|routes)(\/|$)/.test(path) ||
    /^\/api\/v2\/routes\/[A-Za-z0-9_-]{1,128}\/geometry(\/|$)/.test(path);
}
/** Opt-in staged API enforcement; bearer identity/RBAC and device auth remain independent. */
export function createBrowserAppCheck(mode = process.env.API_APPCHECK_MODE ?? "off") {
  if (mode !== "off" && mode !== "enforce") throw new Error("API_APPCHECK_MODE must be off or enforce.");
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (mode === "off" || !requiresBrowserAttestation(req.method, req.originalUrl.split("?")[0])) { next(); return; }
    const token = req.get("X-Firebase-AppCheck");
    res.set("Cache-Control", "no-store");
    if (!token || token.length > 8192) {
      res.status(403).json({ error: "App verification is required.", code: "APP_CHECK_REQUIRED", phase: "authentication" });
      return;
    }
    try {
      const key = createHash("sha256").update(token).digest("hex");
      await verifications.run(key, key, async () => { await getAppCheck(firebaseAdminApp).verifyToken(token); });
      next();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      const denied = invalidCodes.has(code);
      if (!denied) res.set("Retry-After", "1");
      res.status(denied ? 403 : 503).json({ error: denied ? "App verification was rejected." : "App verification is unavailable. Retry shortly.",
        code: denied ? "APP_CHECK_REJECTED" : "APP_CHECK_UNAVAILABLE", phase: "authentication" });
    }
  };
}
