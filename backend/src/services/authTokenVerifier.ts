import { createHash } from "node:crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import { auth } from "../lib/firebaseAdmin";

const DEFAULT_CACHE_MS = 15_000;
const MAX_CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 1_000;
const DEFAULT_MAX_PENDING_VERIFICATIONS = 256;
const MAX_PENDING_VERIFICATIONS = 2_000;

export class AuthVerificationCapacityError extends Error {
  readonly code = "auth/verification-capacity";

  constructor() {
    super("Authentication verification capacity is temporarily exhausted.");
    this.name = "AuthVerificationCapacityError";
  }
}

interface CachedToken {
  decoded: DecodedIdToken;
  expiresAt: number;
}

const verifiedTokens = new Map<string, CachedToken>();
const pendingVerifications = new Map<string, Promise<DecodedIdToken>>();

function cacheDurationMs(): number {
  const configured = Number(process.env.AUTH_REVOCATION_CACHE_MS);
  if (!Number.isSafeInteger(configured) || configured < 0) {
    return DEFAULT_CACHE_MS;
  }
  return Math.min(configured, MAX_CACHE_MS);
}

function pendingVerificationLimit(): number {
  const configured = Number(process.env.AUTH_MAX_PENDING_VERIFICATIONS);
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    return DEFAULT_MAX_PENDING_VERIFICATIONS;
  }
  return Math.min(configured, MAX_PENDING_VERIFICATIONS);
}

function requiresFreshRevocationCheck(decoded: DecodedIdToken): boolean {
  return decoded.admin === true ||
    decoded.role === "admin" ||
    decoded.role === "driver" ||
    typeof decoded.driverId === "string" ||
    typeof decoded.assignedBusId === "string";
}

function tokenKey(idToken: string): string {
  return createHash("sha256").update(idToken, "utf8").digest("hex");
}

function cacheVerifiedToken(
  key: string,
  decoded: DecodedIdToken,
): void {
  const duration = cacheDurationMs();
  if (duration === 0) return;

  const now = Date.now();
  if (
    !verifiedTokens.has(key) &&
    verifiedTokens.size >= MAX_CACHE_ENTRIES
  ) {
    for (const [candidate, cached] of verifiedTokens) {
      if (cached.expiresAt <= now) verifiedTokens.delete(candidate);
    }
    if (verifiedTokens.size >= MAX_CACHE_ENTRIES) {
      const oldest = verifiedTokens.keys().next().value;
      if (oldest) verifiedTokens.delete(oldest);
    }
  }
  const tokenExpiresAt = decoded.exp * 1_000;
  verifiedTokens.set(key, {
    decoded,
    expiresAt: Math.min(now + duration, tokenExpiresAt),
  });
}

/**
 * Verify signature, expiry, disabled-user state, and token revocation.
 *
 * Firebase's revocation check adds an Auth service round trip. A short,
 * bounded cache avoids repeating that trip for the same browser token during
 * a burst of API actions. Raw bearer tokens are never retained.
 */
export function verifyRevocationAwareIdToken(
  idToken: string,
): Promise<DecodedIdToken> {
  const key = tokenKey(idToken);
  const cached = verifiedTokens.get(key);
  if (
    cached &&
    cached.expiresAt > Date.now() &&
    !requiresFreshRevocationCheck(cached.decoded)
  ) {
    return Promise.resolve(cached.decoded);
  }
  if (cached && cached.expiresAt <= Date.now()) verifiedTokens.delete(key);

  const pending = pendingVerifications.get(key);
  if (pending) return pending;
  if (pendingVerifications.size >= pendingVerificationLimit()) {
    return Promise.reject(new AuthVerificationCapacityError());
  }

  const verification = auth.verifyIdToken(idToken, true)
    .then((decoded) => {
      cacheVerifiedToken(key, decoded);
      return decoded;
    })
    .finally(() => {
      if (pendingVerifications.get(key) === verification) {
        pendingVerifications.delete(key);
      }
    });
  pendingVerifications.set(key, verification);
  return verification;
}

export function clearAuthTokenVerificationCache(): void {
  verifiedTokens.clear();
  pendingVerifications.clear();
}
