import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  collections: new Map<string, Map<string, Record<string, unknown>>>(),
  reads: [] as string[],
  beforeReturn: undefined as ((collection: string, id: string) => Promise<void>) | undefined,
  invalidationError: undefined as ((error: Error) => void) | undefined,
}));

vi.mock("../lib/firebaseAdmin", () => ({
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const value = harness.collections.get(name)?.get(id);
          harness.reads.push(`${name}/${id}`);
          await harness.beforeReturn?.(name, id);
          return { exists: value !== undefined, data: () => value };
        },
      }),
    }),
  },
  rtdb: {
    ref: () => ({
      on: (_event: string, _callback: unknown, error: (error: Error) => void) => { harness.invalidationError = error; },
      off: () => undefined,
      set: async () => undefined,
    }),
  },
}));
import {
  authenticateDeviceCredentials,
  checkDeviceCredentials,
  DeviceCredentialVerificationInvalidatedError,
  durableLifecycle,
  evaluateDeviceRateLimit,
  freshestDelayMinutes,
  hashDeviceSecret,
  initialDevicePresenceState,
  invalidateDeviceCredentialCache,
  nextTelemetryValue,
  parseDeviceAuthorization,
  previousTelemetryGpsHdop,
  shouldApplyRestoreTelemetry,
  summarizeLatencySamples,
  telemetrySampleIsNewer,
  telemetryUpdateGapMs,
  verifyDeviceSecretHash,
} from "./deviceTelemetryService";

describe("durable ride restoration direction", () => {
  const activeRide = {
    status: "active",
    sessionId: "session_1",
    driverId: "driver_1",
    tripState: "in_service",
  };

  it.each([undefined, null, "", "sideways", 123])(
    "does not restore unresolved direction %p as forward",
    (direction) => {
      expect(durableLifecycle({ ...activeRide, direction })).toBeNull();
    },
  );

  it("restores only explicit directions", () => {
    expect(durableLifecycle({ ...activeRide, direction: "forward" }))
      .toMatchObject({ direction: "forward" });
    expect(durableLifecycle({ ...activeRide, direction: "reverse" }))
      .toMatchObject({ direction: "reverse" });
  });
});

describe("initial device presence", () => {
  it("does not fabricate an armed ride lifecycle", () => {
    expect(initialDevicePresenceState()).toEqual({ status: "offline" });
    expect(initialDevicePresenceState()).not.toHaveProperty("tripState");
    expect(initialDevicePresenceState()).not.toHaveProperty("currentStopIndex");
  });
});

