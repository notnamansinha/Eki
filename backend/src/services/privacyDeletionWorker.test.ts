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

  it("queries sessions by the indexable passengerIds array, not a dynamic map path", async () => {
    await removePassengerManifest("uid_1");

    // The old query on passengers.{uid}.userId is unindexable (dynamic key);
    // the array-contains query on passengerIds uses automatic indexes
    // (issue #49 L3).
    expect(mocks.whereCalls[0]).toEqual(["passengerIds", "array-contains", "uid_1"]);
  });

  it("removes the passenger from the manifest and the passengerIds array", async () => {
    const sessionRef = { id: "session_1" };
    mocks.db.collection = vi.fn((name: string) =>
      name === "ride_sessions"
        ? {
            where: () => ({
              limit: () => ({
                get: async () => ({
                  empty: false,
                  docs: [{ ref: sessionRef }],
                }),
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
    expect(mocks.batchUpdates[0].data).toMatchObject({
      passengerIds: expect.anything(),
    });
    expect(JSON.stringify(mocks.batchUpdates[0].data)).toContain("arrayRemove");
  });
});
