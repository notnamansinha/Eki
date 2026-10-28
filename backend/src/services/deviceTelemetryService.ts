import { scheduleAutomaticServiceAdmission, invalidateAutomaticServiceAdmission, isAutomaticServiceAdmissionDeferred } from "./automaticServiceAdmission";
import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { db, rtdb } from "../lib/firebaseAdmin";
import { createConcurrencyLimiter } from "../lib/concurrency";
import { createBoundedSingleFlight, SingleFlightCapacityError, SingleFlightDeadlineError } from "../lib/boundedSingleFlight";
import { BoundedKeyedExecutor, WorkCapacityError } from "../lib/boundedKeyedExecutor";
import { ExecutionDeadline, TelemetryExecutionFailure, currentExecutionDeadline } from "../lib/executionDeadline";
import { recordBackgroundFailure } from "../lib/backgroundFailureTracker";
import { evaluateOutageReacquisition, isPlausibleTelemetryTransition } from "../lib/telemetryMotion";
import { restoreDurableRide } from "./durableRideRecovery";
export { durableLifecycle, freshestDelayMinutes, shouldApplyRestoreTelemetry } from "./durableRideRecoveryPolicy";
export type { DelayPreference } from "./durableRideRecoveryPolicy";
import type { TelemetryPayload } from "./telemetryPayload";
import { telemetryDiagnosticCounters } from "./telemetryDiagnosticCounters";
import { scheduleTelemetryRouteProcessing } from "./telemetryRouteService";
import {
  AuthenticatedDeviceRateLimiter,
  readDeviceRateLimitConfiguration,
  reserveRateLimitTokens,
  type DistributedTokenReservation,
  type RateBucket,
} from "./deviceRateLimiter";

export {
  evaluateDeviceRateLimit,
  type DeviceRateLimitDecision,
} from "./deviceRateLimiter";

const scryptAsync = promisify(scrypt);
// scrypt is memory-hard; cap concurrent verifications so a burst of credential
// cache misses cannot exhaust CPU/ memory on the request path (issue #48 L1).
const SCRYPT_MAX_CONCURRENT = 4;
const scryptLimiter = createConcurrencyLimiter(SCRYPT_MAX_CONCURRENT);
// Refills of previously verified credentials get their own small KDF lane so
// unauthenticated cache misses can never queue ahead of the fleet.
const verifiedScryptLimiter = createConcurrencyLimiter(2, { maxPending: 8 });
const ingestionExecution = new BoundedKeyedExecutor<string>({ maxConcurrent: 8, maxPending: 32, maxPendingPerKey: 1, maxQueueAgeMs: 2_000 });
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
// Firestore rejects __*__ document IDs as reserved (INVALID_ARGUMENT). Such an
// ID can never be provisioned, so treat it as an invalid credential instead of
// letting the registry read fail as a retryable dependency outage.
const RESERVED_DOCUMENT_ID = /^__.*__$/;
const CREDENTIAL_CACHE_MS = 60_000;
// When a verified credential's reserved refill lane is saturated, keep serving
// it for at most this long past expiry. Explicit invalidation still deletes it.
const CREDENTIAL_STALE_GRACE_MS = 10 * 60_000;
const NEGATIVE_CACHE_MS = 5_000;
const MAX_CREDENTIAL_CACHE_ENTRIES = 1_000;
const DEVICE_RATE_LIMIT_PATH = "_deviceRateLimits";
const DEVICE_CREDENTIAL_VERSION_PATH = "_deviceCredentialVersions";

export interface DeviceAssignment {
  busId: string;
  routeId: string;
  deviceId?: string;
  assignmentRevision?: number;
}

export type DeviceCredentialResult =
  | { status: "invalid" | "unassigned" }
  | { status: "assigned"; assignment: DeviceAssignment };

export class DeviceCredentialVerificationInvalidatedError extends Error {
  constructor() { super("Device credentials changed during verification; retry with the current registry."); }
}

interface CredentialCacheEntry {
  assignment: DeviceAssignment | null;
  unassigned: boolean;
  secretDigest: Buffer | null;
  expiresAt: number;
  expiresMonotonicAt: number;
}

