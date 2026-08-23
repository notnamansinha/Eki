import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { db, rtdb } from "../lib/firebaseAdmin";
import { createConcurrencyLimiter } from "../lib/concurrency";
import { recordBackgroundFailure } from "../lib/backgroundFailureTracker";
import { isPlausibleTelemetryTransition } from "../lib/telemetryMotion";
import type { TelemetryPayload } from "./telemetryPayload";

const scryptAsync = promisify(scrypt);
// scrypt is memory-hard; cap concurrent verifications so a burst of credential
// cache misses cannot exhaust CPU/ memory on the request path (issue #48 L1).
const SCRYPT_MAX_CONCURRENT = 4;
const scryptLimiter = createConcurrencyLimiter(SCRYPT_MAX_CONCURRENT);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CREDENTIAL_CACHE_MS = 60_000;
const NEGATIVE_CACHE_MS = 5_000;
const DURABLE_RIDE_MISS_CACHE_MS = 30_000;
const MAX_CREDENTIAL_CACHE_ENTRIES = 1_000;
const MAX_DURABLE_RIDE_MISSES = 1_000;
const DEFAULT_DEVICE_RATE_PER_MINUTE = 90;
const DEVICE_RATE_LIMIT_PATH = "_deviceRateLimits";
const DEVICE_CREDENTIAL_VERSION_PATH = "_deviceCredentialVersions";

export interface DeviceAssignment {
  busId: string;
  routeId: string;
}

interface CredentialCacheEntry {
  assignment: DeviceAssignment | null;
  secretDigest: Buffer | null;
  expiresAt: number;
}

interface RateBucket {
  startedAt: number;
  count: number;
}

export interface DeviceRateLimitDecision {
  allowed: boolean;
  next: RateBucket;
  retryAfterMs: number;
}

export interface HttpsTelemetryStatus {
  accepted: number;
  rejected: number;
  lastAcceptedAt: string | null;
  lastRejectedAt: string | null;
  credentialCacheHitRate: number | null;
  processingLatencyMs: LatencySummary;
  deviceToServerLatencyMs: LatencySummary;
  rtdbWriteLatencyMs: LatencySummary;
}

export interface LatencySummary {
  samples: number;
  average: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface DelayPreference {
  delayMinutes: number;
  delayUpdatedAt: number;
}

function validDelayMinutes(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1440
    ? Number(value)
    : null;
}

function validDelayRevision(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : 0;
}

/**
 * Pick the freshest announced delay between the live RTDB node and the
 * durable active_rides copy.
 *
 * The delay route writes both stores with the same `delayUpdatedAt` epoch,
 * but the two writes are not atomic, so one can be stale after a partial
 * failure. The newer timestamp wins; on a tie the live value is preferred
 * because it is what passengers are currently seeing. Legacy rows without
 * a timestamp default to 0 and therefore never override a newer value.
 */
export function freshestDelayMinutes(
  live: Record<string, unknown> | null,
  durable: Record<string, unknown> | null,
): DelayPreference {
  const liveMinutes = validDelayMinutes(live?.delayMinutes);
  const durableMinutes = validDelayMinutes(durable?.delayMinutes);
  const liveAt = validDelayRevision(live?.delayUpdatedAt);
  const durableAt = validDelayRevision(durable?.delayUpdatedAt);

  if (durableMinutes !== null && (liveMinutes === null || durableAt > liveAt)) {
    return { delayMinutes: durableMinutes, delayUpdatedAt: durableAt };
  }
  return {
    delayMinutes: liveMinutes ?? durableMinutes ?? 0,
    delayUpdatedAt: liveAt,
  };
}

export function shouldApplyRestoreTelemetry(
  existingTimestamp: unknown,
  candidateTimestamp: number,
): boolean {
  const existing = Number(existingTimestamp);
  return !Number.isFinite(existing) || existing < candidateTimestamp;
}

export type TelemetryIngestResult =
  | { ok: true; duplicate: boolean }
  | {
      ok: false;
      reason: "credentials";
    }
  | {
      ok: false;
      reason: "rate_limit";
      retryAfterMs: number;
    };

const credentialCache = new Map<string, CredentialCacheEntry>();
const durableRideMisses = new Map<string, number>();
const durableRideRestores = new Map<string, Promise<void>>();
let credentialInvalidationListenerStarted = false;
const status: Pick<
  HttpsTelemetryStatus,
  "accepted" | "rejected" | "lastAcceptedAt" | "lastRejectedAt"
> = {
  accepted: 0,
  rejected: 0,
  lastAcceptedAt: null,
  lastRejectedAt: null,
};
const MAX_METRIC_SAMPLES = 512;
const processingLatencySamples: number[] = [];
const deviceToServerLatencySamples: number[] = [];
const rtdbWriteLatencySamples: number[] = [];
let credentialCacheHits = 0;
let credentialCacheMisses = 0;

const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH = Buffer.alloc(64);

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function evaluateDeviceRateLimit(
  existing: Readonly<RateBucket> | undefined,
  now: number,
  limit: number,
): DeviceRateLimitDecision {
  if (!existing || now - existing.startedAt >= 60_000) {
    return {
      allowed: true,
      next: { startedAt: now, count: 1 },
      retryAfterMs: 0,
    };
  }
  const next = { startedAt: existing.startedAt, count: existing.count + 1 };
  const allowed = next.count <= limit;
  return {
    allowed,
    next,
    retryAfterMs: allowed ? 0 : Math.max(1, 60_000 - (now - existing.startedAt)),
  };
}

function recordSample(samples: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  if (samples.length >= MAX_METRIC_SAMPLES) samples.shift();
  samples.push(value);
}

export function summarizeLatencySamples(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) {
    return { samples: 0, average: null, p50: null, p95: null, p99: null };
  }
  const ordered = [...samples].sort((left, right) => left - right);
  const percentile = (value: number) =>
    ordered[Math.min(ordered.length - 1, Math.ceil(value * ordered.length) - 1)];
  return {
    samples: ordered.length,
    average: Number((ordered.reduce((sum, value) => sum + value, 0) / ordered.length).toFixed(1)),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
  };
}

function digestSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function credentialCacheKey(deviceId: string, secretDigest: Buffer): string {
  return `${deviceId}:${secretDigest.toString("hex")}`;
}

function safeBufferEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function cacheCredential(
  cacheKey: string,
  value: CredentialCacheEntry,
): void {
  if (
    !credentialCache.has(cacheKey) &&
    credentialCache.size >= MAX_CREDENTIAL_CACHE_ENTRIES
  ) {
    const oldest = credentialCache.keys().next().value;
    if (oldest) credentialCache.delete(oldest);
  }
  credentialCache.set(cacheKey, value);
}

function ensureDeviceCredentialInvalidationListener(): void {
  if (credentialInvalidationListenerStarted) return;
  credentialInvalidationListenerStarted = true;
  const versions = rtdb.ref(DEVICE_CREDENTIAL_VERSION_PATH);
  const invalidate = (snapshot: { key: string | null }) => {
    if (snapshot.key && SAFE_ID.test(snapshot.key)) {
      invalidateDeviceCredentialCache(snapshot.key);
    }
  };
  const handleError = (error: Error) => {
    credentialInvalidationListenerStarted = false;
    console.error("[Devices] Credential invalidation listener failed:", error);
  };
  versions.on("child_added", invalidate, handleError);
  versions.on("child_changed", invalidate, handleError);
}

function assignmentFromDevice(
  device: Record<string, unknown> | undefined,
): DeviceAssignment | null {
  const busId = device?.busId;
  const routeId = device?.routeId;
  if (
    device?.enabled === false ||
    typeof busId !== "string" ||
    !SAFE_ID.test(busId) ||
    typeof routeId !== "string" ||
    !SAFE_ID.test(routeId)
  ) {
    return null;
  }
  return { busId, routeId };
}

export async function verifyDeviceSecretHash(
  secret: string,
  encodedHash: unknown,
): Promise<boolean> {
  let salt = DUMMY_SALT;
  let storedKey = DUMMY_HASH;
  let storedHashIsValid = false;
  if (typeof encodedHash === "string") {
    const [candidateSalt, candidateKey, ...extra] = encodedHash.split(":");
    if (
      extra.length === 0 &&
      /^[a-f0-9]{32}$/i.test(candidateSalt ?? "") &&
      /^[a-f0-9]{128}$/i.test(candidateKey ?? "")
    ) {
      salt = candidateSalt;
      storedKey = Buffer.from(candidateKey, "hex");
      storedHashIsValid = true;
    }
  }
  const derived = (await scryptLimiter.run(() => scryptAsync(secret, salt, 64))) as Buffer;
  return safeBufferEqual(derived, storedKey) && storedHashIsValid;
}

