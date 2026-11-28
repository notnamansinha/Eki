import { describe, expect, it, vi } from "vitest";
import {
  DEVICE_NOT_FOUND_MS,
  DeviceCredentialGuard,
  DeviceCredentialThrottledError,
  readDeviceCredentialGuardConfiguration,
} from "./deviceCredentialGuard";

const config = { windowMs: 900_000, perIp: 3, perDevice: 2 };

describe("device credential guard configuration", () => {
  it("defaults to a 15 minute window with 20 failures per IP and 10 per device", () => {
    expect(readDeviceCredentialGuardConfiguration({})).toEqual({ windowMs: 900_000, perIp: 20, perDevice: 10 });
  });

  it("divides each budget across replicas and lets 0 turn a budget off", () => {
    expect(readDeviceCredentialGuardConfiguration({
      RATE_LIMIT_SHARD_FACTOR: "2",
      DEVICE_CREDENTIAL_FAILURES_PER_IP: "20",
      DEVICE_CREDENTIAL_FAILURES_PER_DEVICE: "0",
      DEVICE_CREDENTIAL_FAILURE_WINDOW_MS: "60000",
    })).toEqual({ windowMs: 60_000, perIp: 10, perDevice: null });
  });

  it.each([
    ["DEVICE_CREDENTIAL_FAILURES_PER_IP", "-1"],
    ["DEVICE_CREDENTIAL_FAILURES_PER_IP", "ten"],
    ["DEVICE_CREDENTIAL_FAILURE_WINDOW_MS", "999"],
    ["DEVICE_CREDENTIAL_FAILURE_WINDOW_MS", "86400001"],
  ])("rejects %s=%s at startup", (name, value) => {
    expect(() => readDeviceCredentialGuardConfiguration({ [name]: value })).toThrow();
  });

  it("refuses a budget smaller than the replica count rather than exceeding it", () => {
    expect(() => readDeviceCredentialGuardConfiguration({
      RATE_LIMIT_SHARD_FACTOR: "4", DEVICE_CREDENTIAL_FAILURES_PER_DEVICE: "3",
    })).toThrow(/exceeds/);
  });
});

describe("DeviceCredentialGuard", () => {
  it("refuses an IP once it has used its failure budget, and only for the rest of the window", () => {
    const guard = new DeviceCredentialGuard(config, () => undefined);
    for (let i = 0; i < 3; i += 1) {
      guard.assertAdmitted("ip:a", "d1", false, 1_000);
      guard.recordFailure("ip:a", "d1", 1_000);
    }
    expect(() => guard.assertAdmitted("ip:a", "d2", false, 1_001)).toThrow(DeviceCredentialThrottledError);
    expect(() => guard.assertAdmitted("ip:b", "d2", false, 1_001)).not.toThrow();
    expect(() => guard.assertAdmitted("ip:a", "d2", false, 1_000 + 900_000)).not.toThrow();
  });

  it("applies the per-device budget only while the device has a verified pair", () => {
    const guard = new DeviceCredentialGuard(config, () => undefined);
    for (let i = 0; i < 2; i += 1) guard.recordFailure(undefined, "d1", 1_000);
    expect(() => guard.assertAdmitted(undefined, "d1", false, 1_001)).not.toThrow();
    expect(() => guard.assertAdmitted(undefined, "d1", true, 1_001)).toThrowError(
      expect.objectContaining({ scope: "device", retryAfterMs: 10_000 }),
    );
  });

  it("never counts or refuses by IP when the caller has no IP, and never when a budget is off", () => {
    const guard = new DeviceCredentialGuard({ windowMs: 900_000, perIp: null, perDevice: null }, () => undefined);
    for (let i = 0; i < 50; i += 1) guard.recordFailure("ip:a", "d1", 1_000);
    expect(() => guard.assertAdmitted("ip:a", "d1", true, 1_001)).not.toThrow();
  });

  it("remembers an unknown device ID for 60 s and forgets it on invalidation", () => {
    const guard = new DeviceCredentialGuard(config, () => undefined);
    guard.markNotFound("ghost", 1_000);
    expect(guard.isNotFound("ghost", 1_000 + DEVICE_NOT_FOUND_MS - 1)).toBe(true);
    expect(guard.isNotFound("ghost", 1_000 + DEVICE_NOT_FOUND_MS)).toBe(false);
    guard.markNotFound("ghost", 2_000);
    guard.forgetDevice("ghost");
    expect(guard.isNotFound("ghost", 2_001)).toBe(false);
  });

  it("starts a device from a clean failure count when its credentials change", () => {
    const guard = new DeviceCredentialGuard(config, () => undefined);
    for (let i = 0; i < 2; i += 1) guard.recordFailure(undefined, "d1", 1_000);
    guard.forgetDevice("d1");
    expect(() => guard.assertAdmitted(undefined, "d1", true, 1_001)).not.toThrow();
  });

  it("bounds every map at 1,000 entries so caller-chosen keys cannot grow memory", () => {
    const guard = new DeviceCredentialGuard(config, () => undefined);
    for (let i = 0; i < 1_500; i += 1) {
      guard.recordFailure(`ip:${i}`, `device_${i}`, 1_000 + i);
      guard.markNotFound(`ghost_${i}`, 1_000 + i);
    }
    expect(guard.snapshot()).toMatchObject({ trackedIps: 1_000, trackedDevices: 1_000, notFoundDevices: 1_000 });
  });

  it("logs at most one summary a minute and counts every refusal", () => {
    const log = vi.fn();
    const guard = new DeviceCredentialGuard(config, log);
    for (let i = 0; i < 3; i += 1) guard.recordFailure("ip:a", "d1", 1_000);
    const refuse = (now: number) => { try { guard.assertAdmitted("ip:a", "d1", false, now); } catch { /* expected */ } };
    refuse(1_001); refuse(1_002); refuse(1_003);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("refused 1 by IP");
    refuse(1_001 + 60_000);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).toContain("refused 3 by IP");
    expect(guard.snapshot().refusedByIp).toBe(4);
  });
});