export interface HttpsTelemetryStatus {
  diagnostics: ReturnType<typeof telemetryDiagnosticCounters>;
  accepted: number;
  rejected: number;
  lastAcceptedAt: string | null;
  lastRejectedAt: string | null;
  credentialCacheHitRate: number | null;
  credentialFills: { activeFills: number; waitingCallers: number };
  kdfExecution: ReturnType<typeof scryptLimiter.snapshot>;
  ingestionExecution: ReturnType<typeof ingestionExecution.snapshot>;
  processingLatencyMs: LatencySummary;
  deviceQueueLatencyMs: LatencySummary;
  networkLatencyMs: LatencySummary;
  deviceToServerLatencyMs: LatencySummary;
  rtdbWriteLatencyMs: LatencySummary;
  rtdbTransactionAttempts: LatencySummary;
  rateLimit: {
    mode: "local" | "distributed";
    limitPerMinute: number;
    leaseSize: number;
    replicas: number;
    localDecisions: number;
    leaseHits: number;
    storeTransactions: number;
    storeTransactionRetries: number;
    decisionLatencyMs: LatencySummary;
  };
  serverIngressGapMs: LatencySummary;
}

export interface LatencySummary {
  samples: number;
  average: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

/**
 * A powered device proves only device presence. Ride lifecycle fields are
 * introduced by the transactional arm/direction-resolution flow, never by
 * telemetry ingestion itself.
 */
export function initialDevicePresenceState(): { status: "offline" } {
  return { status: "offline" };
}

export type TelemetryIngestResult =
  | { ok: true; duplicate: boolean }
  | {
      ok: false;
      reason: "credentials" | "unassigned";
    }
  | {
      ok: false;
      reason: "rate_limit";
      retryAfterMs: number;
    };

const credentialCache = new Map<string, CredentialCacheEntry>();
const rejectedCredentialCache = new Map<string, CredentialCacheEntry>();
const credentialFills = createBoundedSingleFlight<DeviceCredentialResult>({
  maxFills: 16, maxWaitersPerFill: 64, responseMs: 5_000,
});
// Reserved for re-verifying a deviceId+secret pair that already verified. An
// unauthenticated caller cannot produce such a key, so a flood of unknown IDs
// or guessed secrets cannot occupy these slots.
const verifiedCredentialFills = createBoundedSingleFlight<DeviceCredentialResult>({
  maxFills: 8, maxWaitersPerFill: 64, responseMs: 5_000,
});
const durableRideRestores = new Map<string, Promise<void>>();
const durableRideRestoreLatest = new Map<string, { assignment: DeviceAssignment; sample: TelemetryPayload; allowAdmission: boolean }>();
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
export const TELEMETRY_METRIC_SAMPLE_CAPACITY = 512;
const processingLatencySamples: number[] = [];
const deviceQueueLatencySamples: number[] = [];
const networkLatencySamples: number[] = [];
const deviceToServerLatencySamples: number[] = [];
const rtdbWriteLatencySamples: number[] = [];
const rtdbTransactionAttemptSamples: number[] = [];
const rateLimitDecisionLatencySamples: number[] = [];
const serverIngressGapSamples: number[] = [];
const lastServerIngressByDevice = new Map<string, number>();
let credentialCacheHits = 0;
let credentialCacheMisses = 0;
let deviceRateLimitLocalDecisions = 0;
let deviceRateLimitLeaseHits = 0;
let deviceRateLimitStoreTransactions = 0;
let deviceRateLimitStoreTransactionRetries = 0;

const deviceRateLimitConfiguration = readDeviceRateLimitConfiguration();
const authenticatedDeviceRateLimiter = new AuthenticatedDeviceRateLimiter(
  deviceRateLimitConfiguration,
  reserveDistributedDeviceTokens,
);

const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH = Buffer.alloc(64);

function recordSample(samples: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  if (samples.length >= TELEMETRY_METRIC_SAMPLE_CAPACITY) samples.shift();
  samples.push(value);
}

export function telemetryUpdateGapMs(
  previousReceivedAt: number | undefined,
  receivedAt: number,
): number | null {
  if (
    !Number.isFinite(previousReceivedAt) ||
    !Number.isFinite(receivedAt) ||
    receivedAt < Number(previousReceivedAt)
  ) {
    return null;
  }
  return receivedAt - Number(previousReceivedAt);
}

function recordServerIngressGap(deviceId: string, receivedAt: number): void {
  const gap = telemetryUpdateGapMs(
    lastServerIngressByDevice.get(deviceId),
    receivedAt,
  );
  if (gap !== null) recordSample(serverIngressGapSamples, gap);
  if (
    !lastServerIngressByDevice.has(deviceId) &&
    lastServerIngressByDevice.size >= MAX_CREDENTIAL_CACHE_ENTRIES
  ) {
    const oldest = lastServerIngressByDevice.keys().next().value;
    if (oldest) lastServerIngressByDevice.delete(oldest);
  }
  lastServerIngressByDevice.set(deviceId, receivedAt);
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

/**
 * Device sequence numbers survive queued retries but may restart after a cold
 * boot. Device time is therefore the primary ordering key; sequence only
 * disambiguates samples captured in the same millisecond.
 */
export function telemetrySampleIsNewer(
  existingTimestamp: unknown,
  existingSequence: unknown,
  candidate: Pick<TelemetryPayload, "timestamp" | "seq" | "deviceTimestamp">,
  existingDeviceTimestamp?: unknown,
): boolean {
  const timestamp = Number(existingTimestamp);
  if (!Number.isFinite(timestamp)) return true;
  const sequence = Number(existingSequence);
  const hasSequence = Number.isSafeInteger(sequence);
  // Future timestamps are clamped to server time, so two samples from a fast
  // device clock compare by arrival. A candidate whose raw capture time AND
  // sequence both precede the stored fix is a late-delivered older sample.
  // Requiring both keeps a reboot (seq restarts) or a clock correction (raw
  // time goes back) from rejecting legitimate fixes.
  const storedCapture = existingDeviceTimestamp === undefined || existingDeviceTimestamp === null
    ? timestamp
    : Number(existingDeviceTimestamp);
  if (
    hasSequence &&
    Number.isFinite(storedCapture) &&
    candidate.seq < sequence &&
    (candidate.deviceTimestamp ?? candidate.timestamp) < storedCapture
  ) return false;
  if (candidate.timestamp !== timestamp) return candidate.timestamp > timestamp;

  return hasSequence && candidate.seq > sequence;
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
  // Verified and rejected entries are bounded separately so a flood of guessed
  // device IDs or secrets cannot evict verified fleet credentials. Expired
  // verified entries stay as proof that a deviceId+secret pair verified
  // before, which routes its refill through the reserved lane.
  const target = value.assignment ? credentialCache : rejectedCredentialCache;
  (target === credentialCache ? rejectedCredentialCache : credentialCache).delete(cacheKey);
  if (
    !target.has(cacheKey) &&
    target.size >= MAX_CREDENTIAL_CACHE_ENTRIES
  ) {
    const oldest = target.keys().next().value;
    if (oldest) target.delete(oldest);
  }
  target.set(cacheKey, value);
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
    credentialCache.clear();
    rejectedCredentialCache.clear();
    credentialFills.invalidate();
    verifiedCredentialFills.invalidate();
    versions.off("child_added", invalidate);
    versions.off("child_changed", invalidate);
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
    RESERVED_DOCUMENT_ID.test(busId) ||
    typeof routeId !== "string" ||
    !SAFE_ID.test(routeId) ||
    RESERVED_DOCUMENT_ID.test(routeId)
  ) {
    return null;
  }
  return { busId, routeId,
    ...(typeof device?.deviceId === "string" ? { deviceId: device.deviceId } : {}),
    ...(Number.isSafeInteger(device?.assignmentRevision) ? { assignmentRevision: Number(device?.assignmentRevision) } : {}),
  };
}

export async function verifyDeviceSecretHash(
  secret: string,
  encodedHash: unknown,
  mayDispatch: () => boolean = () => true,
): Promise<boolean> {
  return verifySecretHashWith(scryptLimiter, secret, encodedHash, mayDispatch);
}

async function verifySecretHashWith(
  limiter: typeof scryptLimiter,
  secret: string,
  encodedHash: unknown,
  mayDispatch: () => boolean,
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
  const deadline = currentExecutionDeadline();
  const derived = (await limiter.run(() => {
    deadline?.assert();
    if (!mayDispatch()) throw new SingleFlightDeadlineError();
    return scryptAsync(secret, salt, 64);
  })) as Buffer;
  return safeBufferEqual(derived, storedKey) && storedHashIsValid;
}

export async function checkDeviceCredentials(
  deviceId: string,
  secret: string,
  now: number,
): Promise<DeviceCredentialResult> {
  if (RESERVED_DOCUMENT_ID.test(deviceId)) return { status: "invalid" };
  ensureDeviceCredentialInvalidationListener();
  const suppliedDigest = digestSecret(secret);
  const cacheKey = credentialCacheKey(deviceId, suppliedDigest);
  const cached = credentialCache.get(cacheKey) ?? rejectedCredentialCache.get(cacheKey);
  if (cached && cached.expiresAt > now && cached.expiresMonotonicAt > performance.now()) {
    credentialCacheHits += 1;
    if (
      cached.assignment &&
      cached.secretDigest &&
      safeBufferEqual(suppliedDigest, cached.secretDigest)
    ) {
      return { status: "assigned", assignment: cached.assignment };
    }
    return { status: cached.unassigned && cached.secretDigest && safeBufferEqual(suppliedDigest, cached.secretDigest) ? "unassigned" : "invalid" };
  }

  credentialCacheMisses += 1;
  const previouslyVerified = credentialCache.get(cacheKey);
  const reserved = Boolean(
    previouslyVerified?.assignment &&
    previouslyVerified.secretDigest &&
    safeBufferEqual(suppliedDigest, previouslyVerified.secretDigest),
  );
  try {
    return await fillDeviceCredentials(deviceId, secret, now, suppliedDigest, cacheKey, reserved);
  } catch (error) {
    // Only a pair that verified before, was never invalidated, and cannot get
    // a reserved refill slot may keep its assignment, for a bounded grace.
    if (
      reserved &&
      previouslyVerified?.assignment &&
      credentialCache.get(cacheKey) === previouslyVerified &&
      (error instanceof SingleFlightCapacityError || error instanceof WorkCapacityError) &&
      previouslyVerified.expiresAt + CREDENTIAL_STALE_GRACE_MS > now &&
      previouslyVerified.expiresMonotonicAt + CREDENTIAL_STALE_GRACE_MS > performance.now()
    ) {
      return { status: "assigned", assignment: previouslyVerified.assignment };
    }
    throw error;
  }
}

function fillDeviceCredentials(
  deviceId: string,
  secret: string,
  now: number,
  suppliedDigest: Buffer,
  cacheKey: string,
  reserved: boolean,
): Promise<DeviceCredentialResult> {
  const fills = reserved ? verifiedCredentialFills : credentialFills;
  const kdf = reserved ? verifiedScryptLimiter : scryptLimiter;
  return fills.run(cacheKey, deviceId, async isCurrent => {
    if (!isCurrent()) throw new SingleFlightDeadlineError();
    const assertCurrent = () => {
      // An initial version snapshot or concurrent credential update invalidates
      // this read; it is not evidence that the supplied secret is incorrect.
      // Throw so device routes return a retryable 503 instead of latching 401.
      if (!isCurrent()) throw new DeviceCredentialVerificationInvalidatedError();
    };
    const fillStartedAt = performance.now();
    const publish = (value: CredentialCacheEntry) => {
      assertCurrent();
      cacheCredential(cacheKey, value);
      return true;
    };
    const deviceDoc = await db.collection("devices").doc(deviceId).get();
    assertCurrent();
    const device = deviceDoc.data() as Record<string, unknown> | undefined;
    const assignment = deviceDoc.exists ? assignmentFromDevice(device) : null;
    const secretMatches = await verifySecretHashWith(kdf, secret, device?.secretHash, isCurrent);
    assertCurrent();
    if (!assignment || !secretMatches) {
      const unassigned = secretMatches && device?.enabled !== false;
      publish({
        assignment: null,
        unassigned,
        secretDigest: suppliedDigest,
        expiresAt: now + NEGATIVE_CACHE_MS,
        expiresMonotonicAt: fillStartedAt + NEGATIVE_CACHE_MS,
      });
      return { status: unassigned ? "unassigned" : "invalid" };
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
      publish({
        assignment: null,
        unassigned: true,
        secretDigest: suppliedDigest,
        expiresAt: now + NEGATIVE_CACHE_MS,
        expiresMonotonicAt: fillStartedAt + NEGATIVE_CACHE_MS,
      });
      return { status: "unassigned" };
    }

    const published = publish({
      assignment,
      unassigned: false,
      secretDigest: suppliedDigest,
      expiresAt: now + CREDENTIAL_CACHE_MS,
      expiresMonotonicAt: fillStartedAt + CREDENTIAL_CACHE_MS,
    });
    return published ? { status: "assigned", assignment } : { status: "invalid" };
  });
}

export async function authenticateDeviceCredentials(deviceId: string, secret: string, now: number): Promise<DeviceAssignment | null> {
  const result = await checkDeviceCredentials(deviceId, secret, now);
  return result.status === "assigned" ? result.assignment : null;
}

async function deviceRateLimitRetryAfterMs(
  deviceId: string,
  now: number,
): Promise<number | null> {
  const startedAt = Date.now();
  try {
    const result = await authenticatedDeviceRateLimiter.consume(deviceId, now);
    if (result.source === "local") deviceRateLimitLocalDecisions += 1;
    if (result.source === "lease") deviceRateLimitLeaseHits += 1;
    return result.retryAfterMs;
  } finally {
    recordSample(rateLimitDecisionLatencySamples, Date.now() - startedAt);
  }
}

async function reserveDistributedDeviceTokens(
  deviceId: string,
  now: number,
  limit: number,
  requested: number,
): Promise<DistributedTokenReservation> {
  const deadline = currentExecutionDeadline();
  deadline?.assert();
  let callbackAttempts = 0;
  let finalDecision: ReturnType<typeof reserveRateLimitTokens> | null = null;
  deviceRateLimitStoreTransactions += 1;
  const transaction = await rtdb
    .ref(`${DEVICE_RATE_LIMIT_PATH}/${deviceId}`)
    .transaction((value) => {
      if (deadline && !deadline.isActive()) return undefined;
      callbackAttempts += 1;
      const record = value as Partial<RateBucket> | null;
      const existing = record
        ? {
            startedAt: Number(record.startedAt),
            count: Number(record.count),
          }
        : undefined;
      finalDecision = reserveRateLimitTokens(existing, now, limit, requested);
      return finalDecision.granted > 0 ? finalDecision.next : undefined;
    })
    .finally(() => {
      deviceRateLimitStoreTransactionRetries += Math.max(0, callbackAttempts - 1);
    });
  if (!finalDecision) {
    throw new Error("Device rate-limit transaction did not evaluate a bucket.");
  }
  const decision = finalDecision as ReturnType<typeof reserveRateLimitTokens>;
  if (decision.granted === 0) {
    return {
      granted: 0,
      expiresAt: decision.next.startedAt + 60_000,
      retryAfterMs: decision.retryAfterMs,
      transactionAttempts: callbackAttempts,
    };
  }
  const bucket = transaction.snapshot.val() as Partial<RateBucket> | null;
  if (
    !transaction.committed ||
    Number(bucket?.startedAt) !== decision.next.startedAt ||
    Number(bucket?.count) !== decision.next.count
  ) {
    throw new Error("Device rate-limit transaction did not commit its token lease.");
  }
  return {
    granted: decision.granted,
    expiresAt: decision.next.startedAt + 60_000,
    retryAfterMs: 0,
    transactionAttempts: callbackAttempts,
  };
}

function scheduleDurableRideRestore(
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
  claimId: string | null,
  recoverTerminal: boolean,
  allowAdmission: boolean,
): void {
  const nodeKey = `${assignment.busId}_${assignment.routeId}`;
  const previous = durableRideRestoreLatest.get(nodeKey);
  const sameAssignment = previous?.assignment.deviceId === assignment.deviceId && previous?.assignment.assignmentRevision === assignment.assignmentRevision;
  durableRideRestoreLatest.set(nodeKey, { assignment, sample, allowAdmission: allowAdmission || (sameAssignment && previous?.allowAdmission === true) });
  if (durableRideRestores.has(nodeKey)) return;

  const restore = restoreDurableRide(assignment, sample, claimId, recoverTerminal)
    .then(restored => {
      const latest = durableRideRestoreLatest.get(nodeKey);
      if (!restored && latest?.allowAdmission) scheduleAutomaticServiceAdmission(latest.assignment, latest.sample);
    })
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
        durableRideRestoreLatest.delete(nodeKey);
      }
    });
  durableRideRestores.set(nodeKey, restore);
}

