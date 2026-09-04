import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  collections: new Map<string, Map<string, Record<string, unknown>>>(),
}));

vi.mock("../lib/firebaseAdmin", () => ({
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const value = harness.collections.get(name)?.get(id);
          return { exists: value !== undefined, data: () => value };
        },
      }),
    }),
  },
  rtdb: {
    ref: () => ({
      on: () => undefined,
      set: async () => undefined,
    }),
  },
}));
import {
  authenticateDeviceCredentials,
  evaluateDeviceRateLimit,
  freshestDelayMinutes,
  hashDeviceSecret,
  invalidateDeviceCredentialCache,
  parseDeviceAuthorization,
  shouldApplyRestoreTelemetry,
  summarizeLatencySamples,
  telemetrySampleIsNewer,
  verifyDeviceSecretHash,
} from "./deviceTelemetryService";

beforeEach(() => {
  harness.collections.clear();
  invalidateDeviceCredentialCache("device_1");
});

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
  it("does not let a wrong secret poison the legitimate device cache entry", async () => {
    const validSecret = "valid-device-secret-with-enough-entropy";
    const secretHash = await hashDeviceSecret(validSecret);
    harness.collections.set("devices", new Map([["device_1", {
      busId: "bus_1",
      routeId: "route_1",
      enabled: true,
      secretHash,
    }]]));
    harness.collections.set("buses", new Map([["bus_1", {
      assignedRoutes: ["route_1"],
    }]]));
    harness.collections.set("routes", new Map([["route_1", { id: "route_1" }]]));

    await expect(authenticateDeviceCredentials(
      "device_1",
      "wrong-device-secret-with-enough-entropy",
      1_000,
    )).resolves.toBeNull();
    await expect(authenticateDeviceCredentials(
      "device_1",
      validSecret,
      1_001,
    )).resolves.toEqual({ busId: "bus_1", routeId: "route_1" });
  });

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
    expect(freshestDelayMinutes(
      { delayMinutes: Number.NaN, delayUpdatedAt: -1 },
      { delayMinutes: 1441, delayUpdatedAt: Number.POSITIVE_INFINITY },
    )).toEqual({ delayMinutes: 0, delayUpdatedAt: 0 });
    expect(freshestDelayMinutes(
      { delayMinutes: 1.5, delayUpdatedAt: 20 },
      { delayMinutes: 12, delayUpdatedAt: 10 },
    )).toEqual({ delayMinutes: 12, delayUpdatedAt: 10 });
  });
});

describe("durable ride telemetry restore ordering", () => {
  it("does not overwrite a filtered RTDB sample on an equal timestamp", () => {
    expect(shouldApplyRestoreTelemetry(4_000, 4_000)).toBe(false);
  });

  it("only fills missing or genuinely older live telemetry", () => {
    expect(shouldApplyRestoreTelemetry(undefined, 4_000)).toBe(true);
    expect(shouldApplyRestoreTelemetry(3_999, 4_000)).toBe(true);
    expect(shouldApplyRestoreTelemetry(4_001, 4_000)).toBe(false);
  });

  it("allows exactly 90 one-second updates and rejects the 91st", () => {
    const startedAt = 1_000_000;
    const ninetieth = evaluateDeviceRateLimit(
      { startedAt, count: 89 },
      startedAt + 59_000,
      90,
    );
    expect(ninetieth.allowed).toBe(true);
    expect(ninetieth.next.count).toBe(90);

    const ninetyFirst = evaluateDeviceRateLimit(
      ninetieth.next,
      startedAt + 59_001,
      90,
    );
    expect(ninetyFirst.allowed).toBe(false);
    expect(ninetyFirst.retryAfterMs).toBe(999);
  });
});

describe("live telemetry ordering", () => {
  it("uses capture time first and sequence only for equal timestamps", () => {
    expect(telemetrySampleIsNewer(undefined, undefined, { timestamp: 4_000, seq: 1 })).toBe(true);
    expect(telemetrySampleIsNewer(4_000, 8, { timestamp: 4_001, seq: 1 })).toBe(true);
    expect(telemetrySampleIsNewer(4_000, 8, { timestamp: 3_999, seq: 99 })).toBe(false);
    expect(telemetrySampleIsNewer(4_000, 8, { timestamp: 4_000, seq: 9 })).toBe(true);
    expect(telemetrySampleIsNewer(4_000, 8, { timestamp: 4_000, seq: 8 })).toBe(false);
  });

  it("does not let an equal-time candidate overwrite a legacy sample without a sequence", () => {
    expect(telemetrySampleIsNewer(4_000, undefined, { timestamp: 4_000, seq: 1 })).toBe(false);
  });
});
