import type { Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";

/**
 * Rate-limit bucket resolution.
 *
 * Rate limiters keyed on raw client IP break behind campus NAT: every phone
 * and bus behind one egress IP shares a single budget (issue #74). These
 * helpers resolve a bucket key from the authenticated identity a request
 * already carries — the Firebase uid for browsers, the deviceId for hardware
 * ingress — and fall back to the client IP only when no identity is claimed.
 */

const SAFE_IDENTITY = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_TOKEN_CHARS = 4096;

function decodeBase64Url(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Cheaply extracts the Firebase uid from a Bearer ID token WITHOUT verifying
 * the signature or expiry. Rate limiting only needs a stable bucket label;
 * `requireAuth` performs real verification before any handler runs. Returns
 * null when no usable identity is present, so callers fall back to IP.
 */
export function bearerTokenUid(authorization: string | undefined): string | null {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  if (token.length === 0 || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = decodeBase64Url(parts[1]);
  if (!payload) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;

  const record = claims as Record<string, unknown>;
  const uid = record.uid ?? record.sub;
  return typeof uid === "string" && SAFE_IDENTITY.test(uid) ? uid : null;
}

/** Bucket key for browser endpoints: authenticated uid when signed in, IP otherwise. */
export function identityRateLimitKey(
  authorization: string | undefined,
  ip: string,
): string {
  const uid = bearerTokenUid(authorization);
  return uid ? `uid:${uid}` : `ip:${ip}`;
}

/** Bucket key for hardware ingress: claimed deviceId when a Device secret is presented, IP otherwise. */
export function deviceIngressRateLimitKey(
  deviceId: string | undefined,
  authorization: string | undefined,
  ip: string,
): string {
  const presentsDeviceSecret = authorization?.startsWith("Device ") === true;
  if (presentsDeviceSecret && typeof deviceId === "string" && SAFE_IDENTITY.test(deviceId)) {
    return `device:${deviceId}`;
  }
  return `ip:${ip}`;
}

/** Express keyGenerator for browser-facing limiters. */
export function identityKeyGenerator(req: Request): string {
  return identityRateLimitKey(req.headers.authorization, req.ip ?? "unknown");
}

/** Express keyGenerator for the device ingress limiter. */
export function deviceIngressKeyGenerator(req: Request): string {
  return deviceIngressRateLimitKey(
    req.params.deviceId,
    req.headers.authorization,
    req.ip ?? "unknown",
  );
}

/**
 * Rate limiter for browser-facing endpoints that keys on the authenticated
 * uid (falling back to IP for anonymous traffic), so a classroom sharing one
 * campus IP never exhausts a single shared budget.
 */
export function createIdentityAwareLimiter(options: {
  windowMs: number;
  limit: number;
  message: { error: string };
  skip?: (req: Request) => boolean;
}): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: options.message,
    ...(options.skip ? { skip: options.skip } : {}),
    keyGenerator: identityKeyGenerator,
  });
}
