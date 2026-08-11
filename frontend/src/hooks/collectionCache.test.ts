import { afterAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp } from "firebase/app";
import { doc, getFirestore, Timestamp } from "firebase/firestore";
import {
  buildCollectionCacheKey,
  describeCollectionError,
  normalizeCollectionError,
  type CollectionOptions,
} from "./collectionCache";

const firebaseApp = initializeApp(
  { projectId: "collection-cache-test" },
  "collection-cache-test",
);

afterAll(async () => {
  await deleteApp(firebaseApp);
});

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

  it("distinguishes a Date value from its ISO-string form", () => {
    const iso = "2026-01-01T00:00:00.000Z";
    const asDate = buildCollectionCacheKey("ride_sessions", {
      whereConstraints: [{ fieldPath: "time", op: ">=", value: new Date(iso) }],
    });
    const asString = buildCollectionCacheKey("ride_sessions", {
      whereConstraints: [{ fieldPath: "time", op: ">=", value: iso }],
    });
    expect(asDate).not.toBe(asString);
  });

  it("distinguishes a Firestore Timestamp-like value from a plain object", () => {
    const timestamp = Timestamp.fromMillis(1_767_225_600_000);
    const timestampKey = buildCollectionCacheKey("ride_sessions", {
      whereConstraints: [
        { fieldPath: "time", op: ">=", value: timestamp },
      ],
    });
    const plainMapKey = buildCollectionCacheKey("ride_sessions", {
      whereConstraints: [
        {
          fieldPath: "time",
          op: ">=",
          value: { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds },
        },
      ],
    });
    expect(timestampKey).not.toBe(plainMapKey);
  });

  it("is stable for object values regardless of key order", () => {
    const forward = buildCollectionCacheKey("buses", {
      whereConstraints: [{ fieldPath: "tags", op: "==", value: { a: 1, b: 2 } }],
    });
    const backward = buildCollectionCacheKey("buses", {
      whereConstraints: [{ fieldPath: "tags", op: "==", value: { b: 2, a: 1 } }],
    });
    expect(forward).toBe(backward);
  });

  it("escapes delimiters so structurally different constraints never alias", () => {
    const embeddedConstraint = buildCollectionCacheKey("devices", {
      whereConstraints: [
        { fieldPath: "a", op: "==", value: "x|b:==:s:y" },
      ],
    });
    const twoConstraints = buildCollectionCacheKey("devices", {
      whereConstraints: [
        { fieldPath: "a", op: "==", value: "x" },
        { fieldPath: "b", op: "==", value: "y" },
      ],
    });
    expect(embeddedConstraint).not.toBe(twoConstraints);
  });

  it("encodes DocumentReference values without traversing SDK internals", () => {
    const firestore = getFirestore(firebaseApp);
    const first = buildCollectionCacheKey("devices", {
      whereConstraints: [
        { fieldPath: "owner", op: "==", value: doc(firestore, "users/one") },
      ],
    });
    const second = buildCollectionCacheKey("devices", {
      whereConstraints: [
        { fieldPath: "owner", op: "==", value: doc(firestore, "users/two") },
      ],
    });
    expect(first).not.toBe(second);
  });

  it("rejects cyclic query maps deterministically", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      buildCollectionCacheKey("devices", {
        whereConstraints: [{ fieldPath: "metadata", op: "==", value: cyclic }],
      }),
    ).toThrow(/cycles/i);
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

  it("preserves the Firebase code for programmatic recovery and logging", () => {
    expect(normalizeCollectionError("routes", { code: "unavailable" })).toEqual({
      code: "unavailable",
      message: "Failed to load routes.",
    });
    expect(normalizeCollectionError("routes", new Error("network"))).toEqual({
      code: "unknown",
      message: "Failed to load routes.",
    });
  });
});
