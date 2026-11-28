import { readRateLimitShardFactor, shardedLimit } from "./rateLimitShard";

/**
 * Failed-login flood guard for the device credential path (issue #576).
 *
 * An unverified credential check costs a Firestore read and a scrypt run. This
 * guard counts failed checks per client IP and per device ID in memory and
 * refuses further unverified checks before either is spent. Pairs that already
 * verified are never routed here, so a working tracker is never refused.
 *
 * State is per process (D5): budgets are divided by RATE_LIMIT_SHARD_FACTOR and
 * the maps are bounded so caller-controlled IDs cannot grow memory.
 */

/** What a refused tracker is told to wait (D4). */
export const CREDENTIAL_THROTTLE_RETRY_AFTER_MS = 10_000;
/** How long an unknown device ID is remembered as unknown (D6). */
export const DEVICE_NOT_FOUND_MS = 60_000;
const MAX_TRACKED_KEYS = 1_000;
const SUMMARY_INTERVAL_MS = 60_000;

const DEFAULT_WINDOW_MS = 15 * 60_000;
const DEFAULT_FAILURES_PER_IP = 20;
const DEFAULT_FAILURES_PER_DEVICE = 10;

export interface DeviceCredentialGuardConfiguration {
  windowMs: number;
  /** Per-process failure budget per IP; null turns the budget off. */
  perIp: number | null;
  /** Per-process failure budget per device ID; null turns the budget off. */
  perDevice: number | null;
}

/** Thrown when an unverified credential check is refused before any work. */
export class DeviceCredentialThrottledError extends Error {
  constructor(readonly scope: "ip" | "device", readonly retryAfterMs = CREDENTIAL_THROTTLE_RETRY_AFTER_MS) {
    super(`Device credential checks are throttled (${scope}).`);
  }
}

function nonNegativeInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
  return Number(raw);
}

export function readDeviceCredentialGuardConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): DeviceCredentialGuardConfiguration {
  const replicas = readRateLimitShardFactor(env);
  const windowMs = nonNegativeInteger(env, "DEVICE_CREDENTIAL_FAILURE_WINDOW_MS", DEFAULT_WINDOW_MS);
  if (windowMs < 1_000 || windowMs > 86_400_000) {
    throw new RangeError("DEVICE_CREDENTIAL_FAILURE_WINDOW_MS must be from 1000 to 86400000.");
  }
  const budget = (name: string, fallback: number): number | null => {
    const value = nonNegativeInteger(env, name, fallback);
    // 0 turns the budget off; anything else is split across replicas.
    return value === 0 ? null : shardedLimit(value, replicas);
  };
  return {
    windowMs,
    perIp: budget("DEVICE_CREDENTIAL_FAILURES_PER_IP", DEFAULT_FAILURES_PER_IP),
    perDevice: budget("DEVICE_CREDENTIAL_FAILURES_PER_DEVICE", DEFAULT_FAILURES_PER_DEVICE),
  };
}

interface Window { startedAt: number; count: number }

export interface DeviceCredentialGuardSnapshot {
  perIpBudget: number | null;
  perDeviceBudget: number | null;
  windowMs: number;
  trackedIps: number;
  trackedDevices: number;
  notFoundDevices: number;
  refusedByIp: number;
  refusedByDevice: number;
  notFoundHits: number;
}

export class DeviceCredentialGuard {
  private readonly ips = new Map<string, Window>();
  private readonly devices = new Map<string, Window>();
  private readonly notFound = new Map<string, number>();
  private refusedByIp = 0;
  private refusedByDevice = 0;
  private notFoundHits = 0;
  private summarizedAt: number | null = null;
  private summarized = { ip: 0, device: 0, notFound: 0 };

  constructor(
    private readonly configuration: DeviceCredentialGuardConfiguration = readDeviceCredentialGuardConfiguration(),
    private readonly log: (message: string) => void = message => console.warn(message),
  ) {}

