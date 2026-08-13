import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const whereCalls: Array<[unknown, unknown, unknown]> = [];
  const batchUpdates: Array<Record<string, unknown>> = [];
  const query = (name: string) => ({
    where: (...args: [unknown, unknown, unknown]) => {
      if (name === "ride_sessions") whereCalls.push(args);
      return query(name);
    },
    limit: () => query(name),
    get: async () => ({ empty: true, docs: [] }),
  });
  return {
    auth: { deleteUser: vi.fn(async () => undefined) },
    batchUpdates,
    db: {
      collection: (name: string) => query(name),
      batch: () => ({
        delete: () => undefined,
        update: (ref: unknown, data: Record<string, unknown>) => {
          batchUpdates.push({ ref, data });
        },
        commit: async () => undefined,
      }),
    },
    whereCalls,
  };
});

vi.mock("../lib/firebaseAdmin", () => ({ db: mocks.db, auth: mocks.auth }));

import { removePassengerManifest } from "./privacyDeletionWorker";

describe("removePassengerManifest", () => {
  beforeEach(() => {
    mocks.whereCalls.length = 0;
    mocks.batchUpdates.length = 0;
  });

  it("uses the indexable array and preserves a legacy query until backfill completes", async () => {
    await removePassengerManifest("uid_1");

    // The indexed query is used first, but historic documents may not have
    // passengerIds yet. The fallback makes deletion complete during rollout.
    expect(mocks.whereCalls[0]).toEqual(["passengerIds", "array-contains", "uid_1"]);
    expect(mocks.whereCalls[1]).toEqual([
      expect.anything(),
      "==",
      "uid_1",
    ]);
  });

  it("removes the passenger from the manifest and the passengerIds array", async () => {
    const sessionRef = { id: "session_1" };
    let pageCalls = 0;
    mocks.db.collection = vi.fn((name: string) =>
      name === "ride_sessions"
        ? {
            where: () => ({
              limit: () => ({
                get: async () => {
                  pageCalls += 1;
                  return pageCalls === 1
                    ? { empty: false, size: 1, docs: [{ ref: sessionRef }] }
                    : { empty: true, docs: [] };
                },
              }),
            }),
          }
        : {
            where: () => ({
              limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
            }),
          },
    ) as unknown as typeof mocks.db.collection;

    const count = await removePassengerManifest("uid_1");

    expect(count).toBe(1);
    // Pagination terminates: the first page is non-empty, the second is empty,
    // so the while(true) loop exits. Previously the mock ALWAYS returned a
    // non-empty page, the loop never ended, and the worker OOM'd in CI.
    // The indexed query has one populated page and one empty page; the
    // legacy fallback is also queried once and is empty.
    expect(pageCalls).toBe(3);
    const passengerIdsUpdate = mocks.batchUpdates[0].data.passengerIds as {
      elements: string[];
    };
    // arrayRemove is an ArrayRemoveTransform (arrayUnion is ArrayUnionTransform);
    // JSON.stringify can't distinguish them and omits the transform name, so
    // assert on the transform type directly.
    expect(passengerIdsUpdate.elements).toEqual(["uid_1"]);
    expect(passengerIdsUpdate.constructor.name).toBe("ArrayRemoveTransform");
  });
});
