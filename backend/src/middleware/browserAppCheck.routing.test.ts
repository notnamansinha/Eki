import express from "express";
import { rateLimit } from "express-rate-limit";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ verifyApp: vi.fn(), verifyIdentity: vi.fn(), readRoute: vi.fn() }));
vi.mock("firebase-admin/app-check", () => ({ getAppCheck: () => ({ verifyToken: fixture.verifyApp }) }));
vi.mock("../lib/firebaseAdmin", () => ({
  firebaseAdminApp: {},
  db: { collection: () => ({ doc: (id: string) => ({ get: () => fixture.readRoute(id) }) }) },
}));
vi.mock("./verifiedRequest", () => ({ verifyRequestToken: fixture.verifyIdentity }));

import { createBrowserAdmission } from "../lib/browserAdmission";
import { requireAdmin } from "./requireAdmin";
import { requireAuth } from "./requireAuth";
import { createBrowserAppCheck } from "./browserAppCheck";
import { segmentRoutes } from "../routes/plan";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve()); server.closeAllConnections();
  })));
  fixture.verifyApp.mockReset();
  fixture.verifyIdentity.mockReset();
  fixture.readRoute.mockReset();
});

async function boot(mode: "enforce" | "off" = "enforce") {
  const app = express();
  let work = 0;
  const fixtureLimiter = rateLimit({ windowMs: 60_000, limit: 1000 });
  app.use("/api", fixtureLimiter, createBrowserAdmission(1, { read: 100, mutation: 100 }));
  app.use("/api", createBrowserAppCheck(mode));
  const places = express.Router();
  places.get("/search", fixtureLimiter, requireAdmin, (_req, res) => { work++; res.json({ ok: true }); });
  app.use("/api/places", places);
  const plan = express.Router();
  plan.get("/:routeId", fixtureLimiter, requireAuth, (_req, res) => { work++; res.json({ ok: true }); });
  app.use("/api/plan", plan);
  const routes = express.Router();
  routes.get("/:routeId", fixtureLimiter, requireAuth, (_req, res) => { work++; res.json({ ok: true }); });
  app.use("/api/routes", routes);
  const geometry = express.Router();
  geometry.get("/:routeId/geometry", fixtureLimiter, requireAuth, (req, res) => {
    work++;
    res.json({ routeId: req.params.routeId });
  });
  app.use("/api/v2/routes", geometry);
  app.use("/api/v2/routes", fixtureLimiter, segmentRoutes);
  const devices = express.Router();
  devices.post("/:deviceId/firmware/installation", (req, res) => {
    if (req.get("Authorization") !== "Device valid") { res.sendStatus(401); return; }
    res.json({ ok: true });
  });
  app.use("/api/devices", devices);
  const server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test address");
  const url = `http://127.0.0.1:${address.port}`;
  return { url, work: () => work };
}

