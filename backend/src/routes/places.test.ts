import { afterEach, describe, expect, it, vi } from "vitest";
import placesRouter from "./places";

function mountHandler() {
  const layer = (placesRouter.stack as unknown[]).find(
    (entry: { route?: { path?: string } }) => entry?.route?.path === "/search",
  );
  const route = (layer as { route: { stack: Array<{ handle: (...args: unknown[]) => unknown }> } }).route;
  const handle = route.stack[route.stack.length - 1].handle;
  return handle as (req: { query: Record<string, unknown> }, res: Res) => Promise<void>;
}

interface Res {
  statusCode: number;
  body: Record<string, unknown>;
}

function mockRes(): Res & { status(code: number): unknown; json(body: unknown): unknown } {
  const res = {
    statusCode: 200,
    body: {} as Record<string, unknown>,
    status(code: number) {
      (this as { statusCode: number }).statusCode = code;
      return this;
    },
    json(body: unknown) {
      (this as { body: Record<string, unknown> }).body = body as Record<string, unknown>;
      return this;
    },
  };
  return res;
}

describe("GET /api/places/search (integration, mocked upstream)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("rejects a too-short query as invalid_query", async () => {
    vi.unstubAllEnvs();
    const handler = mountHandler();
    const res = mockRes();
    await handler({ query: { q: "ab" } }, res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("invalid_query");
  });

  it("returns not_configured when the Places API key is missing", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const handler = mountHandler();
    const res = mockRes();
    await handler({ query: { q: "campus gate" } }, res as never);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("not_configured");
  });

  it("returns upstream_error when the Places API responds non-ok", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("denied", { status: 403 }),
    ));
    const handler = mountHandler();
    const res = mockRes();
    await handler({ query: { q: "campus gate" } }, res as never);
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe("upstream_error");
  });

  it("returns upstream_timeout when the upstream call aborts", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_res, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason ?? new DOMException("aborted", "AbortError")),
      );
    })));

    const handler = mountHandler();
    const res = mockRes();
    const pending = handler({ query: { q: "campus gate" } }, res as never);
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;
    expect(res.statusCode).toBe(504);
    expect(res.body.code).toBe("upstream_timeout");
  });

  it("returns mapped results and a count on success", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        places: [
          {
            displayName: { text: "Ahmedabad University" },
            formattedAddress: "110, Ahmedabad",
            location: { latitude: 23.03, longitude: 72.55 },
          },
        ],
      }), { status: 200 }),
    ));
    const handler = mountHandler();
    const res = mockRes();
    await handler({ query: { q: "ahmedabad university" } }, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(1);
    expect((res.body.results as Array<{ name: string }>)[0].name).toBe("Ahmedabad University");
  });
});