export async function authenticateDeviceCredentials(
  deviceId: string,
  secret: string,
  now: number,
): Promise<DeviceAssignment | null> {
  ensureDeviceCredentialInvalidationListener();
  const suppliedDigest = digestSecret(secret);
  const cacheKey = credentialCacheKey(deviceId, suppliedDigest);
  const cached = credentialCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    credentialCacheHits += 1;
    if (
      cached.assignment &&
      cached.secretDigest &&
      safeBufferEqual(suppliedDigest, cached.secretDigest)
    ) {
      return cached.assignment;
    }
    return null;
  }

  credentialCacheMisses += 1;

  const deviceDoc = await db.collection("devices").doc(deviceId).get();
  const device = deviceDoc.data() as Record<string, unknown> | undefined;
  const assignment = deviceDoc.exists ? assignmentFromDevice(device) : null;
  const secretMatches = await verifyDeviceSecretHash(secret, device?.secretHash);
  if (!assignment || !secretMatches) {
    cacheCredential(cacheKey, {
      assignment: null,
      secretDigest: suppliedDigest,
      expiresAt: now + NEGATIVE_CACHE_MS,
    });
    return null;
  }

  const [busDoc, routeDoc] = await Promise.all([
    db.collection("buses").doc(assignment.busId).get(),
    db.collection("routes").doc(assignment.routeId).get(),
  ]);
  const bus = busDoc.data();
  const assignedRoutes = Array.isArray(bus?.assignedRoutes)
    ? bus.assignedRoutes
    : typeof bus?.assignedRouteId === "string"
      ? [bus.assignedRouteId]
      : [];
  if (
    !busDoc.exists ||
    !routeDoc.exists ||
    !assignedRoutes.includes(assignment.routeId)
  ) {
    cacheCredential(cacheKey, {
      assignment: null,
      secretDigest: suppliedDigest,
      expiresAt: now + NEGATIVE_CACHE_MS,
    });
    return null;
  }

  cacheCredential(cacheKey, {
    assignment,
    secretDigest: suppliedDigest,
    expiresAt: now + CREDENTIAL_CACHE_MS,
  });
  return assignment;
}

async function deviceRateLimitRetryAfterMs(
  deviceId: string,
  now: number,
): Promise<number | null> {
  const limit = readPositiveInt(
    process.env.HTTPS_DEVICE_RATE_PER_MINUTE,
    DEFAULT_DEVICE_RATE_PER_MINUTE,
  );
  const transaction = await rtdb.ref(`${DEVICE_RATE_LIMIT_PATH}/${deviceId}`).transaction((value) => {
    const record = value as Partial<RateBucket> | null;
    const current =
      Number.isFinite(record?.startedAt) &&
      Number.isSafeInteger(record?.count) &&
      Number(record?.count) >= 0
        ? { startedAt: Number(record?.startedAt), count: Number(record?.count) }
        : undefined;
    const decision = evaluateDeviceRateLimit(current, now, limit);
    return decision.next;
  });
  const bucket = transaction.snapshot.val() as Partial<RateBucket> | null;
  const startedAt = Number(bucket?.startedAt);
  const count = Number(bucket?.count);
  if (
    !transaction.committed ||
    !Number.isFinite(startedAt) ||
    !Number.isSafeInteger(count)
  ) {
    throw new Error("Device rate-limit transaction did not commit valid state.");
  }
  return count <= limit
    ? null
    : Math.max(1, 60_000 - (now - startedAt));
}

function durableLifecycle(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  if (
    value.status !== "active" ||
    typeof value.sessionId !== "string" ||
    typeof value.driverId !== "string" ||
    (value.tripState !== "pre_departure" &&
      value.tripState !== "in_service")
  ) {
    return null;
  }
  return {
    sessionId: value.sessionId,
    driverId: value.driverId,
    status: "active",
    direction: value.direction === "reverse" ? "reverse" : "forward",
    originStopId: typeof value.originStopId === "string" ? value.originStopId : null,
    destinationStopId:
      typeof value.destinationStopId === "string" ? value.destinationStopId : null,
    automaticTurnaround: value.automaticTurnaround === true,
    previousSessionId:
      typeof value.previousSessionId === "string" ? value.previousSessionId : null,
    completedAt: null,
    turnaroundEligibleAt: null,
    turnaroundClaimId: null,
    turnaroundClaimedAt: null,
    tripState: value.tripState,
    currentStopIndex: Number.isInteger(value.currentStopIndex)
      ? value.currentStopIndex
      : 0,
    hasDepartedOrigin: value.hasDepartedOrigin === true,
    delayMinutes:
      typeof value.delayMinutes === "number" ? value.delayMinutes : 0,
    delayUpdatedAt:
      typeof value.delayUpdatedAt === "number" ? value.delayUpdatedAt : 0,
  };
}

