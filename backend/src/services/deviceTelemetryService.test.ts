import { describe, expect, it } from "vitest";
import {
  evaluateDeviceRateLimit,
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

    expect(evaluateDeviceRateLimit(rejected.next, startedAt + 60_000, 30)).toEqual({
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
    expect(
      parseDeviceAuthorization(`Device ${"a".repeat(20)}`),
    ).toBe("a".repeat(20));
    expect(
      parseDeviceAuthorization(`Device ${"a".repeat(513)}`),
    ).toBeNull();
  });

  it("creates a salted scrypt verifier without retaining the plain secret", async () => {
    const plainSecret = "demo-secret-with-enough-entropy";
    const first = await hashDeviceSecret(plainSecret);
    const second = await hashDeviceSecret(plainSecret);

    expect(first).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(second).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(plainSecret);
    await expect(verifyDeviceSecretHash(plainSecret, first)).resolves.toBe(true);
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
      samples: 0, average: null, p50: null, p95: null, p99: null,
    });
  });

  it("calculates bounded-window averages and nearest-rank percentiles", () => {
    expect(summarizeLatencySamples([100, 10, 30, 20, 40])).toEqual({
      samples: 5, average: 40, p50: 30, p95: 100, p99: 100,
    });
  });
});
