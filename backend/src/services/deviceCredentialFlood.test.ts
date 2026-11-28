import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  devices: new Map<string, Record<string, unknown>>(),
  reads: [] as string[],
}));

vi.mock("../lib/firebaseAdmin", () => ({
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          harness.reads.push(`${name}/${id}`);
          const value = name === "devices" ? harness.devices.get(id)
            : name === "buses" ? { assignedRoutes: ["route_1"] } : {};
          return { exists: value !== undefined, data: () => value };
        },
      }),
    }),
  },
  rtdb: { ref: () => ({ on: () => undefined, off: () => undefined, set: async () => undefined }) },
}));

import { DeviceCredentialThrottledError } from "../lib/deviceCredentialGuard";
import {
  checkDeviceCredentials,
  getHttpsTelemetryStatus,
  hashDeviceSecret,
  ingestDeviceTelemetry,
  invalidateDeviceCredentialCache,
} from "./deviceTelemetryService";
import { ingestDeviceDiagnostics } from "./deviceDiagnostics";

const SECRET = "valid-device-secret-with-enough-entropy";
const wrong = (n: number) => `wrong-device-secret-number-${n}-padding`;
const CACHE_MS = 15 * 60_000;

async function provision(deviceId: string) {
  harness.devices.set(deviceId, { busId: "bus_1", routeId: "route_1", enabled: true, secretHash: await hashDeviceSecret(SECRET) });
}
/** Exhaust an IP's 20 failures against a device without a verified pair, so only the IP budget applies. */
async function failTwentyTimes(ip: string, deviceId: string, now: number) {
  for (let i = 0; i < 20; i += 1) {
    expect(await checkDeviceCredentials(deviceId, wrong(i), now, { clientIp: ip })).toEqual({ status: "invalid" });
  }
}

beforeEach(() => {
  harness.devices.clear();
  harness.reads.length = 0;
});

describe("failed-login flood guard on the credential path (#576)", () => {
  it("refuses the 21st failed check from one IP before any Firestore read", async () => {
    await provision("flood_ip");
    await failTwentyTimes("ip:1.1.1.1", "flood_ip", 1_000);
    const reads = harness.reads.length;
    await expect(checkDeviceCredentials("flood_ip", wrong(99), 1_001, { clientIp: "ip:1.1.1.1" }))
      .rejects.toBeInstanceOf(DeviceCredentialThrottledError);
    expect(harness.reads).toHaveLength(reads);
    // Another IP is not affected.
    expect(await checkDeviceCredentials("flood_ip", wrong(99), 1_002, { clientIp: "ip:2.2.2.2" })).toEqual({ status: "invalid" });
  });

  it("never refuses a pair that already verified, even from an IP over its failure budget", async () => {
    await provision("flood_verified");
    const verified = await checkDeviceCredentials("flood_verified", SECRET, 1_000, { clientIp: "ip:3.3.3.3" });
    expect(verified).toMatchObject({ status: "assigned" });
    // Flood from another IP right as the verified entry expires, with its window still open.
    const floodAt = CACHE_MS;
    await failTwentyTimes("ip:4.4.4.4", "other_ghost", floodAt);
    await expect(checkDeviceCredentials("flood_verified", wrong(1), floodAt + 1, { clientIp: "ip:4.4.4.4" }))
      .rejects.toBeInstanceOf(DeviceCredentialThrottledError);
    // The verified pair itself, refreshed after its cache entry expired, is not refused.
    expect(await checkDeviceCredentials("flood_verified", SECRET, CACHE_MS + 1_500, { clientIp: "ip:4.4.4.4" }))
      .toMatchObject({ status: "assigned" });
  });

  it("applies the per-device budget only to a device with a verified pair", async () => {
    await provision("flood_device");
    expect(await checkDeviceCredentials("flood_device", SECRET, 1_000, { clientIp: "ip:5.5.5.5" })).toMatchObject({ status: "assigned" });
    // 10 wrong secrets from changing IPs, after the verified entry has expired.
    const at = CACHE_MS + 5_000;
    for (let i = 0; i < 10; i += 1) {
      expect(await checkDeviceCredentials("flood_device", wrong(i), at, { clientIp: `ip:6.6.6.${i}` })).toEqual({ status: "invalid" });
    }
    await expect(checkDeviceCredentials("flood_device", wrong(11), at + 1, { clientIp: "ip:6.6.6.200" }))
      .rejects.toMatchObject({ scope: "device" });
    // An unknown device ID has no verified pair: no per-device refusal, it is served from the not-found cache.
    for (let i = 0; i < 15; i += 1) {
      expect(await checkDeviceCredentials("never_provisioned", wrong(i), at, { clientIp: `ip:7.7.7.${i}` })).toEqual({ status: "invalid" });
    }
  });

  it("remembers an unknown device ID for 60 s so repeated guesses cost one read", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect(await checkDeviceCredentials("ghost_device", wrong(i), 1_000 + i, { clientIp: "ip:8.8.8.8" })).toEqual({ status: "invalid" });
    }
    expect(harness.reads).toEqual(["devices/ghost_device"]);
    // Provisioning publishes an invalidation, which clears the not-found entry at once.
    await provision("ghost_device");
    invalidateDeviceCredentialCache("ghost_device");
    expect(await checkDeviceCredentials("ghost_device", SECRET, 2_000, { clientIp: "ip:8.8.8.8" })).toMatchObject({ status: "assigned" });
  });

  it("starts a fresh window once the 15 minutes are up", async () => {
    await provision("flood_window");
    await failTwentyTimes("ip:9.9.9.9", "flood_window", 1_000);
    await expect(checkDeviceCredentials("flood_window", wrong(50), 2_000, { clientIp: "ip:9.9.9.9" }))
      .rejects.toBeInstanceOf(DeviceCredentialThrottledError);
    expect(await checkDeviceCredentials("flood_window", wrong(51), 1_000 + 900_000, { clientIp: "ip:9.9.9.9" }))
      .toEqual({ status: "invalid" });
  });

  it("does not count a correct secret for an unassigned device as a failure", async () => {
    await provision("flood_unassigned");
    delete harness.devices.get("flood_unassigned")!.routeId;
    for (let i = 0; i < 30; i += 1) {
      expect(await checkDeviceCredentials("flood_unassigned", SECRET, 1_000 + i, { clientIp: "ip:10.0.0.1" }))
        .toEqual({ status: "unassigned" });
    }
  });

  it("turns a refusal into a retryable 10 s rate_limit result for telemetry and 'throttled' for diagnostics", async () => {
    await provision("flood_ingest");
    await failTwentyTimes("ip:11.0.0.1", "flood_ingest", Date.now());
    const sample = { lat: 23, lng: 72, speed: 0, timestamp: Date.now() } as never;
    await expect(ingestDeviceTelemetry("flood_ingest", wrong(70), sample, Date.now(), { clientIp: "ip:11.0.0.1" }))
      .resolves.toEqual({ ok: false, reason: "rate_limit", retryAfterMs: 10_000 });
    await expect(ingestDeviceDiagnostics("flood_ingest", wrong(71), {} as never, Date.now(), { clientIp: "ip:11.0.0.1" }))
      .resolves.toBe("throttled");
    expect(getHttpsTelemetryStatus().credentialGuard).toMatchObject({
      perIpBudget: 20, perDeviceBudget: 10, windowMs: 900_000,
    });
    expect(getHttpsTelemetryStatus().credentialGuard.refusedByIp).toBeGreaterThanOrEqual(2);
  });
});
