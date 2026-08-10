import { describe, expect, it } from "vitest";
import {
  buildCollectionCacheKey,
  describeCollectionError,
  type CollectionOptions,
} from "./collectionCache";

describe("buildCollectionCacheKey", () => {
  const base: CollectionOptions = { maxResults: 250 };

  it("is stable for identical options", () => {
    const keyA = buildCollectionCacheKey("buses", base);
    const keyB = buildCollectionCacheKey("buses", base);
    expect(keyA).toBe(keyB);
  });

  it("distinguishes collections and limits", () => {
    expect(buildCollectionCacheKey("buses", base)).not.toBe(
      buildCollectionCacheKey("routes", base),
    );
    expect(buildCollectionCacheKey("buses", { maxResults: 10 })).not.toBe(
      buildCollectionCacheKey("buses", { maxResults: 250 }),
    );
  });

  it("includes orderBy constraints in the key", () => {
    const asc = buildCollectionCacheKey("ride_sessions", {
      orderByField: "startTime",
      orderByDirection: "asc",
    });
    const desc = buildCollectionCacheKey("ride_sessions", {
      orderByField: "startTime",
      orderByDirection: "desc",
    });
    expect(asc).not.toBe(desc);
  });

  it("distinguishes queries that differ ONLY in where constraints (#46)", () => {
    const noFilter = buildCollectionCacheKey("devices", base);
    const withFilter = buildCollectionCacheKey("devices", {
      ...base,
      whereConstraints: [{ fieldPath: "busId", op: "==", value: "bus_1" }],
    });
    const otherFilter = buildCollectionCacheKey("devices", {
      ...base,
      whereConstraints: [{ fieldPath: "busId", op: "==", value: "bus_2" }],
    });
    expect(noFilter).not.toBe(withFilter);
    expect(withFilter).not.toBe(otherFilter);
  });

  it("treats constraint order as significant", () => {
    const first = buildCollectionCacheKey("devices", {
      whereConstraints: [
        { fieldPath: "busId", op: "==", value: "bus_1" },
        { fieldPath: "routeId", op: "==", value: "route_1" },
      ],
    });
    const reversed = buildCollectionCacheKey("devices", {
      whereConstraints: [
        { fieldPath: "routeId", op: "==", value: "route_1" },
        { fieldPath: "busId", op: "==", value: "bus_1" },
      ],
    });
    expect(first).not.toBe(reversed);
  });

  it("supports array and object constraint values", () => {
    const inClause = buildCollectionCacheKey("ride_sessions", {
      whereConstraints: [{ fieldPath: "status", op: "in", value: ["pending", "active"] }],
    });
    const scalar = buildCollectionCacheKey("ride_sessions", {
      whereConstraints: [{ fieldPath: "status", op: "==", value: "active" }],
    });
    expect(inClause).not.toBe(scalar);
  });
});

describe("describeCollectionError", () => {
  it("names the collection and the permission failure", () => {
    expect(
      describeCollectionError("messages", { code: "permission-denied" }),
    ).toContain("messages");
    expect(
      describeCollectionError("messages", { code: "permission-denied" }),
    ).toMatch(/permission/i);
  });

  it("falls back to a generic failure message", () => {
    expect(describeCollectionError("messages", new Error("boom"))).toContain("messages");
  });
});
