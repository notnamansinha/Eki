import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";

const verifyIdToken = vi.hoisted(() => vi.fn());

vi.mock("../lib/firebaseAdmin", () => ({
  auth: { verifyIdToken },
}));

import {
  AuthVerificationCapacityError,
  clearAuthTokenVerificationCache,
  verifyRevocationAwareIdToken,
} from "./authTokenVerifier";

const decoded = {
  uid: "user-1",
  exp: Math.floor(Date.now() / 1_000) + 3_600,
} as DecodedIdToken;

describe("revocation-aware token verification", () => {
  beforeEach(() => {
    clearAuthTokenVerificationCache();
    verifyIdToken.mockReset();
    verifyIdToken.mockResolvedValue(decoded);
    delete process.env.AUTH_REVOCATION_CACHE_MS;
    delete process.env.AUTH_MAX_PENDING_VERIFICATIONS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces concurrent checks and caches only a verified result", async () => {
    const [first, second] = await Promise.all([
      verifyRevocationAwareIdToken("same-token"),
      verifyRevocationAwareIdToken("same-token"),
    ]);
    const third = await verifyRevocationAwareIdToken("same-token");

    expect(first).toBe(decoded);
    expect(second).toBe(decoded);
    expect(third).toBe(decoded);
    expect(verifyIdToken).toHaveBeenCalledTimes(1);
    expect(verifyIdToken).toHaveBeenCalledWith("same-token", true);
  });

  it("does not cache rejected credentials", async () => {
    verifyIdToken.mockRejectedValueOnce(new Error("revoked"));

    await expect(
      verifyRevocationAwareIdToken("revoked-token"),
    ).rejects.toThrow("revoked");
    await verifyRevocationAwareIdToken("revoked-token");

    expect(verifyIdToken).toHaveBeenCalledTimes(2);
  });

  it("can disable caching without disabling revocation checks", async () => {
    process.env.AUTH_REVOCATION_CACHE_MS = "0";

    await verifyRevocationAwareIdToken("uncached-token");
    await verifyRevocationAwareIdToken("uncached-token");

    expect(verifyIdToken).toHaveBeenCalledTimes(2);
    expect(verifyIdToken).toHaveBeenLastCalledWith("uncached-token", true);
  });

  it("always performs a fresh revocation check for privileged claims", async () => {
    verifyIdToken.mockResolvedValue({
      ...decoded,
      role: "driver",
      driverId: "driver_1",
      assignedBusId: "bus_1",
    } as DecodedIdToken);

    await verifyRevocationAwareIdToken("driver-token");
    await verifyRevocationAwareIdToken("driver-token");

    expect(verifyIdToken).toHaveBeenCalledTimes(2);
    expect(verifyIdToken).toHaveBeenNthCalledWith(1, "driver-token", true);
    expect(verifyIdToken).toHaveBeenNthCalledWith(2, "driver-token", true);
  });

  it("rejects new unique tokens when the in-flight verification bound is full", async () => {
    process.env.AUTH_MAX_PENDING_VERIFICATIONS = "2";
    const releases: Array<() => void> = [];
    verifyIdToken.mockImplementation(() => new Promise<DecodedIdToken>((resolve) => {
      releases.push(() => resolve(decoded));
    }));

    const first = verifyRevocationAwareIdToken("token-1");
    const second = verifyRevocationAwareIdToken("token-2");
    await expect(verifyRevocationAwareIdToken("token-3")).rejects.toBeInstanceOf(
      AuthVerificationCapacityError,
    );
    expect(verifyIdToken).toHaveBeenCalledTimes(2);

    releases.forEach((release) => release());
    await expect(Promise.all([first, second])).resolves.toEqual([decoded, decoded]);
  });

  it("does not serve a cached token past its JWT expiry", async () => {
    const now = 1_700_000_000_000;
    const exp = Math.floor(now / 1_000) + 5;
    const expiringDecoded = { uid: "user-1", exp } as DecodedIdToken;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    verifyIdToken.mockResolvedValue(expiringDecoded);

    await verifyRevocationAwareIdToken("expiring-token");
    vi.setSystemTime(exp * 1_000 + 1);
    await verifyRevocationAwareIdToken("expiring-token");

    expect(verifyIdToken).toHaveBeenCalledTimes(2);
  });
});
