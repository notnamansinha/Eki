import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { createIdentityAwareLimiter, requestIpRateLimitKey } from "./rateLimitIdentity";

async function bootLimitedServer(limit: number) {
  const app = express();
  app.use(createIdentityAwareLimiter({
    windowMs: 60_000,
    limit,
    message: { error: "Too many requests, please slow down." },
  }));
  app.get("/", (_req, res) => res.json({ ok: true }));
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return { server, baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}` };
}

describe("requestIpRateLimitKey", () => {
  it("normalizes IP addresses without trusting caller-controlled identity", () => {
    expect(requestIpRateLimitKey("203.0.113.9")).toBe("ip:203.0.113.9");
    expect(requestIpRateLimitKey("2001:db8:1234:5678::1")).toBe("ip:2001:db8:1234:5600::/56");
  });
});

describe("createIdentityAwareLimiter", () => {
  it("keeps forged Bearer identities in the same pre-auth IP bucket", async () => {
    const { server, baseUrl } = await bootLimitedServer(3);
    try {
      const statuses = await Promise.all(["forged-a", "forged-b", "forged-c", "forged-d"].map((uid) =>
        fetch(baseUrl + "/", {
          headers: { Authorization: `Bearer unsigned.${uid}.signature` },
        }).then((response) => response.status),
      ));
      expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("keeps arbitrary Device headers in the same pre-auth IP bucket", async () => {
    const { server, baseUrl } = await bootLimitedServer(3);
    try {
      const statuses = await Promise.all(["bus-a", "bus-b", "bus-c", "bus-d"].map((deviceId) =>
        fetch(baseUrl + "/", {
          headers: { Authorization: `Device forged-${deviceId}` },
        }).then((response) => response.status),
      ));
      expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
