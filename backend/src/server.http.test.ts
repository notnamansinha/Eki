import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Boots the real server.ts middleware stack with Firebase, workers and token
// verification replaced, so the HTTP edge (CORS, auth, parsers, fallbacks) is
// exercised exactly as wired in production without contacting any project.
const offline = () => Promise.reject(Object.assign(new Error("firebase offline"), { code: "unavailable" }));
function firebaseStub(): unknown {
  const target = function () { return firebaseStub(); };
  return new Proxy(target, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (["get", "set", "update", "once", "transaction", "commit", "create", "delete"].includes(String(property))) {
        return offline;
      }
      return firebaseStub();
    },
    apply: () => firebaseStub(),
  });
}
vi.mock("./lib/firebaseAdmin", () => ({
  db: firebaseStub(), rtdb: firebaseStub(), auth: firebaseStub(), firebaseAdminApp: {},
}));
vi.mock("./services/workerCoordinator", () => ({ startWorkerCoordinator: () => async () => undefined }));
vi.mock("./services/telemetryRouteService", async importOriginal => ({
  ...(await importOriginal<typeof import("./services/telemetryRouteService")>()),
  startTelemetryRouteWatcher: () => () => undefined,
}));
vi.mock("./services/authTokenVerifier", () => ({
  AuthVerificationCapacityError: class extends Error {},
  verifyRevocationAwareIdToken: async (token: string) => {
    if (token === "admin") return { uid: "admin-1", admin: true, role: "admin", authorizationVersion: "v1" };
    if (token === "passenger") return { uid: "passenger-1", role: "passenger", authorizationVersion: "v1" };
    throw Object.assign(new Error("Firebase ID token has expired."), { code: "auth/id-token-expired" });
  },
}));
vi.mock("./services/userAuthorization", async importOriginal => ({
  ...(await importOriginal<typeof import("./services/userAuthorization")>()),
  authorizationIsCurrent: async () => true,
}));

let server: Server;
let origin = "";

beforeAll(async () => {
  process.env.PORT = "0";
  process.env.CORS_ORIGIN = "https://eki.example";
  const listen = vi.spyOn(http.Server.prototype, "listen");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  await import("./server");
  server = listen.mock.instances[0] as unknown as Server;
  listen.mockRestore();
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

// node:http rather than fetch so methods such as TRACE can be sent.
const request = (method: string, path: string, headers: Record<string, string> = {}) =>
  new Promise<Response>((resolve, reject) => {
    const outgoing = http.request(`${origin}${path}`, { method, headers }, incoming => {
      const chunks: Buffer[] = [];
      incoming.on("data", chunk => chunks.push(chunk));
      incoming.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: incoming.statusCode,
        headers: Object.entries(incoming.headers).flatMap(([name, value]) =>
          value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value] as [string, string]]),
      })));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });

describe("HTTP edge as wired by server.ts", () => {
  it.each([
    ["GET", "/no-such-path", {}],
    ["POST", "/health", {}],
    ["PROPFIND", "/live", {}],
    ["GET", "/api/no-such-resource", { Authorization: "Bearer passenger" }],
  ])("answers unmatched %s %s with the documented JSON error shape", async (method, path, headers) => {
    const response = await request(method, path, headers);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ error: "Not found." });
  });

  it("reflects only an exact configured origin", async () => {
    for (const candidate of ["https://eki.example/", "HTTPS://EKI.EXAMPLE", "https://eki.example.evil.test", "null"]) {
      const response = await request("GET", "/live", { Origin: candidate });
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
    const allowed = await request("GET", "/live", { Origin: "https://eki.example" });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://eki.example");
  });

  it.each([
    ["no credentials", "/api/health", {}, 401],
    ["an expired token", "/api/health", { Authorization: "Bearer expired" }, 401],
    ["the wrong role", "/api/health", { Authorization: "Bearer passenger" }, 403],
    ["an unknown resource", "/api/no-such-resource", { Authorization: "Bearer passenger" }, 404],
  ])("marks API responses for %s as not cacheable", async (_label, path, headers, status) => {
    const response = await request("GET", path, headers);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves the operational probes outside /api with their own cache header", async () => {
    for (const path of ["/live", "/health"]) {
      expect((await request("GET", path)).headers.get("cache-control")).toBe("no-store");
    }
  });

  it("keeps TRACE rejected and operational health admin-only", async () => {
    expect((await request("TRACE", "/live")).status).toBe(405);
    expect((await request("GET", "/api/health")).status).toBe(401);
    expect((await request("GET", "/api/health", { Authorization: "Bearer expired" })).status).toBe(401);
    expect((await request("GET", "/api/health", { Authorization: "Bearer passenger" })).status).toBe(403);
    const admin = await request("GET", "/api/health", { Authorization: "Bearer admin" });
    expect(admin.status).toBe(503);
    expect(await admin.json()).toMatchObject({ status: "degraded", telemetry: { transport: "https" } });
    const publicHealth = await request("GET", "/health");
    expect(await publicHealth.json()).toEqual({ status: "degraded" });
  });
});