beforeEach(() => {
  harness.collections.clear();
  harness.reads.length = 0;
  harness.beforeReturn = undefined;
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
  async function configure() {
    const secret = "valid-device-secret-with-enough-entropy";
    harness.collections.set("devices", new Map([["device_1", {
      busId: "bus_1", routeId: "route_1", enabled: true, secretHash: await hashDeviceSecret(secret),
    }]]));
    harness.collections.set("buses", new Map([["bus_1", { assignedRoutes: ["route_1"] }], ["bus_2", { assignedRoutes: ["route_2"] }]]));
    harness.collections.set("routes", new Map([["route_1", {}], ["route_2", {}]]));
    return secret;
  }
  it("performs one DB/KDF fill for concurrent identical misses", async () => {
    const secret = await configure();
    const results = await Promise.all(Array.from({ length: 20 }, () => authenticateDeviceCredentials("device_1", secret, 1_000)));
    expect(results).toEqual(Array.from({ length: 20 }, () => ({ busId: "bus_1", routeId: "route_1" })));
    expect(harness.reads).toEqual(["devices/device_1", "buses/bus_1", "routes/route_1"]);
    await authenticateDeviceCredentials("device_1", secret, 1_001);
    expect(harness.reads).toHaveLength(3);
  });
  it("distinguishes valid unassigned credentials from invalid credentials", async () => {
    const secret = await configure();
    delete harness.collections.get("devices")!.get("device_1")!.routeId;
    expect(await checkDeviceCredentials("device_1", secret, 1_000)).toEqual({ status: "unassigned" });
    expect(await checkDeviceCredentials("device_1", secret, 1_001)).toEqual({ status: "unassigned" });
    expect(await authenticateDeviceCredentials("device_1", secret, 1_001)).toBeNull();
    expect(await checkDeviceCredentials("device_1", "wrong-secret", 1_001)).toEqual({ status: "invalid" });
    harness.collections.get("devices")!.get("device_1")!.enabled = false;
    invalidateDeviceCredentialCache("device_1");
    expect(await checkDeviceCredentials("device_1", secret, 1_002)).toEqual({ status: "invalid" });
  });
  it.each([ ["rotation", "devices"], ["reassignment", "devices"], ["rotation", "buses"], ["reassignment", "buses"] ])("fences %s during %s fill", async (change, blockedCollection) => {
    const secret = await configure();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(done => { entered = done; });
    const gate = new Promise<void>(done => { release = done; });
    harness.beforeReturn = async collection => { if (collection === blockedCollection) { entered(); await gate; } };
    const pending = authenticateDeviceCredentials("device_1", secret, 1_000);
    await blocked;
    const device = harness.collections.get("devices")!.get("device_1")!;
    const nextSecret = change === "rotation" ? "rotated-device-secret-with-enough-entropy" : secret;
    harness.collections.get("devices")!.set("device_1", {
      ...device,
      ...(change === "rotation" ? { secretHash: await hashDeviceSecret(nextSecret) } : { busId: "bus_2", routeId: "route_2" }),
    });
    invalidateDeviceCredentialCache("device_1");
    release();
    await expect(pending).rejects.toBeInstanceOf(DeviceCredentialVerificationInvalidatedError);
    harness.beforeReturn = undefined;
    if (change === "rotation") await expect(authenticateDeviceCredentials("device_1", secret, 1_001)).resolves.toBeNull();
    await expect(authenticateDeviceCredentials("device_1", nextSecret, 1_002)).resolves.toEqual({
      busId: change === "rotation" ? "bus_1" : "bus_2", routeId: change === "rotation" ? "route_1" : "route_2",
    });
  });
  it("retries verification after an initial version notification without rejecting valid credentials", async () => {
    const secret = await configure();
    harness.beforeReturn = async collection => {
      if (collection === "devices") invalidateDeviceCredentialCache("device_1");
    };
    await expect(authenticateDeviceCredentials("device_1", secret, 1_000))
      .rejects.toBeInstanceOf(DeviceCredentialVerificationInvalidatedError);
    harness.beforeReturn = undefined;
    await expect(authenticateDeviceCredentials("device_1", secret, 1_001))
      .resolves.toEqual({ busId: "bus_1", routeId: "route_1" });
  });
  it("clears a failed database fill and refreshes after the positive TTL", async () => {
    const secret = await configure();
    harness.beforeReturn = async () => { throw new Error("DB unavailable"); };
    await expect(authenticateDeviceCredentials("device_1", secret, 1_000)).rejects.toThrow("DB unavailable");
    harness.beforeReturn = undefined;
    await authenticateDeviceCredentials("device_1", secret, 1_001);
    harness.collections.get("devices")!.get("device_1")!.enabled = false;
    await expect(authenticateDeviceCredentials("device_1", secret, 61_001)).resolves.toBeNull();
  });
  it("coalesces and expires negative fills without extending their TTL on access", async () => {
    const secret = await configure();
    const device = harness.collections.get("devices")!.get("device_1")!;
    harness.collections.get("devices")!.delete("device_1");
    await expect(Promise.all(Array.from({ length: 10 }, () => authenticateDeviceCredentials("device_1", secret, 1_000)))).resolves.toEqual(Array(10).fill(null));
    expect(harness.reads).toEqual(["devices/device_1"]);
    harness.collections.get("devices")!.set("device_1", device);
    await expect(authenticateDeviceCredentials("device_1", secret, 5_999)).resolves.toBeNull();
    await expect(authenticateDeviceCredentials("device_1", secret, 6_000)).resolves.toEqual({ busId: "bus_1", routeId: "route_1" });
  });
  it("clears authorization when the invalidation listener fails", async () => {
    const secret = await configure();
    await authenticateDeviceCredentials("device_1", secret, 1_000);
    harness.collections.get("devices")!.get("device_1")!.enabled = false;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try { harness.invalidationError!(new Error("Listener unavailable")); }
    finally { log.mockRestore(); }
    await expect(authenticateDeviceCredentials("device_1", secret, 1_001)).resolves.toBeNull();
  });
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

  it("measures update gaps only on one monotonic server clock", () => {
    expect(telemetryUpdateGapMs(1_000, 2_250)).toBe(1_250);
    expect(telemetryUpdateGapMs(undefined, 2_250)).toBeNull();
    expect(telemetryUpdateGapMs(3_000, 2_250)).toBeNull();
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

  it("preserves lifecycle and matched state while atomically advancing raw telemetry", () => {
    const live = {
      busId: "bus_1",
      routeId: "route_1",
      sessionId: "session_1",
      driverId: "driver_1",
      status: "active",
      tripState: "in_service",
      currentStopIndex: 2,
      lat: 23,
      lng: 72,
      speed: 10,
      heading: 90,
      timestamp: 4_000,
      seq: 4,
      rtdbCommittedAt: 4_100,
      activeRoutePolyline: "retired-geometry".repeat(10_000),
      routeVersion: 7,
      mapMatchSeq: 4,
      mapMatchSampledAt: 4_000,
      extensionFromNewerReplica: { preserve: true },
      matchedLocation: { seq: 4, sampledAt: 4_000, lat: 23, lng: 72 },
    };
    const next = nextTelemetryValue(live, {
      busId: "bus_1",
      routeId: "route_1",
    }, {
      lat: 23,
      lng: 72,
      speed: 11,
      heading: 91,
      gpsHdop: 1.2,
      motionState: "moving",
      seq: 5,
      deviceSentAt: 5_100,
      timestamp: 5_000,
    }, 5_200);

    expect(next).toMatchObject({
      sessionId: "session_1",
      driverId: "driver_1",
      status: "active",
      tripState: "in_service",
      currentStopIndex: 2,
      timestamp: 5_000,
      seq: 5,
      matchedLocation: live.matchedLocation,
      rawLocation: { seq: 5, sampledAt: 5_000 },
      backendReceivedAt: 5_200,
      receivedAt: { ".sv": "timestamp" },
      routeVersion: 7,
      mapMatchSeq: 4,
      mapMatchSampledAt: 4_000,
      extensionFromNewerReplica: { preserve: true },
    });
    expect(next).not.toHaveProperty("rtdbCommittedAt");
    expect(next).not.toHaveProperty("activeRoutePolyline");
    expect(live.rtdbCommittedAt).toBe(4_100);
    expect(live.activeRoutePolyline).toHaveLength(160_000);
    expect(JSON.stringify(next).length).toBeLessThan(JSON.stringify(live).length - 150_000);
  });

  it("aborts a stale raw write before it can overwrite lifecycle state", () => {
    expect(nextTelemetryValue({
      sessionId: "session_new",
      status: "active",
      timestamp: 5_000,
      seq: 5,
    }, {
      busId: "bus_1",
      routeId: "route_1",
    }, {
      lat: 23,
      lng: 72,
      speed: 10,
      heading: 90,
      gpsHdop: 1,
      motionState: "moving",
      seq: 99,
      deviceSentAt: 4_100,
      timestamp: 4_000,
    }, 4_200)).toBeUndefined();
  });
});

describe("previous telemetry HDOP", () => {
  it("preserves unknown HDOP when no valid fallback exists", () => {
    expect(previousTelemetryGpsHdop({ gpsHdop: null }, { gpsHdop: null })).toBeNull();
    expect(previousTelemetryGpsHdop({ gpsHdop: undefined }, {})).toBeNull();
  });

  it("uses a valid live fallback for null, missing, or invalid anchor HDOP", () => {
    expect(previousTelemetryGpsHdop({ gpsHdop: null }, { gpsHdop: 2.5 })).toBe(2.5);
    expect(previousTelemetryGpsHdop({}, { gpsHdop: 3 })).toBe(3);
    expect(previousTelemetryGpsHdop({ gpsHdop: Number.NaN }, { gpsHdop: 4 })).toBe(4);
    expect(previousTelemetryGpsHdop({ gpsHdop: Number.POSITIVE_INFINITY }, { gpsHdop: 4 })).toBe(4);
  });

  it("prefers finite anchor HDOP, including a legitimate zero", () => {
    expect(previousTelemetryGpsHdop({ gpsHdop: 1.2 }, { gpsHdop: 4 })).toBe(1.2);
    expect(previousTelemetryGpsHdop({ gpsHdop: 0 }, { gpsHdop: 4 })).toBe(0);
  });
});
