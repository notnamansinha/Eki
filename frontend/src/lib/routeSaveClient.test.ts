import { describe, expect, it, vi } from "vitest";
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
});
