import type { Request } from "express";
import { authorizationIsCurrent } from "../services/userAuthorization";

const checks = new WeakMap<Request, Promise<boolean>>();

/**
 * Whether the request carries current administrator authority: the requireAdmin
 * policy (both admin claims and a published authorizationVersion that is still
 * current in both databases) for handlers that also serve operators or
 * passengers. A stale, legacy or partial admin token is not an administrator.
 * Memoized per request; rejects when the authorization records cannot be read.
 */
export function hasCurrentAdminAuthority(req: Request): Promise<boolean> {
  const existing = checks.get(req);
  if (existing) return existing;
  const user = req.user;
  const check = user?.admin === true && user.role === "admin" && typeof user.authorizationVersion === "string"
    ? authorizationIsCurrent(user.uid, user as Record<string, unknown>)
    : Promise.resolve(false);
  checks.set(req, check);
  return check;
}