  /**
   * Throws when an unverified check must be refused. The per-device budget only
   * applies while that device ID has a verified pair in memory (D10): an unknown
   * ID cannot lock a real device out, and the not-found cache covers it instead.
   */
  assertAdmitted(clientIp: string | undefined, deviceId: string, deviceHasVerifiedPair: boolean, now: number): void {
    const { perIp, perDevice } = this.configuration;
    if (clientIp !== undefined && perIp !== null && this.count(this.ips, clientIp, now) >= perIp) {
      this.refuse("ip", now);
    }
    if (deviceHasVerifiedPair && perDevice !== null && this.count(this.devices, deviceId, now) >= perDevice) {
      this.refuse("device", now);
    }
  }

  recordFailure(clientIp: string | undefined, deviceId: string, now: number): void {
    if (clientIp !== undefined) this.bump(this.ips, clientIp, now);
    this.bump(this.devices, deviceId, now);
  }

  markNotFound(deviceId: string, now: number): void {
    this.notFound.delete(deviceId);
    if (this.notFound.size >= MAX_TRACKED_KEYS) {
      for (const [key, expiresAt] of this.notFound) if (expiresAt <= now) this.notFound.delete(key);
    }
    if (this.notFound.size >= MAX_TRACKED_KEYS) {
      const oldest = this.notFound.keys().next().value;
      if (oldest !== undefined) this.notFound.delete(oldest);
    }
    this.notFound.set(deviceId, now + DEVICE_NOT_FOUND_MS);
  }

  isNotFound(deviceId: string, now: number): boolean {
    const expiresAt = this.notFound.get(deviceId);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      this.notFound.delete(deviceId);
      return false;
    }
    this.notFoundHits += 1;
    return true;
  }

  /** A changed credential or registry entry starts that device from a clean slate. */
  forgetDevice(deviceId: string): void {
    this.notFound.delete(deviceId);
    this.devices.delete(deviceId);
  }

  clear(): void {
    this.ips.clear();
    this.devices.clear();
    this.notFound.clear();
  }

  snapshot(): DeviceCredentialGuardSnapshot {
    return {
      perIpBudget: this.configuration.perIp,
      perDeviceBudget: this.configuration.perDevice,
      windowMs: this.configuration.windowMs,
      trackedIps: this.ips.size,
      trackedDevices: this.devices.size,
      notFoundDevices: this.notFound.size,
      refusedByIp: this.refusedByIp,
      refusedByDevice: this.refusedByDevice,
      notFoundHits: this.notFoundHits,
    };
  }

  private count(map: Map<string, Window>, key: string, now: number): number {
    const window = map.get(key);
    if (!window) return 0;
    if (now - window.startedAt >= this.configuration.windowMs) {
      map.delete(key);
      return 0;
    }
    return window.count;
  }

  private bump(map: Map<string, Window>, key: string, now: number): void {
    const current = this.count(map, key, now);
    if (current === 0 && map.size >= MAX_TRACKED_KEYS) {
      for (const [other, window] of map) {
        if (now - window.startedAt >= this.configuration.windowMs) map.delete(other);
      }
      if (map.size >= MAX_TRACKED_KEYS) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
    }
    const window = map.get(key);
    if (window) window.count += 1;
    else map.set(key, { startedAt: now, count: 1 });
  }

  private refuse(scope: "ip" | "device", now: number): never {
    if (scope === "ip") this.refusedByIp += 1;
    else this.refusedByDevice += 1;
    this.summarize(now);
    throw new DeviceCredentialThrottledError(scope);
  }

  /** At most one line a minute (D8), emitted by the first refusal after the minute is up. */
  private summarize(now: number): void {
    if (this.summarizedAt === null) this.summarizedAt = now - SUMMARY_INTERVAL_MS;
    if (now - this.summarizedAt < SUMMARY_INTERVAL_MS) return;
    const ip = this.refusedByIp - this.summarized.ip;
    const device = this.refusedByDevice - this.summarized.device;
    const notFound = this.notFoundHits - this.summarized.notFound;
    this.summarizedAt = now;
    this.summarized = { ip: this.refusedByIp, device: this.refusedByDevice, notFound: this.notFoundHits };
    this.log(
      `[Devices] Credential guard refused ${ip} by IP and ${device} by device; ${notFound} unknown-device hits since the last summary.`,
    );
  }
}
