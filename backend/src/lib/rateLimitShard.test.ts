import { afterEach, describe, expect, it, vi } from "vitest";
import { readRateLimitShardFactor, shardedLimit } from "./rateLimitShard";

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

afterEach(() => {
  warn.mockClear();
  delete process.env.RATE_LIMIT_SHARD_FACTOR;
});

describe("readRateLimitShardFactor", () => {
  it("defaults to 1 when unset or empty", () => {
    expect(readRateLimitShardFactor({})).toBe(1);
    expect(readRateLimitShardFactor({ RATE_LIMIT_SHARD_FACTOR: "" })).toBe(1);
  });

  it("reads a positive integer replica count", () => {
    expect(readRateLimitShardFactor({ RATE_LIMIT_SHARD_FACTOR: "2" })).toBe(2);
    expect(readRateLimitShardFactor({ RATE_LIMIT_SHARD_FACTOR: "3" })).toBe(3);
    process.env.RATE_LIMIT_SHARD_FACTOR = "4";
    expect(readRateLimitShardFactor()).toBe(4);
  });

  it("falls back to 1 and warns on malformed values", () => {
    for (const bad of ["0", "-2", "2.5", "abc", "Infinity"]) {
      expect(readRateLimitShardFactor({ RATE_LIMIT_SHARD_FACTOR: bad })).toBe(1);
    }
    expect(warn).toHaveBeenCalledTimes(5);
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

  it("never drops below one request per instance", () => {
    expect(shardedLimit(1, 4)).toBe(1);
    expect(shardedLimit(3, 10)).toBe(1);
  });
});