describe("App Check through mounted browser and device routers", () => {
  it("blocks missing and invalid attestation before GET or HEAD work for accepted route spellings", async () => {
    fixture.verifyIdentity.mockResolvedValue({ uid: "admin", admin: true });
    fixture.verifyApp.mockRejectedValue(Object.assign(Error("invalid"), { code: "app-check/invalid-token" }));
    const { url, work } = await boot();
    for (const path of ["/api/places/search", "/API/PLACES/search", "/Api/PlAn/RideId", "/aPi/RoUtEs/RideId", "/API/v2/RouTes/CaseSensitiveId/GEOMETRY", "/api/v2/routes/%43aseSensitiveId/geometry", "/API/v2/RouTes/%43aseSensitiveId/GEOMETRY/"]) {
      for (const method of ["GET", "HEAD"]) {
        for (const appToken of [undefined, "invalid-app-token"]) {
          const response = await fetch(url + path, { method, headers: {
            Authorization: "Bearer admin",
            ...(appToken ? { "X-Firebase-AppCheck": appToken } : {}),
          } });
          expect(response.status, `${method} ${path}`).toBe(403);
        }
      }
    }
    expect(work()).toBe(0);
  });

  it("guards the production v2 segment router before route reads for GET and HEAD", async () => {
    fixture.verifyIdentity.mockResolvedValue({ uid: "rider", admin: false });
    fixture.verifyApp.mockRejectedValue(Object.assign(Error("invalid"), { code: "app-check/invalid-token" }));
    fixture.readRoute.mockResolvedValue({ exists: false });
    const { url } = await boot();
    for (const path of ["/api/v2/routes/CaseSensitiveId/segments", "/API/v2/RouTes/%43aseSensitiveId/SEGMENTS/"]) {
      for (const method of ["GET", "HEAD"]) {
        for (const token of [undefined, "invalid-app-token"]) {
          const response = await fetch(`${url}${path}?from=a&to=z`, { method, headers: {
            Authorization: "Bearer rider",
            ...(token ? { "X-Firebase-AppCheck": token } : {}),
          } });
          expect(response.status, `${method} ${path}`).toBe(403);
        }
      }
    }
    expect(fixture.readRoute).not.toHaveBeenCalled();
    fixture.verifyApp.mockResolvedValue({ appId: "test-app" });
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${url}/API/v2/RouTes/%43aseSensitiveId/SEGMENTS/?from=a&to=z`, {
        method, headers: { Authorization: "Bearer rider", "X-Firebase-AppCheck": "valid-app-token" },
      });
      expect(response.status).toBe(404);
    }
    expect(fixture.readRoute.mock.calls).toEqual([["CaseSensitiveId"], ["CaseSensitiveId"]]);
    const off = await boot("off");
    expect((await fetch(`${off.url}/api/v2/routes/CaseSensitiveId/segments?from=a&to=z`, {
      headers: { Authorization: "Bearer rider" },
    })).status).toBe(404);
  });

  it("permits verified requests while preserving identity and admin checks", async () => {
    fixture.verifyApp.mockResolvedValue({ appId: "test-app" });
    fixture.verifyIdentity.mockImplementation(async (_req, token: string) => {
      if (token === "admin") return { uid: "admin", admin: true };
      if (token === "rider") return { uid: "rider", admin: false };
      throw Error("Invalid identity");
    });
    const { url, work } = await boot();
    const request = (path: string, token: string, method = "GET") => fetch(url + path, {
      method, headers: { Authorization: `Bearer ${token}`, "X-Firebase-AppCheck": "valid-app-token" },
    });
    expect((await request("/API/PLACES/search", "admin")).status).toBe(200);
    expect((await request("/api/places/search", "admin", "HEAD")).status).toBe(200);
    const geometry = await request("/API/v2/RouTes/CaseSensitiveId/GEOMETRY", "rider");
    expect(geometry.status).toBe(200);
    expect((await geometry.json()).routeId).toBe("CaseSensitiveId");
    expect((await request("/api/places/search", "rider")).status).toBe(403);
    expect((await request("/api/places/search", "invalid")).status).toBe(401);
    expect(work()).toBe(3);
  });

  it("retains off mode and exact device credential exemptions", async () => {
    fixture.verifyIdentity.mockResolvedValue({ uid: "admin", admin: true });
    const off = await boot("off");
    expect((await fetch(off.url + "/API/PLACES/search", { headers: { Authorization: "Bearer admin" } })).status).toBe(200);
    const active = await boot();
    expect((await fetch(active.url + "/API/DEVICES/CaseSensitiveId/FIRMWARE/INSTALLATION", {
      method: "POST", headers: { Authorization: "Device valid" },
    })).status).toBe(200);
    expect((await fetch(active.url + "/api/devices/id/firmware/installation", {
      method: "POST", headers: { Authorization: "Device wrong" },
    })).status).toBe(401);
    expect((await fetch(active.url + "/api/devices/id/firmware/installation/extra", {
      method: "POST", headers: { Authorization: "Device valid" },
    })).status).toBe(401);
  });
});
