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
 * the combined budget across the fleet never exceeds the configured limit.
 * A deployment cannot use more replicas than a limiter's budget: allowing at
 * least one request on every replica in that case would silently exceed the
 * configured aggregate limit, so startup fails with a clear configuration
 * error instead. The edge load balancer/WAF remains the
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
 * Floors so the aggregate budget can never exceed the configured limit.
 * Throws when the replica count exceeds the budget: returning one request per
 * replica would otherwise violate the configured fleet-wide limit.
 */
export function shardedLimit(limit: number, replicas: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`Rate limit must be a positive integer, got ${limit}.`);
  }
  if (!Number.isSafeInteger(replicas) || replicas < 1) {
    throw new RangeError(`Replica count must be a positive integer, got ${replicas}.`);
  }
  if (replicas > limit) {
    throw new RangeError(
      `RATE_LIMIT_SHARD_FACTOR=${replicas} exceeds the ${limit}/minute limiter budget. ` +
        "Use a shared distributed rate limiter before scaling beyond that budget.",
    );
  }
  return Math.floor(limit / replicas);
}
