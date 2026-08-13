/**
 * Horizontal-scale rate limiting (issue #28).
 *
 * Every HTTP limiter in this backend uses an in-memory store, so a single
 * replica would normally enforce the full configured budget. With N replicas
 * behind a load balancer the aggregate budget would multiply by N and the
 * configured limits would mean nothing.
 *
 * `RATE_LIMIT_SHARD_FACTOR` lets operators divide every per-instance budget by
 * the expected replica count: each instance enforces floor(budget / N), so
 * the combined budget across the fleet never exceeds the configured limit no
 * matter how many replicas run. The edge load balancer/WAF remains the
 * authoritative global cap (see
 * docs/operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md).
 */

/**
 * Reads the expected replica count from `RATE_LIMIT_SHARD_FACTOR`.
 *
 * Defaults to 1 (single instance) and falls back to 1 on any malformed value
 * rather than failing closed on a typo'd environment variable.
 */
export function readRateLimitShardFactor(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.RATE_LIMIT_SHARD_FACTOR;
  if (raw === undefined || raw === "") return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.warn(
      `[RateLimit] Ignoring invalid RATE_LIMIT_SHARD_FACTOR=${JSON.stringify(raw)}; using 1.`,
    );
    return 1;
  }
  return parsed;
}

/**
 * Per-instance budget for a configured limit across `replicas` instances.
 *
 * Floors so the aggregate budget can never exceed the configured limit;
 * never returns 0 so a single instance always retains at least one request.
 */
export function shardedLimit(limit: number, replicas: number): number {
  return Math.max(1, Math.floor(limit / replicas));
}
