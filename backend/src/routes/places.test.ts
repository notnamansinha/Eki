import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ role: "admin" as "admin" | "user" | "none" }));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (_req: unknown, res: express.Response, next: () => void) => {
    if (access.role === "none") {
      res.status(401).json({ error: "Authentication required.", code: "AUTH_REQUIRED" });
    } else if (access.role !== "admin") {
      res.status(403).json({ error: "Administrator access required.", code: "ADMIN_REQUIRED" });
    } else {
      next();
    }
  },
}));

import placesRouter from "./places";

let server: Server;
let baseUrl = "";
const networkFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use("/api/places", placesRouter);
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
  access.role = "admin";
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockUpstream(response: Response | ((init: RequestInit) => Promise<Response>)) {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(baseUrl)) return networkFetch(input, init);
    return typeof response === "function" ? response(init ?? {}) : Promise.resolve(response);
  }));
}

async function search(query = "university") {
  return networkFetch(`${baseUrl}/api/places/search?q=${encodeURIComponent(query)}`);
}

describe("place search route", () => {
  it("keeps unauthenticated and non-admin callers denied", async () => {
    access.role = "none";
    expect((await search()).status).toBe(401);
    access.role = "user";
    expect((await search()).status).toBe(403);
  });

  it("returns validated place results and a genuine empty result", async () => {
    mockUpstream(new Response(JSON.stringify({
      places: [{
        displayName: { text: "Campus" },
        formattedAddress: "University Road",
        location: { latitude: 23.03, longitude: 72.55 },
      }],
    }), { status: 200 }));
    const success = await search("campus unique");
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({
      results: [{ name: "Campus", address: "University Road", lat: 23.03, lng: 72.55 }],
    });

    mockUpstream(new Response(JSON.stringify({ places: [] }), { status: 200 }));
    const empty = await search("empty unique");
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ results: [] });
  });

  it("returns structured validation and configuration errors", async () => {
    const invalid = await search("x");
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: "INVALID_PLACE_QUERY" });

    delete process.env.GOOGLE_MAPS_API_KEY;
    const missing = await search("missing config unique");
    expect(missing.status).toBe(503);
    await expect(missing.json()).resolves.toMatchObject({ code: "PLACES_NOT_CONFIGURED" });
  });

  it("distinguishes upstream rate limiting from other failures", async () => {
    mockUpstream(new Response("quota", { status: 429 }));
    const limited = await search("rate limited unique");
    expect(limited.status).toBe(503);
    await expect(limited.json()).resolves.toMatchObject({ code: "PLACES_UPSTREAM_RATE_LIMITED" });

    mockUpstream(new Response("bad gateway", { status: 500 }));
    const failed = await search("upstream failure unique");
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({ code: "PLACES_UPSTREAM_FAILURE" });
  });

  it("keeps the timeout active while parsing the upstream response body", async () => {
    vi.useFakeTimers();
    let bodyStarted!: () => void;
    const started = new Promise<void>((resolve) => { bodyStarted = resolve; });
    mockUpstream(async (init) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        bodyStarted();
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    } as Response));

    const result = search("slow body unique");
    await started;
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await result;
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({ code: "PLACES_TIMEOUT" });
  });
});
