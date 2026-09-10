import { describe, expect, it } from "vitest";
import { ApiError } from "./apiClient";
import { placeSearchErrorMessage } from "./placeSearchErrors";

describe("place search error messages", () => {
  it("maps structured backend, auth, rate-limit, timeout, and network codes", () => {
    for (const code of [
      "AUTH_REQUIRED",
      "ADMIN_REQUIRED",
      "AUTH_INVALID",
      "AUTH_BUSY",
      "PLACES_NOT_CONFIGURED",
      "PLACES_UPSTREAM_RATE_LIMITED",
      "PLACE_SEARCH_RATE_LIMITED",
      "PLACES_TIMEOUT",
      "BACKEND_UNAVAILABLE",
    ]) {
      expect(placeSearchErrorMessage(new ApiError("fallback", code, 503)))
        .not.toBe("fallback");
    }
  });

  it("preserves a useful unknown upstream message", () => {
    expect(placeSearchErrorMessage(new Error("Search failed"))).toBe("Search failed");
  });
});
