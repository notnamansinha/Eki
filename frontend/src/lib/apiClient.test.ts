import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";

describe("apiRequest", () => {
  afterEach(() => {
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

  it("times out while reading a response body", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    const timeout = new AbortController();
    let markBodyStarted = () => {};
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit = {}) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        markBodyStarted();
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    } as Response)));

    const request = apiRequest("/api/test");
    await bodyStarted;
    timeout.abort();
    await expect(request).rejects.toThrow("timed out");
  });

  it("does not hide malformed JSON from a successful response", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("not-json", { status: 200 }),
    ));
    await expect(apiRequest("/api/test")).rejects.toBeInstanceOf(SyntaxError);
  });
});