/**
 * Preserve unknown HDOP instead of letting Number(null) turn it into 0.
 * A valid live value may fill an absent, null, or invalid anchor value.
 */
export function previousTelemetryGpsHdop(
  anchor: Record<string, unknown> | undefined,
  live: Record<string, unknown> | null | undefined,
): number | null {
  const anchorHdop = anchor?.gpsHdop;
  if (typeof anchorHdop === "number" && Number.isFinite(anchorHdop)) {
    return anchorHdop;
  }
  const liveHdop = live?.gpsHdop;
  return typeof liveHdop === "number" && Number.isFinite(liveHdop)
    ? liveHdop
    : null;
}

export function nextTelemetryValue(
  current: Record<string, unknown> | null,
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
  backendReceivedAt: number,
): Record<string, unknown> | undefined {
  if (typeof current?.retiredAssignmentRevision === "number" &&
      (!assignment.deviceId || assignment.deviceId === current.deviceId) &&
      (assignment.assignmentRevision ?? 0) < current.retiredAssignmentRevision) return;
  const existingTimestamp = Number(current?.timestamp);
  if (!telemetrySampleIsNewer(
    existingTimestamp,
    current?.seq,
    sample,
    current?.deviceTimestamp,
  )) {
    return undefined;
  }

  const anchor = current?.plausibilityAnchor as Record<string, unknown> | undefined;
  const previousLat = Number(anchor?.lat ?? current?.lat);
  const previousLng = Number(anchor?.lng ?? current?.lng);
  const previousSpeed = Number(anchor?.speed ?? current?.speed);
  const previousGpsHdop = previousTelemetryGpsHdop(anchor, current);
  const previousTimestamp = Number(anchor?.timestamp ?? current?.timestamp);
  const previous =
    Number.isFinite(previousLat) &&
    Number.isFinite(previousLng) &&
    Number.isFinite(previousSpeed) &&
    Number.isFinite(previousTimestamp)
      ? {
          lat: previousLat,
          lng: previousLng,
          speed: previousSpeed,
          gpsHdop: previousGpsHdop,
          timestamp: previousTimestamp,
        }
      : null;
  const ordinaryTransition = isPlausibleTelemetryTransition(previous, sample);
  const reacquisition = ordinaryTransition ? { accepted: false } : evaluateOutageReacquisition(
    previous, sample, current?.rawLocation, current?.plausibilityReacquisition,
  );
  const transitionIsPlausible = ordinaryTransition || reacquisition.accepted;
  const acceptedSample = transitionIsPlausible || !previous
    ? sample
    : {
        ...sample,
        lat: previous.lat,
        lng: previous.lng,
        speed: 0,
        heading:
          Number.isFinite(Number(current?.heading))
            ? Number(current?.heading)
            : sample.heading,
        motionState: "uncertain" as const,
      };
  const plausibilityAnchor = transitionIsPlausible || !previous
    ? sample
    : previous;

  // Retire only verified obsolete fields. Preserve lifecycle, current matching
  // state, and unknown fields so a rolling deployment cannot erase new state.
  const currentState: Record<string, unknown> = { ...(current ?? initialDevicePresenceState()) };
  delete currentState.rtdbCommittedAt; // Same server timestamp as receivedAt.
  delete currentState.activeRoutePolyline; // Geometry lives in the versioned sibling store.
  delete currentState.plausibilityReacquisition;
  delete currentState.retiredAssignmentRevision;
  delete currentState.deviceTimestamp; // Present only while the accepted sample was clamped.

  return {
    // Device presence is not a ride. Lifecycle fields are introduced only by
    // the transactional arm/direction-resolution path.
    ...currentState,
    ...acceptedSample,
    ...(reacquisition.pending ? { plausibilityReacquisition: reacquisition.pending } : {}),
    // Keep the authenticated GNSS fix independently observable even when
    // plausibility filtering retains the previous accepted live position.
    // Map matching writes a separate matchedLocation and never mutates this.
    rawLocation: {
      lat: sample.lat,
      lng: sample.lng,
      speed: sample.speed,
      heading: sample.heading,
      gpsHdop: sample.gpsHdop,
      motionState: sample.motionState,
      seq: sample.seq,
      sampledAt: sample.timestamp,
    },
    // Keep the last physically accepted fix separate from the monotonic live
    // sample timestamp so held outliers cannot reset reacquisition timing.
    plausibilityAnchor: {
      lat: plausibilityAnchor.lat,
      lng: plausibilityAnchor.lng,
      speed: plausibilityAnchor.speed,
      gpsHdop: plausibilityAnchor.gpsHdop,
      timestamp: plausibilityAnchor.timestamp,
    },
    busId: assignment.busId,
    routeId: assignment.routeId,
    ...(assignment.deviceId ? { deviceId: assignment.deviceId } : {}),
    ...(assignment.assignmentRevision !== undefined ? { assignmentRevision: assignment.assignmentRevision } : {}),
    deviceState: "online",
    signalState:
      acceptedSample.motionState === "uncertain"
        ? "gnss_lost"
        : "connected",
    backendReceivedAt,
    receivedAt: { ".sv": "timestamp" },
  };
}

