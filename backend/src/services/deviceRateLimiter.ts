import { readRateLimitShardFactor } from "../lib/rateLimitShard";

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 90;
const DEFAULT_LEASE_SIZE = 5;
const DEFAULT_MAX_TRACKED_DEVICES = 1_000;

export interface RateBucket {
  startedAt: number;
  count: number;
}

export interface DeviceRateLimitDecision {
  allowed: boolean;
  next: RateBucket;
  retryAfterMs: number;
}

export interface TokenReservationDecision {
  granted: number;
  next: RateBucket;
  retryAfterMs: number;
}

export interface DistributedTokenReservation {
  granted: number;
  expiresAt: number;
  retryAfterMs: number;
  transactionAttempts: number;
}

export type DistributedTokenAllocator = (
  deviceId: string,
  now: number,
  limit: number,
  requested: number,
) => Promise<DistributedTokenReservation>;

export interface DeviceRateLimitConfiguration {
  mode: "local" | "distributed";
  limit: number;
  leaseSize: number;
  maxTrackedDevices: number;
  replicas: number;
}

export interface DeviceRateLimitResult {
  retryAfterMs: number | null;
  source: "local" | "lease" | "reservation";
  reservedTokens: number;
  transactionAttempts: number;
}

interface LocalTokenLease {
  expiresAt: number;
  remaining: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validBucket(value: Readonly<RateBucket> | undefined, now: number): RateBucket | undefined {
  return value &&
    Number.isFinite(value.startedAt) &&
    value.startedAt <= now &&
    Number.isSafeInteger(value.count) &&
    value.count >= 0
      ? { startedAt: value.startedAt, count: value.count }
      : undefined;
}

export function readDeviceRateLimitConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): DeviceRateLimitConfiguration {
  const replicas = readRateLimitShardFactor(env);
  const rawMode = env.HTTPS_DEVICE_RATE_LIMIT_MODE?.trim().toLowerCase();
  if (rawMode !== undefined && rawMode !== "" && rawMode !== "local" && rawMode !== "distributed") {
    throw new Error(
      "HTTPS_DEVICE_RATE_LIMIT_MODE must be either local or distributed.",
    );
  }
  const mode = rawMode === "local" ? "local" : "distributed";
  if (mode === "local" && env.RATE_LIMIT_SHARD_FACTOR?.trim() !== "1") {
    throw new Error(
      "HTTPS_DEVICE_RATE_LIMIT_MODE=local requires explicit RATE_LIMIT_SHARD_FACTOR=1.",
    );
  }
  const limit = positiveInteger(env.HTTPS_DEVICE_RATE_PER_MINUTE, DEFAULT_LIMIT);
  const configuredLeaseSize = positiveInteger(
    env.HTTPS_DEVICE_RATE_LIMIT_LEASE_SIZE,
    DEFAULT_LEASE_SIZE,
  );
  return {
    mode,
    limit,
    leaseSize: Math.min(configuredLeaseSize, limit),
    maxTrackedDevices: DEFAULT_MAX_TRACKED_DEVICES,
    replicas,
  };
}

export function evaluateDeviceRateLimit(
  existing: Readonly<RateBucket> | undefined,
  now: number,
  limit: number,
): DeviceRateLimitDecision {
  const current = validBucket(existing, now);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    return {
      allowed: true,
      next: { startedAt: now, count: 1 },
      retryAfterMs: 0,
    };
  }
  const next = { startedAt: current.startedAt, count: current.count + 1 };
  const allowed = next.count <= limit;
  return {
    allowed,
    next,
    retryAfterMs: allowed ? 0 : Math.max(1, WINDOW_MS - (now - current.startedAt)),
  };
}

export function reserveRateLimitTokens(
  existing: Readonly<RateBucket> | undefined,
  now: number,
  limit: number,
  requested: number,
): TokenReservationDecision {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("Device rate limit must be a positive integer.");
  }
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new RangeError("Requested token count must be a positive integer.");
  }
  const valid = validBucket(existing, now);
  const current = !valid || now - valid.startedAt >= WINDOW_MS
    ? { startedAt: now, count: 0 }
    : valid;
  const granted = Math.min(requested, Math.max(0, limit - current.count));
  return {
    granted,
    next: { startedAt: current.startedAt, count: current.count + granted },
    retryAfterMs:
      granted > 0 ? 0 : Math.max(1, WINDOW_MS - (now - current.startedAt)),
  };
}

function setBounded<T>(map: Map<string, T>, key: string, value: T, maximum: number): void {
  if (!map.has(key) && map.size >= maximum) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
  map.set(key, value);
}

