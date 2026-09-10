import { describe, expect, it } from "vitest";
import {
  AuthenticatedDeviceRateLimiter,
  readDeviceRateLimitConfiguration,
  reserveRateLimitTokens,
  type DistributedTokenAllocator,
  type RateBucket,
} from "./deviceRateLimiter";

describe("device rate-limit configuration", () => {
  it("uses shared enforcement unless local mode is explicitly configured", () => {
    expect(readDeviceRateLimitConfiguration({}).mode).toBe("distributed");
    expect(readDeviceRateLimitConfiguration({
      HTTPS_DEVICE_RATE_LIMIT_MODE: "local",
      RATE_LIMIT_SHARD_FACTOR: "1",
    }).mode).toBe("local");
  });

  it("rejects local mode when the deployment is not explicitly one replica", () => {
    expect(() => readDeviceRateLimitConfiguration({
      HTTPS_DEVICE_RATE_LIMIT_MODE: "local",
    })).toThrow(/explicit RATE_LIMIT_SHARD_FACTOR=1/);
    expect(() => readDeviceRateLimitConfiguration({
      HTTPS_DEVICE_RATE_LIMIT_MODE: "local",
      RATE_LIMIT_SHARD_FACTOR: "2",
    })).toThrow(/explicit RATE_LIMIT_SHARD_FACTOR=1/);
  });
});

describe("distributed device token reservations", () => {
  it("never allocates beyond the shared fixed-window budget", () => {
    const startedAt = 1_000_000;
    expect(reserveRateLimitTokens(
      { startedAt, count: 88 },
      startedAt + 10_000,
      90,
      5,
    )).toEqual({
      granted: 2,
      next: { startedAt, count: 90 },
      retryAfterMs: 0,
    });
    expect(reserveRateLimitTokens(
      { startedAt, count: 90 },
      startedAt + 10_001,
      90,
      5,
    )).toEqual({
      granted: 0,
      next: { startedAt, count: 90 },
      retryAfterMs: 49_999,
    });
  });

  it("shares one authoritative budget across replicas with one transaction per lease", async () => {
    let bucket: RateBucket | undefined;
    let transactionCount = 0;
    let allocationChain = Promise.resolve();
    const allocator: DistributedTokenAllocator = async (_deviceId, now, limit, requested) => {
      let result!: ReturnType<typeof reserveRateLimitTokens>;
      const operation = allocationChain.then(() => {
        transactionCount += 1;
        result = reserveRateLimitTokens(bucket, now, limit, requested);
        bucket = result.next;
      });
      allocationChain = operation.catch(() => undefined);
      await operation;
      return {
        granted: result.granted,
        expiresAt: result.next.startedAt + 60_000,
        retryAfterMs: result.retryAfterMs,
        transactionAttempts: 1,
      };
    };
    const configuration = {
      mode: "distributed" as const,
      limit: 90,
      leaseSize: 5,
      maxTrackedDevices: 1_000,
      replicas: 3,
    };
    const replicas = Array.from(
      { length: 3 },
      () => new AuthenticatedDeviceRateLimiter(configuration, allocator),
    );
    const decisions = await Promise.all(Array.from(
      { length: 90 },
      (_, index) => replicas[index % replicas.length].consume("device_1", 1_000_000 + index),
    ));

    expect(decisions.every((decision) => decision.retryAfterMs === null)).toBe(true);
    expect(transactionCount).toBe(18);
    await expect(replicas[0].consume("device_1", 1_000_100)).resolves.toMatchObject({
      retryAfterMs: 59_900,
      source: "reservation",
    });
    expect(transactionCount).toBe(19);
  });

  it("coalesces concurrent requests behind one local token lease", async () => {
    let allocations = 0;
    const limiter = new AuthenticatedDeviceRateLimiter({
      mode: "distributed",
      limit: 90,
      leaseSize: 5,
      maxTrackedDevices: 1_000,
      replicas: 2,
    }, async () => {
      allocations += 1;
      return {
        granted: 5,
        expiresAt: 1_060_000,
        retryAfterMs: 0,
        transactionAttempts: 1,
      };
    });

    const decisions = await Promise.all(
      Array.from({ length: 5 }, () => limiter.consume("device_1", 1_000_000)),
    );

    expect(allocations).toBe(1);
    expect(decisions.map((decision) => decision.source)).toEqual([
      "reservation",
      "lease",
      "lease",
      "lease",
      "lease",
    ]);
  });
});

describe("single-instance device limiting", () => {
  it("fails closed when its bounded device table is full", async () => {
    const limiter = new AuthenticatedDeviceRateLimiter({
      mode: "local",
      limit: 90,
      leaseSize: 5,
      maxTrackedDevices: 1,
      replicas: 1,
    });

    await expect(limiter.consume("device_1", 1_000_000)).resolves.toMatchObject({
      retryAfterMs: null,
      source: "local",
    });
    await expect(limiter.consume("device_2", 1_010_000)).resolves.toMatchObject({
      retryAfterMs: 50_000,
      source: "local",
    });
    await expect(limiter.consume("device_2", 1_060_000)).resolves.toMatchObject({
      retryAfterMs: null,
      source: "local",
    });
  });
});
