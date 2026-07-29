import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";

const verifyIdToken = vi.hoisted(() => vi.fn());

vi.mock("../lib/firebaseAdmin", () => ({
  auth: { verifyIdToken },
}));

import {
  clearAuthTokenVerificationCache,
  verifyRevocationAwareIdToken,
} from "./authTokenVerifier";

const decoded = { uid: "user-1" } as DecodedIdToken;

describe("revocation-aware token verification", () => {
  beforeEach(() => {
    clearAuthTokenVerificationCache();
    verifyIdToken.mockReset();
    verifyIdToken.mockResolvedValue(decoded);
    delete process.env.AUTH_REVOCATION_CACHE_MS;
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
});
