import type { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator as normalizeIpKey } from "express-rate-limit";

/**
 * Pre-auth rate limiting.
 *
 * A request header, URL parameter, or unsigned token payload is attacker
 * controlled until authentication has completed. This outer limiter therefore
 * always uses the normalized client IP. Routes needing an identity quota must
 * apply it after verified middleware has attached the principal to req.user.
 */
export function requestIpRateLimitKey(ip: string): string {
  return `ip:${normalizeIpKey(ip)}`;
}

export function ipKeyGenerator(req: Request): string {
  return requestIpRateLimitKey(req.ip ?? "unknown");
}

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
    keyGenerator: ipKeyGenerator,
  });
}