async function persistTelemetry(
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
  backendReceivedAt: number,
): Promise<{ committed: boolean; hasSession: boolean; needsServiceSetup: boolean; allowAutomaticAdmission: boolean; claimId: string | null; recoverTerminal: boolean }> {
  const deadline = currentExecutionDeadline();
  deadline?.markWriteDispatched();
  const writeStartedAt = Date.now();
  const nodeKey = `${assignment.busId}_${assignment.routeId}`;
  const ref = rtdb.ref(`activeBuses/${nodeKey}`);
  let transactionAttempts = 0;
  const transaction = await ref.transaction((current) => {
    if (deadline && !deadline.isActive()) return undefined;
    transactionAttempts += 1;
    return nextTelemetryValue(
      current as Record<string, unknown> | null,
      assignment,
      sample,
      backendReceivedAt,
    );
  }, undefined, false);
  const value = transaction.snapshot.val() as Record<string, unknown> | null;
  recordSample(rtdbWriteLatencySamples, Date.now() - writeStartedAt);
  recordSample(rtdbTransactionAttemptSamples, transactionAttempts);
  return {
    committed: transaction.committed,
    needsServiceSetup: value?.serviceSetupPending === true && value?.tripState !== "completed" && value?.automaticServicePaused !== true,
    allowAutomaticAdmission: !value?.sessionId && value?.automaticServicePaused !== true,
    hasSession:
      value?.status === "active" && typeof value.sessionId === "string" && value.sessionId.length > 0 &&
      (value.tripState === "pre_departure" || value.tripState === "in_service"),
    claimId: typeof value?.turnaroundClaimId === "string" ? value.turnaroundClaimId : null,
    recoverTerminal: typeof value?.sessionId !== "string" || !value.sessionId,
  };
}

