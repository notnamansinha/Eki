import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./apiClient";
import { ROUTE_SAVE_TIMEOUT_MS, saveRoute } from "./routeSaveClient";

const saved = {
  status: "succeeded" as const,
  saved: true as const,
  saveId: "save-1",
  routeId: "route-1",
  configVersion: 2,
  geometryVersion: 1,
  geometryReused: true,
  polyline: "encoded",
  distanceMeters: 100,
  duration: "10s",
};

describe("route save client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("uses the route-specific timeout and stable save ID", async () => {
    const request = vi.fn().mockResolvedValue(saved);
    await expect(saveRoute(
      "route-1",
      "save-1",
      { mode: "edit", expectedVersion: 1 },
      "token",
      undefined,
      request,
    )).resolves.toEqual(saved);
    expect(request).toHaveBeenCalledWith(
      "/api/routes/route-1",
      expect.objectContaining({ timeoutMs: ROUTE_SAVE_TIMEOUT_MS }),
    );
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ saveId: "save-1" });
  });

  it("reconciles a timeout-after-commit without issuing another write", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new ApiError("timeout", "NETWORK_TIMEOUT", null, "network", true))
      .mockResolvedValueOnce(saved);
    await expect(saveRoute("route-1", "save-1", { expectedVersion: 1 }, "token", undefined, request))
      .resolves.toEqual(saved);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toContain("save-operations/save-1");
  });

  it("retries once with the same operation after a pre-delivery network failure", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new ApiError("offline", "BACKEND_UNAVAILABLE", null, "network", true))
      .mockRejectedValueOnce(new ApiError("missing", "SAVE_OPERATION_NOT_FOUND", 404))
      .mockResolvedValueOnce(saved);
    await expect(saveRoute("route-1", "save-1", { expectedVersion: 1 }, "token", undefined, request))
      .resolves.toEqual(saved);
    expect(request).toHaveBeenCalledTimes(3);
    expect(JSON.parse(request.mock.calls[0][1].body).saveId).toBe("save-1");
    expect(JSON.parse(request.mock.calls[2][1].body).saveId).toBe("save-1");
  });

  it("reconciles a committed save after one transient 503 status poll", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: "processing", saveId: "save-1", retryAfterMs: 1 })
      .mockRejectedValueOnce(new ApiError("status unavailable", "ROUTE_RECONCILIATION_FAILED", 503, "persistence", true, 1))
      .mockResolvedValueOnce(saved);
    await expect(saveRoute("route-1", "save-1", { expectedVersion: 1 }, "token", undefined, request))
      .resolves.toEqual(saved);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/api/routes/route-1",
      "/api/routes/route-1/save-operations/save-1",
      "/api/routes/route-1/save-operations/save-1",
    ]);
  });

  it("reconciles a committed save after one network failure on a status poll", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: "processing", saveId: "save-1", retryAfterMs: 1 })
      .mockRejectedValueOnce(new ApiError("offline", "BACKEND_UNAVAILABLE", null, "network", true))
      .mockResolvedValueOnce(saved);
    await expect(saveRoute("route-1", "save-1", { expectedVersion: 1 }, "token", undefined, request))
      .resolves.toEqual(saved);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.filter(([, options]) => options.method === "PUT")).toHaveLength(1);
  });

  it("recovers an unknown initial PUT after a transient status-read 503", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new ApiError("timeout", "NETWORK_TIMEOUT", null, "network", true))
      .mockRejectedValueOnce(new ApiError("status unavailable", "ROUTE_RECONCILIATION_FAILED", 503))
      .mockResolvedValueOnce(saved);
    await expect(saveRoute("route-1", "save-1", { expectedVersion: 1 }, "token", undefined, request))
      .resolves.toEqual(saved);
    expect(request.mock.calls.filter(([, options]) => options.method === "PUT")).toHaveLength(1);
    expect(request.mock.calls.slice(1).every(([path]) => path.endsWith("/save-operations/save-1"))).toBe(true);
  });

  it("retries admin authentication capacity on a status GET through apiRequest", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "processing", saveId: "save-1" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Authentication service is busy. Retry shortly.",
        code: "AUTH_BUSY",
        phase: "authentication",
      }), { status: 503, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(saved), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = expect(saveRoute("route-1", "save-1", { expectedVersion: 1 }, "token"))
      .resolves.toEqual(saved);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.test/api/routes/route-1",
      "https://api.example.test/api/routes/route-1/save-operations/save-1",
      "https://api.example.test/api/routes/route-1/save-operations/save-1",
    ]);
    expect(fetchMock.mock.calls.map(([, options]) => options.method ?? "GET")).toEqual(["PUT", "GET", "GET"]);
  });

  it("respects Retry-After with the polling cap and retains the operation ID after 429", async () => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockRejectedValueOnce(new ApiError("rate limited", "HTTP_ERROR", 429, undefined, false, 10_000))
      .mockResolvedValueOnce(saved);
    const outcome = saveRoute("route-1", "save-1", {}, "token", undefined, vi.fn()
      .mockResolvedValueOnce({ status: "processing", saveId: "save-1", retryAfterMs: 250 })
      .mockImplementation(request));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toEqual(saved);
    expect(request.mock.calls.every(([path]) => path.endsWith("/save-operations/save-1"))).toBe(true);
  });

  it.each([
    [1, 250],
    [9_000, 2_000],
    [Number.NaN, 750],
  ])("clamps processing hint %s to %i ms", async (hint, delay) => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockResolvedValueOnce({ status: "processing", saveId: "save-1" })
      .mockResolvedValueOnce({ status: "processing", saveId: "save-1", retryAfterMs: hint })
      .mockResolvedValueOnce(saved);
    const outcome = saveRoute("route-1", "save-1", {}, "token", undefined, request);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toEqual(saved);
  });

  it("returns unknown outcome at the deadline after repeated transient failures, without another PUT", async () => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockResolvedValueOnce({ status: "processing", saveId: "save-1", retryAfterMs: 250 })
      .mockRejectedValue(new ApiError("unavailable", "ROUTE_RECONCILIATION_FAILED", 503, "persistence", true, 20_000));
    const outcome = expect(saveRoute("route-1", "save-1", {}, "token", undefined, request))
      .rejects.toMatchObject({ code: "ROUTE_RECONCILIATION_TIMEOUT", outcomeUnknown: true });
    await vi.advanceTimersByTimeAsync(35_000);
    await outcome;
    expect(request.mock.calls.filter(([, options]) => options.method === "PUT")).toHaveLength(1);
    expect(request.mock.calls.every(([path], index) => index === 0 || path.endsWith("/save-operations/save-1"))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    new ApiError("bad operation", "INVALID_SAVE_OPERATION", 400),
    new ApiError("login required", "AUTH_REQUIRED", 401, "authentication"),
    new ApiError("token invalid", "AUTH_INVALID", 401, "authentication"),
    new ApiError("admin required", "ADMIN_REQUIRED", 403, "authentication"),
    new ApiError("denied", "HTTP_ERROR", 403),
    new ApiError("stored failure", "ROUTING_UPSTREAM_FAILURE", 502, "routing"),
    new ApiError("stored failure", "ROUTING_NOT_CONFIGURED", 503, "routing"),
  ])("stops immediately on terminal status error %s", async error => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: "processing", saveId: "save-1", retryAfterMs: 250 })
      .mockRejectedValueOnce(error);
    await expect(saveRoute("route-1", "save-1", {}, "token", undefined, request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("aborts during the wait without starting another poll or leaving a timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = vi.fn().mockResolvedValue({ status: "processing", saveId: "save-1", retryAfterMs: 1_000 });
    const outcome = expect(saveRoute("route-1", "save-1", {}, "token", controller.signal, request))
      .rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await outcome;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fences a late successful poll callback after abort", async () => {
    const controller = new AbortController();
    let resolvePoll!: (value: typeof saved) => void;
    const request = vi.fn()
      .mockResolvedValueOnce({ status: "processing", saveId: "save-1", retryAfterMs: 250 })
      .mockImplementationOnce(() => new Promise(resolve => { resolvePoll = resolve; }));
    const outcome = expect(saveRoute("route-1", "save-1", {}, "token", controller.signal, request))
      .rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    controller.abort();
    resolvePoll(saved);
    await outcome;
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight status request immediately", async () => {
    const controller = new AbortController();
    const request = vi.fn()
      .mockResolvedValueOnce({ status: "processing", saveId: "save-1", retryAfterMs: 250 })
      .mockImplementationOnce((_path, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      }));
    const outcome = expect(saveRoute("route-1", "save-1", {}, "token", controller.signal, request))
      .rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    controller.abort();
    await outcome;
    expect(request).toHaveBeenCalledTimes(2);
  });
});
