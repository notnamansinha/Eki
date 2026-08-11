import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";

describe("apiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
});