export function parseDeviceAuthorization(
  authorization: string | undefined,
): string | null {
  if (!authorization?.startsWith("Device ")) return null;
  const secret = authorization.slice("Device ".length);
  return secret.length >= 20 && secret.length <= 512 ? secret : null;
}

async function authenticateTelemetryDevice(
  deviceId: string,
  secret: string,
  now: number,
  deadline: ExecutionDeadline,
): Promise<DeviceCredentialResult> {
  const credential: DeviceCredentialResult = SAFE_ID.test(deviceId)
    ? await deadline.dependency("credentials", () => checkDeviceCredentials(deviceId, secret, now))
    : { status: "invalid" };
  if (credential.status !== "assigned") {
    status.rejected += 1;
    status.lastRejectedAt = new Date(now).toISOString();
  }
  return credential;
}

async function executeDeviceTelemetry(
  deviceId: string,
  assignment: DeviceAssignment,
  sample: TelemetryPayload,
  now: number,
  deadline: ExecutionDeadline,
): Promise<TelemetryIngestResult> {
  // One server ingress timestamp for the whole request boundary. `now` is
  // captured when the handler enters, so `backendReceivedAt` and the network
  // latency reflect receipt at the request boundary rather than after
  // authenticate/rate-limit and RTDB transaction work.
  const serverReceivedAt = now;
  const processingStartedAt = now;
  const retryAfterMs = await deadline.dependency("rate limit", () => deviceRateLimitRetryAfterMs(deviceId, now));
  if (retryAfterMs !== null) {
    status.rejected += 1;
    status.lastRejectedAt = new Date(now).toISOString();
    return { ok: false, reason: "rate_limit", retryAfterMs };
  }

  const persisted = await deadline.dependency("telemetry commit", () => persistTelemetry({ ...assignment, deviceId }, sample, serverReceivedAt));
  const allowAdmission = persisted.needsServiceSetup || (persisted.committed && persisted.allowAutomaticAdmission);
  if (allowAdmission && isAutomaticServiceAdmissionDeferred({ ...assignment, deviceId })) {
    // A restore already found no ride before this setup started; repeating its
    // Firestore reads on every fix would only lead back to the same admission.
    scheduleAutomaticServiceAdmission({ ...assignment, deviceId }, sample);
  } else if (!persisted.hasSession || persisted.needsServiceSetup) {
    // RTDB already contains the accepted fix at this point. Recover the
    // durable lifecycle immediately in the background so the hardware response
    // is not delayed by an additional Firestore read.
    scheduleDurableRideRestore({ ...assignment, deviceId }, sample, persisted.claimId, persisted.recoverTerminal, allowAdmission);
  }
  if (persisted.committed) {
    status.accepted += 1;
    status.lastAcceptedAt = new Date(now).toISOString();
    recordServerIngressGap(deviceId, serverReceivedAt);
    scheduleTelemetryRouteProcessing(assignment, sample);
  }
  recordSample(processingLatencySamples, Date.now() - processingStartedAt);
  recordSample(deviceQueueLatencySamples, sample.deviceSentAt - sample.timestamp);
  recordSample(networkLatencySamples, serverReceivedAt - sample.deviceSentAt);
  // Cross-clock values remain estimates until the firmware's request/response
  // timing establishes an offset bound. Use the ingress boundary here so this
  // metric does not also include authentication, rate limiting, or RTDB work.
  const deviceToServerLatency = serverReceivedAt - sample.timestamp;
  if (deviceToServerLatency <= 24 * 60 * 60 * 1000) {
    recordSample(deviceToServerLatencySamples, deviceToServerLatency);
  }
  return { ok: true, duplicate: !persisted.committed };
}

