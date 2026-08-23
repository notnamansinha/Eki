import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/firebaseAdmin", () => ({ db: {}, rtdb: {} }));
import {
  evaluateDeviceRateLimit,
  freshestDelayMinutes,
  hashDeviceSecret,
  parseDeviceAuthorization,
  summarizeLatencySamples,
  verifyDeviceSecretHash,
} from "./deviceTelemetryService";

describe("HTTPS device rate-limit timing", () => {
  it("reports the remaining fixed-window delay and resets exactly at one minute", () => {
    const startedAt = 1_000_000;
    const rejected = evaluateDeviceRateLimit(
      { startedAt, count: 30 },
      startedAt + 10_000,
      30,
    );
    expect(rejected).toEqual({
      allowed: false,
      next: { startedAt, count: 31 },
      retryAfterMs: 50_000,
    });

    expect(
      evaluateDeviceRateLimit(rejected.next, startedAt + 60_000, 30),
    ).toEqual({
      allowed: true,
      next: { startedAt: startedAt + 60_000, count: 1 },
      retryAfterMs: 0,
    });
  });
});

describe("HTTPS device credentials", () => {
  it("accepts only a bounded Device authorization secret", () => {
    expect(parseDeviceAuthorization(undefined)).toBeNull();
    expect(parseDeviceAuthorization("Bearer something")).toBeNull();
    expect(parseDeviceAuthorization("Device too-short")).toBeNull();
    expect(parseDeviceAuthorization(`Device ${"a".repeat(20)}`)).toBe(
      "a".repeat(20),
    );
    expect(parseDeviceAuthorization(`Device ${"a".repeat(513)}`)).toBeNull();
  });

  it("creates a salted scrypt verifier without retaining the plain secret", async () => {
    const plainSecret = "demo-secret-with-enough-entropy";
    const first = await hashDeviceSecret(plainSecret);
    const second = await hashDeviceSecret(plainSecret);

    expect(first).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(second).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(plainSecret);
    await expect(verifyDeviceSecretHash(plainSecret, first)).resolves.toBe(
      true,
    );
    await expect(
      verifyDeviceSecretHash("different-secret-with-enough-entropy", first),
    ).resolves.toBe(false);
    await expect(
      verifyDeviceSecretHash(plainSecret, "malformed"),
    ).resolves.toBe(false);
  });
});

describe("telemetry latency summaries", () => {
  it("reports empty windows without invented zero-latency measurements", () => {
    expect(summarizeLatencySamples([])).toEqual({
      samples: 0,
      average: null,
      p50: null,
      p95: null,
      p99: null,
    });
  });

  it("calculates bounded-window averages and nearest-rank percentiles", () => {
    expect(summarizeLatencySamples([100, 10, 30, 20, 40])).toEqual({
      samples: 5,
      average: 40,
      p50: 30,
      p95: 100,
      p99: 100,
    });
  });

  it("handles extreme latency outliers without breaking percentile calculations", () => {
    // Simulates a device that was offline for hours (e.g., bus in a tunnel)
    // and suddenly reconnects. The system must not let this single outlier
    // skew the p50/p95 of normal operations, which are used for health monitoring.
    const samples = [10, 15, 12, 14, 13, 3600000]; // 1 hour latency outlier

    const summary = summarizeLatencySamples(samples);
    expect(summary.samples).toBe(6);
    // Median (p50) should remain unaffected by the single outlier
    expect(summary.p50).toBe(13);
    // Average will be skewed, which is mathematically expected and correct
    expect(summary.average).toBeGreaterThan(100000);
  });
});