async function restoreDurableRide(
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
): Promise<void> {
  const nodeKey = `${assignment.busId}_${assignment.routeId}`;
  const now = Date.now();
  const missExpiresAt = durableRideMisses.get(nodeKey) ?? 0;
  if (missExpiresAt > now) return;

  const activeRide = await db.collection("active_rides").doc(nodeKey).get();
  const lifecycle = activeRide.exists
    ? durableLifecycle(
        activeRide.data() as Record<string, unknown>,
      )
    : null;
  if (!lifecycle) {
    if (
      !durableRideMisses.has(nodeKey) &&
      durableRideMisses.size >= MAX_DURABLE_RIDE_MISSES
    ) {
      for (const [key, expiresAt] of durableRideMisses) {
        if (expiresAt <= now) durableRideMisses.delete(key);
      }
      if (durableRideMisses.size >= MAX_DURABLE_RIDE_MISSES) {
        const oldest = durableRideMisses.keys().next().value;
        if (oldest) durableRideMisses.delete(oldest);
      }
    }
    durableRideMisses.set(nodeKey, now + DURABLE_RIDE_MISS_CACHE_MS);
    return;
  }
  durableRideMisses.delete(nodeKey);

  await rtdb.ref(`activeBuses/${nodeKey}`).transaction((current) => {
    const live = current as Record<string, unknown> | null;
    if (
      live?.status === "active" &&
      typeof live.sessionId === "string"
    ) {
      return;
    }
    const telemetry = shouldApplyRestoreTelemetry(
      live?.timestamp,
      sample.timestamp,
    ) ? sample : {};
    // The durable lifecycle can hold a delay older than the live node if a
    // delay update only partially landed; never regress the announced value.
    const delay = freshestDelayMinutes(live, lifecycle);
    return {
      ...(live ?? {}),
      ...telemetry,
      ...lifecycle,
      ...delay,
      busId: assignment.busId,
      routeId: assignment.routeId,
      deviceState: "online",
      signalState:
        sample.motionState === "uncertain" ? "gnss_lost" : "connected",
    };
  });
}

function scheduleDurableRideRestore(
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
): void {
  const nodeKey = `${assignment.busId}_${assignment.routeId}`;
  if (durableRideRestores.has(nodeKey)) return;

  const restore = restoreDurableRide(assignment, sample)
    .catch((error) => {
      // Surface through the failure tracker too (issue #38): sustained
      // failures escalate to an error-level alert and show up on /health.
      recordBackgroundFailure(
        "devices.durableRideRestore",
        "Durable ride recovery",
        `[Devices] Durable ride recovery failed for ${nodeKey}:`,
        error,
      );
    })
    .finally(() => {
      if (durableRideRestores.get(nodeKey) === restore) {
        durableRideRestores.delete(nodeKey);
      }
    });
  durableRideRestores.set(nodeKey, restore);
}

async function persistTelemetry(
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
): Promise<{ committed: boolean; hasSession: boolean }> {
  const writeStartedAt = Date.now();
  const nodeKey = `${assignment.busId}_${assignment.routeId}`;
  const ref = rtdb.ref(`activeBuses/${nodeKey}`);
  const transaction = await ref.transaction((current) => {
    const live = current as Record<string, unknown> | null;
    const existingTimestamp = Number(live?.timestamp);
    if (
      Number.isFinite(existingTimestamp) &&
      existingTimestamp >= sample.timestamp
    ) {
      return;
    }

    const previousLat = Number(live?.lat);
    const previousLng = Number(live?.lng);
    const previousSpeed = Number(live?.speed);
    const previousTimestamp = Number(live?.timestamp);
    const previous =
      Number.isFinite(previousLat) &&
      Number.isFinite(previousLng) &&
      Number.isFinite(previousSpeed) &&
      Number.isFinite(previousTimestamp)
        ? {
            lat: previousLat,
            lng: previousLng,
            speed: previousSpeed,
            timestamp: previousTimestamp,
          }
        : null;
    const transitionIsPlausible = isPlausibleTelemetryTransition(previous, sample);
    const acceptedSample = transitionIsPlausible || !previous
      ? sample
      : {
          ...sample,
          lat: previous.lat,
          lng: previous.lng,
          speed: 0,
          heading:
            Number.isFinite(Number(live?.heading))
              ? Number(live?.heading)
              : sample.heading,
          motionState: "uncertain" as const,
        };

    return {
      ...(live ?? {
        status: "offline",
        tripState: "pre_departure",
        currentStopIndex: 0,
        hasDepartedOrigin: false,
        delayMinutes: 0,
      }),
      ...acceptedSample,
      busId: assignment.busId,
      routeId: assignment.routeId,
      deviceState: "online",
      signalState:
        acceptedSample.motionState === "uncertain"
          ? "gnss_lost"
          : "connected",
      receivedAt: { ".sv": "timestamp" },
    };
  });
  const value = transaction.snapshot.val() as Record<string, unknown> | null;
  recordSample(rtdbWriteLatencySamples, Date.now() - writeStartedAt);
  return {
    committed: transaction.committed,
    hasSession:
      value?.status === "active" && typeof value.sessionId === "string",
  };
}

