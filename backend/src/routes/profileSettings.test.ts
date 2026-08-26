import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  profile: undefined as Record<string, unknown> | undefined,
  settings: {} as Record<string, unknown>,
  user: {
    uid: "user_1",
    name: "Verified Name",
    email: "verified@example.test",
    picture: "https://images.example.test/avatar.png",
  } as Record<string, unknown>,
  authClaims: {} as Record<string, unknown>,
  setCustomClaimsCalls: [] as Array<{ uid: string; claims: Record<string, unknown> }>,
  revokeCalls: [] as string[],
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (
    req: { user?: Record<string, unknown> },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = harness.user;
    next();
  },
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (
    req: { user?: Record<string, unknown> },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { uid: "admin_1", role: "admin", admin: true };
    next();
  },
}));

vi.mock("../lib/firebaseAdmin", () => {
  type Ref = {
    collection: string;
    id: string;
    set: (value: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void>;
  };
  const snapshot = () => ({
    exists: Boolean(harness.profile),
    data: () => harness.profile,
  });
  const makeRef = (collection: string, id: string): Ref => ({
    collection,
    id,
    set: async (value, options) => {
      if (collection === "settings") {
        harness.settings = options?.merge ? { ...harness.settings, ...value } : value;
      }
    },
  });

  return {
    auth: {
      getUser: async () => ({ customClaims: harness.authClaims }),
      setCustomUserClaims: async (uid: string, claims: Record<string, unknown>) => {
        harness.authClaims = { ...claims };
        harness.setCustomClaimsCalls.push({ uid, claims: { ...claims } });
      },
      revokeRefreshTokens: async (uid: string) => {
        harness.revokeCalls.push(uid);
      },
    },
    db: {
      collection: (collection: string) => ({
        doc: (id: string) => makeRef(collection, id),
      }),
      runTransaction: async (
        callback: (transaction: {
          create: (ref: Ref, value: Record<string, unknown>) => void;
          get: (ref: Ref) => Promise<ReturnType<typeof snapshot>>;
        }) => Promise<unknown>,
      ) => callback({
        create: (_ref, value) => {
          if (harness.profile) throw new Error("already exists");
          harness.profile = value;
        },
        get: async () => snapshot(),
      }),
    },
  };
});

import settingsRouter from "./settings";
import usersRouter from "./users";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/users", usersRouter);
  app.use("/api/settings", settingsRouter);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => {
  harness.profile = undefined;
  harness.settings = {};
  harness.authClaims = {};
  harness.setCustomClaimsCalls = [];
  harness.revokeCalls = [];
  harness.user = {
    uid: "user_1",
    name: "Verified Name",
    email: "verified@example.test",
    picture: "https://images.example.test/avatar.png",
  };
});

describe("profile bootstrap route", () => {
  it("creates a passenger profile only from verified token claims", async () => {
    const response = await fetch(`${baseUrl}/api/users/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "Attacker Name",
        email: "attacker@example.test",
        role: "admin",
      }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(harness.profile).toMatchObject({
      uid: "user_1",
      displayName: "Verified Name",
      email: "verified@example.test",
      role: "passenger",
    });
    await expect(response.json()).resolves.toEqual({
      role: "passenger",
      claimsUpdated: true,
    });
    expect(harness.setCustomClaimsCalls).toEqual([{
      uid: "user_1",
      claims: { role: "passenger" },
    }]);
    expect(harness.revokeCalls).toEqual([]);
  });

  it("preserves an existing privileged profile", async () => {
    harness.profile = { uid: "user_1", role: "admin", displayName: "Existing" };

    const response = await fetch(`${baseUrl}/api/users/bootstrap`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: "admin" });
    expect(harness.profile.displayName).toBe("Existing");
    expect(harness.setCustomClaimsCalls).toEqual([]);
  });

  it("repairs a missing passenger claim on an existing profile", async () => {
    harness.profile = { uid: "user_1", role: "passenger" };
    harness.authClaims = { featureFlag: true };

    const response = await fetch(`${baseUrl}/api/users/bootstrap`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      role: "passenger",
      claimsUpdated: true,
    });
    expect(harness.setCustomClaimsCalls[0]?.claims).toEqual({
      featureFlag: true,
      role: "passenger",
    });
    expect(harness.revokeCalls).toEqual([]);
  });

  it("does not rewrite an already synchronized passenger claim", async () => {
    harness.profile = { uid: "user_1", role: "passenger" };
    harness.authClaims = { role: "passenger", featureFlag: true };

    const response = await fetch(`${baseUrl}/api/users/bootstrap`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: "passenger" });
    expect(harness.setCustomClaimsCalls).toEqual([]);
    expect(harness.revokeCalls).toEqual([]);
  });

  it("removes stale privileged claims and revokes refresh tokens", async () => {
    harness.profile = { uid: "user_1", role: "passenger" };
    harness.authClaims = {
      role: "driver",
      driverId: "driver_1",
      assignedBusId: "bus_1",
      featureFlag: true,
    };

    const response = await fetch(`${baseUrl}/api/users/bootstrap`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(harness.setCustomClaimsCalls[0]?.claims).toEqual({
      featureFlag: true,
      role: "passenger",
    });
    expect(harness.revokeCalls).toEqual(["user_1"]);
  });
});

describe("settings route", () => {
  async function save(body: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects empty, unknown, and invalid settings", async () => {
    expect((await save({})).status).toBe(400);
    expect((await save({ role: "admin" })).status).toBe(400);
    expect((await save({ announcementActive: "yes" })).status).toBe(400);
    expect((await save({ noBusesMessage: "   " })).status).toBe(400);
  });

  it("persists only validated fields with server audit metadata", async () => {
    const response = await save({ announcementText: "Service update", announcementActive: true });

    expect(response.status).toBe(200);
    expect(harness.settings).toMatchObject({
      announcementText: "Service update",
      announcementActive: true,
      updatedBy: "admin_1",
    });
    expect(harness.settings.updatedAt).toBeDefined();
  });
});
