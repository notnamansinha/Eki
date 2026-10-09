import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("firebase-admin/app-check", () => ({ getAppCheck: () => ({ verifyToken: fixture.verify }) }));
vi.mock("../lib/firebaseAdmin", () => ({ firebaseAdminApp: {} }));
import { createBrowserAppCheck, requiresBrowserAttestation } from "./browserAppCheck";
let server: Server; let url: string;
beforeAll(async () => {
  const app = express(); app.use(createBrowserAppCheck("enforce"));
  app.use((_req, res) => res.json({ reachedHandler: true }));
  server = await new Promise<Server>(done => { const listener = app.listen(0, "127.0.0.1", () => done(listener)); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("No test address");
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });
beforeEach(() => { fixture.verify.mockReset().mockResolvedValue({ appId: "test-app" }); });
describe("browser API App Check boundary", () => {
  it("protects browser mutation and high-cost lookup routes while retaining exact device authentication paths", () => {
    expect(requiresBrowserAttestation("PATCH", "/api/v2/devices/device")).toBe(true);
    expect(requiresBrowserAttestation("POST", "/api/devices/device/telemetry/other")).toBe(true);
    expect(requiresBrowserAttestation("GET", "/api/places/search")).toBe(true);
    expect(requiresBrowserAttestation("POST", "/api/devices/device/telemetry")).toBe(false);
    expect(requiresBrowserAttestation("GET", "/api/devices/device/firmware")).toBe(false);
    expect(requiresBrowserAttestation("GET", "/api/v2/routes")).toBe(false);
  });
  it("rejects missing attestation even with a forged Device header on a browser route", async () => {
    const response = await fetch(`${url}/api/v2/settings/global`, { method: "PATCH", headers: { Authorization: "Device forged" } });
    expect(response.status).toBe(403); expect(fixture.verify).not.toHaveBeenCalled();
  });
  it.each(["app-check/invalid-argument", "app-check/app-check-token-expired"])("rejects %s without leaking verifier details", async code => {
    fixture.verify.mockRejectedValue(Object.assign(Error("secret verifier details"), { code }));
    const response = await fetch(`${url}/api/places/search`, { headers: { "X-Firebase-AppCheck": "test-invalid" } });
    expect(response.status).toBe(403); expect(await response.text()).not.toContain("secret verifier details");
  });
  it("returns retryable dependency failure and never enters the mutation handler", async () => {
    fixture.verify.mockRejectedValue(Error("keys temporarily unavailable"));
    const response = await fetch(`${url}/api/v2/settings/global`, { method: "PATCH", headers: { "X-Firebase-AppCheck": "test-unavailable" } });
    expect(response.status).toBe(503); expect(response.headers.get("Retry-After")).toBe("1");
  });
  it("coalesces simultaneous verification, permits a verified caller, and retains device admission", async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(`${url}/api/places/search`, { headers: { "X-Firebase-AppCheck": "test-valid" } })));
    expect(responses.every(response => response.status === 200)).toBe(true);
    expect((await fetch(`${url}/api/devices/device/telemetry`, { method: "POST" })).status).toBe(200);
  });
  it("rejects a misspelled rollout mode instead of silently disabling protection", () => {
    expect(() => createBrowserAppCheck("enfroce")).toThrow("API_APPCHECK_MODE");
  });
});