/**
 * Authenticated per-device limiter. Distributed mode reserves bounded token
 * blocks from a shared store, then consumes them locally. Unused tokens can
 * reduce availability until the fixed window ends, but can never increase the
 * configured fleet-wide budget.
 */
export class AuthenticatedDeviceRateLimiter {
  private readonly localBuckets = new Map<string, RateBucket>();
  private readonly localLeases = new Map<string, LocalTokenLease>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly configuration: DeviceRateLimitConfiguration,
    private readonly allocateDistributed?: DistributedTokenAllocator,
  ) {
    if (
      !Number.isSafeInteger(configuration.limit) ||
      configuration.limit < 1 ||
      !Number.isSafeInteger(configuration.leaseSize) ||
      configuration.leaseSize < 1 ||
      configuration.leaseSize > configuration.limit ||
      !Number.isSafeInteger(configuration.maxTrackedDevices) ||
      configuration.maxTrackedDevices < 1
    ) {
      throw new Error("Device rate-limit configuration is invalid.");
    }
    if (configuration.mode === "local" && configuration.replicas !== 1) {
      throw new Error("Local device rate limiting requires exactly one replica.");
    }
    if (configuration.mode === "distributed" && !allocateDistributed) {
      throw new Error("Distributed device rate limiting requires a shared token allocator.");
    }
  }

  async consume(deviceId: string, now: number): Promise<DeviceRateLimitResult> {
    const previous = this.pending.get(deviceId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.consumeUnlocked(deviceId, now));
    const tracked = operation.then(() => undefined, () => undefined);
    this.pending.set(deviceId, tracked);
    try {
      return await operation;
    } finally {
      if (this.pending.get(deviceId) === tracked) this.pending.delete(deviceId);
    }
  }

  private async consumeUnlocked(
    deviceId: string,
    now: number,
  ): Promise<DeviceRateLimitResult> {
    if (this.configuration.mode === "local") {
      if (!this.localBuckets.has(deviceId)) {
        for (const [trackedId, bucket] of this.localBuckets) {
          if (now - bucket.startedAt >= WINDOW_MS) this.localBuckets.delete(trackedId);
        }
        if (this.localBuckets.size >= this.configuration.maxTrackedDevices) {
          const retryAfterMs = Math.min(...[...this.localBuckets.values()].map(
            (bucket) => Math.max(1, WINDOW_MS - (now - bucket.startedAt)),
          ));
          return {
            retryAfterMs,
            source: "local",
            reservedTokens: 0,
            transactionAttempts: 0,
          };
        }
      }
      const decision = evaluateDeviceRateLimit(
        this.localBuckets.get(deviceId),
        now,
        this.configuration.limit,
      );
      this.localBuckets.set(deviceId, decision.next);
      return {
        retryAfterMs: decision.allowed ? null : decision.retryAfterMs,
        source: "local",
        reservedTokens: 0,
        transactionAttempts: 0,
      };
    }

    const lease = this.localLeases.get(deviceId);
    if (lease && lease.expiresAt > now && lease.remaining > 0) {
      lease.remaining -= 1;
      return {
        retryAfterMs: null,
        source: "lease",
        reservedTokens: 0,
        transactionAttempts: 0,
      };
    }
    if (lease) this.localLeases.delete(deviceId);

    const reservation = await this.allocateDistributed!(
      deviceId,
      now,
      this.configuration.limit,
      this.configuration.leaseSize,
    );
    if (
      !Number.isSafeInteger(reservation.granted) ||
      reservation.granted < 0 ||
      reservation.granted > this.configuration.leaseSize ||
      !Number.isSafeInteger(reservation.transactionAttempts) ||
      reservation.transactionAttempts < 1
    ) {
      throw new Error("Distributed device limiter returned an invalid token grant.");
    }
    if (reservation.granted === 0) {
      if (!Number.isFinite(reservation.retryAfterMs) || reservation.retryAfterMs < 1) {
        throw new Error("Distributed device limiter returned an invalid retry delay.");
      }
      return {
        retryAfterMs: Math.max(1, reservation.retryAfterMs),
        source: "reservation",
        reservedTokens: 0,
        transactionAttempts: reservation.transactionAttempts,
      };
    }
    if (!Number.isFinite(reservation.expiresAt) || reservation.expiresAt <= now) {
      throw new Error("Distributed device limiter returned an expired token lease.");
    }
    setBounded(
      this.localLeases,
      deviceId,
      {
        expiresAt: reservation.expiresAt,
        remaining: reservation.granted - 1,
      },
      this.configuration.maxTrackedDevices,
    );
    return {
      retryAfterMs: null,
      source: "reservation",
      reservedTokens: reservation.granted,
      transactionAttempts: reservation.transactionAttempts,
    };
  }
}
