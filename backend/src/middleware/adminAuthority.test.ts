import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ current: true, error: false, reads: 0 }));
vi.mock("../services/userAuthorization", () => ({
  authorizationIsCurrent: vi.fn(async () => {
    state.reads++;
    if (state.error) throw new Error("authorization store unavailable");
    return state.current;
  }),
}));

import { hasCurrentAdminAuthority } from "./adminAuthority";

const request = (user: Record<string, unknown> | undefined) => ({ user }) as unknown as Request;
const CURRENT_ADMIN = { uid: "admin_uid", role: "admin", admin: true, authorizationVersion: "v1" };

beforeEach(() => { state.current = true; state.error = false; state.reads = 0; });

describe("current administrator authority", () => {
  it("accepts both admin claims with a version that is still current", async () => {
    await expect(hasCurrentAdminAuthority(request(CURRENT_ADMIN))).resolves.toBe(true);
  });

  it("rejects a version that is no longer current", async () => {
    state.current = false;
    await expect(hasCurrentAdminAuthority(request(CURRENT_ADMIN))).resolves.toBe(false);
  });

  it.each([
    ["no user", undefined],
    ["a legacy token without a version", { uid: "a", role: "admin", admin: true }],
    ["a role-only token", { uid: "a", role: "admin", authorizationVersion: "v1" }],
    ["a stray admin flag on a driver", { uid: "d", role: "driver", admin: true, authorizationVersion: "v1" }],
    ["a string admin flag", { uid: "a", role: "admin", admin: "true", authorizationVersion: "v1" }],
  ])("rejects %s without reading the authorization records", async (_name, user) => {
    await expect(hasCurrentAdminAuthority(request(user))).resolves.toBe(false);
    expect(state.reads).toBe(0);
  });

  it("reads the authorization records once per request", async () => {
    const req = request(CURRENT_ADMIN);
    await hasCurrentAdminAuthority(req);
    await hasCurrentAdminAuthority(req);
    expect(state.reads).toBe(1);
    await hasCurrentAdminAuthority(request(CURRENT_ADMIN));
    expect(state.reads).toBe(2);
  });

  it("rejects when the authorization records cannot be read", async () => {
    state.error = true;
    await expect(hasCurrentAdminAuthority(request(CURRENT_ADMIN))).rejects.toThrow("authorization store unavailable");
  });
});