export async function ingestDeviceTelemetry(
  deviceId: string, secret: string, sample: TelemetryPayload, now = Date.now(),
): Promise<TelemetryIngestResult> {
  const deadline = new ExecutionDeadline();
  try {
    // Verify credentials before taking an ingestion slot. Pre-auth work is
    // already bounded by the credential single-flight and KDF limiters; letting
    // it occupy ingestion capacity would let unauthenticated requests stalled on
    // scrypt reject every cached, legitimate device with 503.
    const operation = deadline.run(async (): Promise<TelemetryIngestResult> => {
      deadline.assert();
      const credential = await authenticateTelemetryDevice(deviceId, secret, now, deadline);
      if (credential.status !== "assigned") {
        return { ok: false, reason: credential.status === "unassigned" ? "unassigned" : "credentials" };
      }
      return ingestionExecution.run(deviceId, () => {
        deadline.assert();
        return executeDeviceTelemetry(deviceId, credential.assignment, sample, now, deadline);
      });
    });
    return await deadline.waitForResponse(operation);
  } catch (error) {
    if (error instanceof TelemetryExecutionFailure) throw error;
    throw new TelemetryExecutionFailure("Telemetry service dependency failed.", deadline.hasUncertainCommit(), error);
  } finally { deadline.dispose(); }
}

