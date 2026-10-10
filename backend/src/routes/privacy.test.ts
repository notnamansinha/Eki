import { contractFetch } from "../../test-support/openapi";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  role: "passenger" as string | undefined,
  claims: {} as Record<string, unknown>,
  driver: false,
  profileRole: "passenger",
  requests: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (req: { user?: Record<string, unknown> }, _res: unknown, next: () => void) => {
    req.user = { uid: "user_1", role: harness.role };
    next();
  },
}));

vi.mock("../middleware/requireAdmin", () => ({ requireAdmin: (req: any, res: any, next: () => void) => {
  if (harness.role !== "admin") { res.status(403).json({ error: "Admin required." }); return; }
  req.user = { uid: "admin_1", admin: true }; next();
} }));
vi.mock("../lib/firebaseAdmin", () => {
  const ref = (name: string, id: string): any => ({ name, id, get: async () => ({ exists: name === "users" || harness.requests.has(id),
    data: () => name === "users" ? { role: harness.profileRole } : harness.requests.get(id) }) });
  const query = (name: string): any => ({ doc: (id: string) => ref(name, id), where: () => query(name), limit: () => query(name), orderBy: () => query(name), startAfter: () => query(name),
    get: async () => name === "drivers" ? { empty: !harness.driver } : { size: harness.requests.size, docs: [...harness.requests].map(([id, data]) => ({ id, data: () => data })) } });
  return { auth: { getUser: async () => ({ customClaims: harness.claims, metadata: { creationTime: "2026-01-01" } }) },
    db: { collection: query, runTransaction: async (work: any) => work({ get: (r: any) => r.get(),
      create: (r: any, data: any) => harness.requests.set(r.id, data),
      set: (r: any, data: any) => harness.requests.set(r.id, { ...harness.requests.get(r.id), ...data }) }) } };
});

import privacyRouter, { privacyDeletionRequestsRouter } from "./privacy";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/privacy", privacyRouter);
  app.use("/api/v2/privacy-deletion-requests", privacyDeletionRequestsRouter);
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
  harness.role = "passenger";
  harness.claims = {}; harness.driver = false; harness.profileRole = "passenger";
  harness.requests = new Map();
});

describe("privacy deletion request aliases", () => {
  it("preserves recovery bookkeeping when the same passenger resubmits", async () => {
    const errorAt = new Date("2026-10-01T00:00:00Z");
    harness.requests.set("user_1", { status: "pending", attempts: 4, lastErrorAt: errorAt, nextAttemptAt: 123456789 });
    const response = await contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests`, { method: "POST" });
    expect(response.status).toBe(202);
    expect(harness.requests.get("user_1")).toMatchObject({ attempts: 4, lastErrorAt: errorAt, nextAttemptAt: 123456789 });
  });
  it("queues the same UID-bound request from both paths", async () => {
    const v2 = await contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests`, { method: "POST" });
    expect(v2.status).toBe(202);
    expect(v2.headers.get("cache-control")).toBe("no-store");
    await expect(v2.json()).resolves.toEqual({ accepted: true });
    const legacy = await contractFetch(`${baseUrl}/api/privacy/deletion-request`, { method: "POST" });
    expect(legacy.status).toBe(202);
    expect(harness.requests.size).toBe(1);
    expect(harness.requests.get("user_1")).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("rejects privileged accounts on both paths", async () => {
    harness.role = "admin";
    expect((await contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests`, { method: "POST" })).status).toBe(409);
    expect((await contractFetch(`${baseUrl}/api/privacy/deletion-request`, { method: "POST" })).status).toBe(409);
    expect(harness.requests.size).toBe(0);
  });

  it("admits claim-less passengers only after current Auth and membership checks", async () => {
    harness.role = undefined;
    expect((await contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests`, { method: "POST" })).status).toBe(202);
    harness.requests.clear(); harness.driver = true;
    expect((await contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests`, { method: "POST" })).status).toBe(409);
    expect(harness.requests.size).toBe(0);
  });
  it.each([{ admin: true }, { driverId: "driver" }, { role: "driver" }])("rejects current privileged claims despite a passenger token hint: %o", async claims => {
    harness.claims = claims;
    expect((await contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests`, { method: "POST" })).status).toBe(409);
  });
  it("restarts a failed request while preserving its attempt and error history", async () => {
    harness.requests.set("user_1", { status: "failed", attempts: 5, failures: 5, generation: 7, lastErrorCode: "DEPENDENCY_FAILURE" });
    expect((await contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests`, { method: "POST" })).status).toBe(202);
    expect(harness.requests.get("user_1")).toMatchObject({ status: "pending", attempts: 5, failures: 0, generation: 8, lastErrorCode: "DEPENDENCY_FAILURE" });
  });
  it("protects monitoring/recovery and compares executor generation", async () => {
    expect((await contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests`)).status).toBe(403);
    harness.role = "admin";
    harness.requests.set("user_1", { status: "failed", attempts: 5, failures: 5, generation: 7, lastErrorCode: "DEPENDENCY_FAILURE", secret: "omit" });
    const page = await contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests`);
    expect(page.status).toBe(200); expect(await page.json()).toEqual({ requests: [{ uid: "user_1", status: "failed", attempts: 5, failures: 5, generation: 7, executorId: "legacy", lastErrorCode: "DEPENDENCY_FAILURE", recoveryRequired: true }], nextCursor: null });
    const recover = (generation: number) => contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests/user_1/recovery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedExecutorId: "legacy", expectedGeneration: generation }) });
    expect((await recover(6)).status).toBe(409); expect((await recover(7)).status).toBe(200);
    expect(harness.requests.get("user_1")).toMatchObject({ status: "pending", failures: 0, attempts: 5, generation: 8, recoveredBy: "admin_1", lastErrorCode: "DEPENDENCY_FAILURE" });
  });

  it("rejects client-supplied identity on the v2 path", async () => {
    const response = await contractFetch(`${baseUrl}/api/v2/privacy-deletion-requests`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "another_user" }),
    });
    expect(response.status).toBe(400);
    expect(harness.requests.size).toBe(0);
  });
});
