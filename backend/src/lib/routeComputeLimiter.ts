import rateLimit from "express-rate-limit";
import { verifiedUserKeyGenerator } from "./rateLimitIdentity";
import { shardedLimit } from "./rateLimitShard";

/** Cheap stored reads cannot spend an administrator's billable mutation quota. */
export function createRouteComputeLimiter(shardFactor: number) {
  return rateLimit({
    windowMs: 60_000,
    limit: shardedLimit(10, shardFactor),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: verifiedUserKeyGenerator,
    message: { error: "Route computation rate limit exceeded." },
    skip: req => req.method === "GET" || req.method === "HEAD",
  });
}
