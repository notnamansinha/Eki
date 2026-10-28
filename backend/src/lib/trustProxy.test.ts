import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { createIdentityAwareLimiter } from "./rateLimitIdentity";
import { readTrustProxySetting, type TrustProxySetting } from "./trustProxy";

describe("readTrustProxySetting", () => {
  it("keeps one trusted hop in production and none elsewhere by default", () => {
    expect(readTrustProxySetting({ NODE_ENV: "production" })).toBe(1);
    expect(readTrustProxySetting({ NODE_ENV: "development" })).toBe(false);
    expect(readTrustProxySetting({})).toBe(false);
    expect(readTrustProxySetting({ NODE_ENV: "production", TRUST_PROXY: " " })).toBe(1);
  });

  it("accepts false, loopback and bounded hop counts", () => {
    expect(readTrustProxySetting({ TRUST_PROXY: "loopback" })).toBe("loopback");
    expect(readTrustProxySetting({ TRUST_PROXY: " LOOPBACK " })).toBe("loopback");
    expect(readTrustProxySetting({ NODE_ENV: "production", TRUST_PROXY: "false" })).toBe(false);
    expect(readTrustProxySetting({ TRUST_PROXY: "0" })).toBe(0);
    expect(readTrustProxySetting({ TRUST_PROXY: "2" })).toBe(2);
    expect(readTrustProxySetting({ TRUST_PROXY: "10" })).toBe(10);
  });

  it("refuses values that would let callers choose their own rate-limit key", () => {
    for (const value of ["true", "all", "11", "-1", "1.5", "127.0.0.1", "loopback,uniquelocal", "yes"]) {
      expect(() => readTrustProxySetting({ TRUST_PROXY: value }), value).toThrow(/^TRUST_PROXY must be/);
    }
  });
});

describe("pre-auth IP buckets behind a local tunnel agent", () => {
  let server: Server | null = null;
  afterEach(async () => {
    const closing = server;
    server = null;
    if (closing) await new Promise<void>((resolve, reject) => closing.close(error => error ? reject(error) : resolve()));
  });

  async function boot(trustProxy: TrustProxySetting) {
    const app = express();
    if (trustProxy !== false) app.set("trust proxy", trustProxy);
    app.use(createIdentityAwareLimiter({ windowMs: 60_000, limit: 100, message: { error: "Too many requests." } }));
    app.get("/", (_req, res) => res.json({ ok: true }));
    server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // The tunnel agent connects over loopback and appends the real client.
    return async (forwardedFor: string) => Number((await fetch(`${baseUrl}/`, {
      headers: { "X-Forwarded-For": forwardedFor },
    })).headers.get("ratelimit-remaining"));
  }

  it("keys each tunnelled client by the address the loopback proxy appended", async () => {
    const remaining = await boot(readTrustProxySetting({ NODE_ENV: "development", TRUST_PROXY: "loopback" }));
    expect(await remaining("203.0.113.5")).toBe(99);
    expect(await remaining("198.51.100.7")).toBe(99);
    expect(await remaining("203.0.113.5")).toBe(98);
    // A remote caller's forged leading entries cannot move it to a fresh bucket.
    expect(await remaining("6.6.6.6, 203.0.113.5")).toBe(97);
    expect(await remaining("127.0.0.1, 203.0.113.5")).toBe(96);
  });

  it("documents the shared bucket when no proxy is trusted", async () => {
    const remaining = await boot(readTrustProxySetting({ NODE_ENV: "development" }));
    expect(await remaining("203.0.113.5")).toBe(99);
    expect(await remaining("198.51.100.7")).toBe(98);
  });
});
