import { afterEach, describe, expect, it } from "vitest";
import { readRateLimitShardFactor, shardedLimit } from "./rateLimitShard";

afterEach(() => {
  delete process.env.RATE_LIMIT_SHARD_FACTOR;
});

describe("readRateLimitShardFactor", () => {
  it("defaults to 1 when unset", () => {
    expect(readRateLimitShardFactor({})).toBe(1);
  });

  it("reads a positive integer replica count", () => {
    expect(readRateLimitShardFactor({ RATE_LIMIT_SHARD_FACTOR: "2" })).toBe(2);
    expect(readRateLimitShardFactor({ RATE_LIMIT_SHARD_FACTOR: "3" })).toBe(3);
    process.env.RATE_LIMIT_SHARD_FACTOR = "4";
    expect(readRateLimitShardFactor()).toBe(4);
  });

  it("fails startup on a malformed configured replica count", () => {
    for (const bad of ["", "0", "-2", "2.5", "abc", "Infinity", "0x2", "9007199254740992"]) {
      expect(() => readRateLimitShardFactor({ RATE_LIMIT_SHARD_FACTOR: bad }))
        .toThrow(RangeError);
    }
  });
});

describe("shardedLimit", () => {
  it("keeps the single-instance budget unchanged", () => {
    expect(shardedLimit(200, 1)).toBe(200);
    expect(shardedLimit(30, 1)).toBe(30);
  });

  it("divides so the aggregate never exceeds the configured limit", () => {
    expect(shardedLimit(200, 2)).toBe(100);
    expect(shardedLimit(200, 3)).toBe(66);
    expect(shardedLimit(10, 3)).toBe(3);
    expect(shardedLimit(30, 4)).toBe(7);
  });

  it("fails closed when replicas would exceed the aggregate budget", () => {
    expect(() => shardedLimit(1, 4)).toThrow(RangeError);
    expect(() => shardedLimit(3, 10)).toThrow(RangeError);
  });

  it("rejects invalid limits and replica counts", () => {
    expect(() => shardedLimit(0, 1)).toThrow(RangeError);
    expect(() => shardedLimit(10, 0)).toThrow(RangeError);
    expect(() => shardedLimit(10.5, 1)).toThrow(RangeError);
  });
});