export function parseDeviceAuthorization(
  authorization: string | undefined,
): string | null {
  if (!authorization?.startsWith("Device ")) return null;
  const secret = authorization.slice("Device ".length);
  return secret.length >= 20 && secret.length <= 512 ? secret : null;
}

export async function ingestDeviceTelemetry(
  deviceId: string,
  secret: string,
  sample: TelemetryPayload,
  now = Date.now(),
): Promise<TelemetryIngestResult> {
  const processingStartedAt = Date.now();
  if (!SAFE_ID.test(deviceId)) {
    status.rejected += 1;
    status.lastRejectedAt = new Date(now).toISOString();
    return { ok: false, reason: "credentials" };
  }

  const assignment = await authenticateDeviceCredentials(deviceId, secret, now);
  if (!assignment) {
    status.rejected += 1;
    status.lastRejectedAt = new Date(now).toISOString();
    return { ok: false, reason: "credentials" };
  }
  const retryAfterMs = await deviceRateLimitRetryAfterMs(deviceId, now);
  if (retryAfterMs !== null) {
    status.rejected += 1;
    status.lastRejectedAt = new Date(now).toISOString();
    return { ok: false, reason: "rate_limit", retryAfterMs };
  }

  const persisted = await persistTelemetry(assignment, sample);
  if (!persisted.hasSession) {
    // RTDB already contains the accepted fix at this point. Recover the
    // durable lifecycle immediately in the background so the hardware response
    // is not delayed by an additional Firestore read.
    scheduleDurableRideRestore(assignment, sample);
  }
  if (persisted.committed) {
    status.accepted += 1;
    status.lastAcceptedAt = new Date(now).toISOString();
  }
  recordSample(processingLatencySamples, Date.now() - processingStartedAt);
  // Device timestamps come from NTP-synchronised wall time. Ignore implausible
  // values instead of letting a bad device clock corrupt the rolling window.
  const deviceToServerLatency = Date.now() - sample.timestamp;
  if (deviceToServerLatency <= 24 * 60 * 60 * 1000) {
    recordSample(deviceToServerLatencySamples, deviceToServerLatency);
  }
  return { ok: true, duplicate: !persisted.committed };
}

export function recordTelemetryRejection(now = Date.now()): void {
  status.rejected += 1;
  status.lastRejectedAt = new Date(now).toISOString();
}

export function invalidateDeviceCredentialCache(deviceId: string): void {
  const prefix = `${deviceId}:`;
  for (const key of credentialCache.keys()) {
    if (key.startsWith(prefix)) credentialCache.delete(key);
  }
}

export async function publishDeviceCredentialInvalidation(deviceId: string): Promise<void> {
  if (!SAFE_ID.test(deviceId)) throw new Error("Invalid device ID.");
  invalidateDeviceCredentialCache(deviceId);
  await rtdb.ref(`${DEVICE_CREDENTIAL_VERSION_PATH}/${deviceId}`).set({
    nonce: randomBytes(12).toString("hex"),
    updatedAt: { ".sv": "timestamp" },
  });
}

export function getHttpsTelemetryStatus(): HttpsTelemetryStatus {
  const credentialAttempts = credentialCacheHits + credentialCacheMisses;
  return {
    ...status,
    credentialCacheHitRate:
      credentialAttempts === 0
        ? null
        : Number((credentialCacheHits / credentialAttempts).toFixed(3)),
    processingLatencyMs: summarizeLatencySamples(processingLatencySamples),
    deviceToServerLatencyMs: summarizeLatencySamples(deviceToServerLatencySamples),
    rtdbWriteLatencyMs: summarizeLatencySamples(rtdbWriteLatencySamples),
  };
}

export async function hashDeviceSecret(secret: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptLimiter.run(() => scryptAsync(secret, salt, 64))) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}