export function recordTelemetryRejection(now = Date.now()): void {
  status.rejected += 1;
  status.lastRejectedAt = new Date(now).toISOString();
}

export function invalidateDeviceCredentialCache(deviceId: string): void {
  invalidateAutomaticServiceAdmission(deviceId);
  credentialFills.invalidate(deviceId);
  verifiedCredentialFills.invalidate(deviceId);
  const prefix = `${deviceId}:`;
  for (const cache of [credentialCache, rejectedCredentialCache]) {
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
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
    diagnostics: telemetryDiagnosticCounters(),
    credentialCacheHitRate:
      credentialAttempts === 0
        ? null
        : Number((credentialCacheHits / credentialAttempts).toFixed(3)),
    credentialFills: credentialFills.snapshot(),
    kdfExecution: scryptLimiter.snapshot(),
    ingestionExecution: ingestionExecution.snapshot(),
    processingLatencyMs: summarizeLatencySamples(processingLatencySamples),
    deviceQueueLatencyMs: summarizeLatencySamples(deviceQueueLatencySamples),
    networkLatencyMs: summarizeLatencySamples(networkLatencySamples),
    deviceToServerLatencyMs: summarizeLatencySamples(deviceToServerLatencySamples),
    rtdbWriteLatencyMs: summarizeLatencySamples(rtdbWriteLatencySamples),
    rtdbTransactionAttempts: summarizeLatencySamples(rtdbTransactionAttemptSamples),
    rateLimit: {
      mode: deviceRateLimitConfiguration.mode,
      limitPerMinute: deviceRateLimitConfiguration.limit,
      leaseSize: deviceRateLimitConfiguration.leaseSize,
      replicas: deviceRateLimitConfiguration.replicas,
      localDecisions: deviceRateLimitLocalDecisions,
      leaseHits: deviceRateLimitLeaseHits,
      storeTransactions: deviceRateLimitStoreTransactions,
      storeTransactionRetries: deviceRateLimitStoreTransactionRetries,
      decisionLatencyMs: summarizeLatencySamples(rateLimitDecisionLatencySamples),
    },
    serverIngressGapMs: summarizeLatencySamples(serverIngressGapSamples),
  };
}

export async function hashDeviceSecret(secret: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptLimiter.run(() => scryptAsync(secret, salt, 64))) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}