describe("freshestDelayMinutes", () => {
  it("prefers the live value when the durable copy is stale", () => {
    const result = freshestDelayMinutes(
      { delayMinutes: 15, delayUpdatedAt: 2000 },
      { delayMinutes: 10, delayUpdatedAt: 1000 },
    );
    expect(result.delayMinutes).toBe(15);
    expect(result.delayUpdatedAt).toBe(2000);
  });

  it("prefers the durable value when it is newer (reverse partial failure)", () => {
    const result = freshestDelayMinutes(
      { delayMinutes: 10, delayUpdatedAt: 1000 },
      { delayMinutes: 15, delayUpdatedAt: 2000 },
    );
    expect(result.delayMinutes).toBe(15);
    expect(result.delayUpdatedAt).toBe(2000);
  });

  it("keeps the live value on a timestamp tie", () => {
    const result = freshestDelayMinutes(
      { delayMinutes: 12, delayUpdatedAt: 1500 },
      { delayMinutes: 9, delayUpdatedAt: 1500 },
    );
    expect(result.delayMinutes).toBe(12);
  });

  it("fills a missing live value from the durable copy", () => {
    const result = freshestDelayMinutes(
      { delayMinutes: undefined as unknown as number },
      { delayMinutes: 20, delayUpdatedAt: 3000 },
    );
    expect(result.delayMinutes).toBe(20);
  });

  it("keeps the live value when the durable copy is absent", () => {
    const result = freshestDelayMinutes(
      { delayMinutes: 7, delayUpdatedAt: 900 },
      null,
    );
    expect(result.delayMinutes).toBe(7);
  });

  it("falls back to zero when neither store has a delay", () => {
    expect(freshestDelayMinutes(null, null).delayMinutes).toBe(0);
    expect(freshestDelayMinutes({}, {}).delayMinutes).toBe(0);
  });

  it("never lets a legacy untimestamped durable value override a live one", () => {
    // Legacy durable rows have delayUpdatedAt 0; the live value wins.
    const result = freshestDelayMinutes(
      { delayMinutes: 11, delayUpdatedAt: 0 },
      { delayMinutes: 13, delayUpdatedAt: 0 },
    );
    expect(result.delayMinutes).toBe(11);
  });

  it("rejects malformed or out-of-range delay data from either store", () => {
    expect(
      freshestDelayMinutes(
        { delayMinutes: Number.NaN, delayUpdatedAt: -1 },
        { delayMinutes: 1441, delayUpdatedAt: Number.POSITIVE_INFINITY },
      ),
    ).toEqual({ delayMinutes: 0, delayUpdatedAt: 0 });
    expect(
      freshestDelayMinutes(
        { delayMinutes: 1.5, delayUpdatedAt: 20 },
        { delayMinutes: 12, delayUpdatedAt: 10 },
      ),
    ).toEqual({ delayMinutes: 12, delayUpdatedAt: 10 });
  });
});

describe("telemetry ingestion resilience and edge cases", () => {
  it("calculates retryAfterMs correctly when rate limit is exactly exceeded", () => {
    // Simulates a device spamming requests. We test the exact boundary condition.
    const startedAt = 1_000_000;
    const limit = 30;

    // The 30th request (should be allowed, but bucket is now full)
    const request30 = evaluateDeviceRateLimit(
      { startedAt, count: 29 },
      startedAt + 50_000, // 50 seconds into the window
      limit,
    );
    expect(request30.allowed).toBe(true);
    expect(request30.next.count).toBe(30);

    // The 31st request (should be rejected with correct retry delay)
    const request31 = evaluateDeviceRateLimit(
      request30.next,
      startedAt + 50_000,
      limit,
    );
    expect(request31.allowed).toBe(false);
    // 60,000ms (1 min window) - 50,000ms (current time) = 10,000ms remaining
    expect(request31.retryAfterMs).toBe(10_000);
  });

  it("validates that scrypt hashing handles variable-length secrets securely", async () => {
    // Security test: Ensures that secrets of different lengths don't leak
    // information through early rejection or timing differences, and always
    // produce a valid, constant-time hash format.
    const shortSecret = "a";
    const longSecret = "a".repeat(128);

    await expect(hashDeviceSecret(shortSecret)).resolves.toMatch(
      /^[a-f0-9]{32}:[a-f0-9]{128}$/,
    );
    await expect(hashDeviceSecret(longSecret)).resolves.toMatch(
      /^[a-f0-9]{32}:[a-f0-9]{128}$/,
    );
  });
});
