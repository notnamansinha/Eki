import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";

describe("apiRequest", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses the configured backend and returns JSON", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test/");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest<{ ok: boolean }>("/api/test")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/test",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("surfaces a server error message", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Denied" }), { status: 403 }),
    ));

    await expect(apiRequest("/api/test")).rejects.toThrow("Denied");
  });

  it("uses the HTTP fallback for empty or non-string server errors", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("not-json", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "denied" } }), { status: 403 })));

    await expect(apiRequest("/api/test", { fallbackError: "Unavailable" }))
      .rejects.toThrow("Unavailable (HTTP 502)");
    await expect(apiRequest("/api/test", { fallbackError: "Denied" }))
      .rejects.toThrow("Denied (HTTP 403)");
  });

  it("returns undefined for a successful no-content response", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiRequest<void>("/api/test")).resolves.toBeUndefined();
  });

  it("normalizes trailing slashes and rejects unsafe backend URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test/base///");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/api/test");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/base/api/test",
      expect.any(Object),
    );

    for (const invalid of ["not-a-url", "ftp://api.example.test", "https://api.example.test?q=1"]) {
      vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", invalid);
      await expect(apiRequest("/api/test")).rejects.toThrow("not configured");
    }
  });

  it("propagates caller cancellation", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit = {}) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    ));

    const request = apiRequest("/api/test", { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("explains a network failure and propagates an already-aborted caller signal", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    const networkError = new TypeError("Network request failed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(networkError));
    await expect(apiRequest("/api/test")).rejects.toThrow(
      "The backend is unreachable. Check the configured server URL and try again.",
    );

    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit = {}) =>
      Promise.reject(init.signal?.reason),
    ));
    await expect(apiRequest("/api/test", { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("times out while reading a response body", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    vi.useFakeTimers();
    let markBodyStarted = () => {};
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit = {}) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        markBodyStarted();
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    } as Response)));

    const request = apiRequest("/api/test");
    const rejection = expect(request).rejects.toThrow("timed out");
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });

  it("rejects a missing backend URL before fetching", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("/api/test")).rejects.toThrow("invalid or not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not hide malformed JSON from a successful response", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("not-json", { status: 200 }),
    ));
    await expect(apiRequest("/api/test")).rejects.toBeInstanceOf(SyntaxError);
  });

  it("does not mislabel response parsing failures as network failures", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    const parsingError = new TypeError("Response body stream failed");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(parsingError),
    } as Response));

    await expect(apiRequest("/api/test")).rejects.toBe(parsingError);
  });
});
