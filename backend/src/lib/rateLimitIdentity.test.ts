import { describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  bearerTokenUid,
  createIdentityAwareLimiter,
  deviceIngressRateLimitKey,
  identityRateLimitKey,
} from "./rateLimitIdentity";

function firebaseStyleToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.${Buffer.from("signature").toString("base64url")}`;
}

describe("bearerTokenUid", () => {
  it("extracts the uid claim from a Firebase-style ID token without verifying it", () => {
    const token = firebaseStyleToken({ uid: "passenger_1", sub: "passenger_1", role: "passenger" });
    expect(bearerTokenUid(`Bearer ${token}`)).toBe("passenger_1");
  });

  it("falls back to the sub claim when uid is absent", () => {
    const token = firebaseStyleToken({ sub: "driver_7" });
    expect(bearerTokenUid(`Bearer ${token}`)).toBe("driver_7");
  });

  it("returns null when no Bearer token is presented", () => {
    expect(bearerTokenUid(undefined)).toBeNull();
    expect(bearerTokenUid("")).toBeNull();
    expect(bearerTokenUid("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null for malformed tokens", () => {
    expect(bearerTokenUid("Bearer not-a-jwt")).toBeNull();
    expect(bearerTokenUid(`Bearer ${"a".repeat(5000)}`)).toBeNull();
  });

  it("returns null when the decoded payload has no usable identity", () => {
    const token = firebaseStyleToken({ aud: "eki" });
    expect(bearerTokenUid(`Bearer ${token}`)).toBeNull();
    const garbage = `x.y.${Buffer.from("not json").toString("base64url")}`;
    expect(bearerTokenUid(`Bearer ${garbage}`)).toBeNull();
  });
});

describe("identityRateLimitKey", () => {
  it("keys on the authenticated uid when a Bearer token is present", () => {
    const token = firebaseStyleToken({ uid: "passenger_1" });
    expect(identityRateLimitKey(`Bearer ${token}`, "203.0.113.9")).toBe("uid:passenger_1");
  });

  it("keys on the client IP when the request is anonymous", () => {
    expect(identityRateLimitKey(undefined, "203.0.113.9")).toBe("ip:203.0.113.9");
    expect(identityRateLimitKey("Bearer garbage", "203.0.113.9")).toBe("ip:203.0.113.9");
  });
});

describe("deviceIngressRateLimitKey", () => {
  it("keys on the claimed deviceId when a Device secret is presented", () => {
    expect(deviceIngressRateLimitKey("bus_42", "Device aaaaaaaaaaaaaaaaaaaa", "203.0.113.9")).toBe(
      "device:bus_42",
    );
  });

  it("keys on the client IP when no Device secret is presented", () => {
    expect(deviceIngressRateLimitKey("bus_42", undefined, "203.0.113.9")).toBe("ip:203.0.113.9");
    expect(deviceIngressRateLimitKey("bus_42", "Bearer abc", "203.0.113.9")).toBe("ip:203.0.113.9");
  });
});

async function bootLimitedServer(limit: number) {
  const app = express();
  app.use(
    createIdentityAwareLimiter({
      windowMs: 60_000,
      limit,
      message: { error: "Too many requests, please slow down." },
    }),
  );
  app.get("/", (_req, res) => res.json({ ok: true }));
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return { server, baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}` };
}

describe("createIdentityAwareLimiter", () => {
  it("gives two authenticated users behind one campus IP independent budgets", async () => {
    const { server, baseUrl } = await bootLimitedServer(3);
    try {
      const tokenA = firebaseStyleToken({ uid: "passenger_a" });
      const tokenB = firebaseStyleToken({ uid: "passenger_b" });
      const send = (authorization: string | undefined) =>
        fetch(baseUrl + "/", {
          headers: authorization ? { Authorization: authorization } : {},
        }).then((response) => response.status);

      const aStatuses = await Promise.all([1, 2, 3, 4].map(() => send(`Bearer ${tokenA}`)));
      expect(aStatuses.filter((status) => status === 429).length).toBe(1);

      const bStatuses = await Promise.all([1, 2, 3].map(() => send(`Bearer ${tokenB}`)));
      expect(bStatuses).toEqual([200, 200, 200]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("still caps anonymous traffic per client IP", async () => {
    const { server, baseUrl } = await bootLimitedServer(3);
    try {
      const statuses = await Promise.all(
        [1, 2, 3, 4].map(() =>
          fetch(baseUrl + "/").then((response) => response.status),
        ),
      );
      expect(statuses.filter((status) => status === 429).length).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
