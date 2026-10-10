import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  creationTime: "2026-01-01T00:00:00.000Z",
  requests: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../lib/firebaseAdmin", () => {
  const ref = (name: string, id: string): any => ({
    name,
    id,
    get: async () => ({
      exists: name === "users" || harness.requests.has(id),
      data: () =>
        name === "users" ? { role: "passenger" } : harness.requests.get(id),
    }),
  });
  const query = (name: string): any => ({
    doc: (id: string) => ref(name, id),
    where: () => query(name),
    limit: () => query(name),
    orderBy: () => query(name),
    startAfter: () => query(name),
    get: async () =>
      name === "drivers"
        ? { empty: true }
        : {
            size: harness.requests.size,
            docs: [...harness.requests].map(([id, data]) => ({
              id,
              data: () => data,
            })),
          },
  });
  return {
    auth: {
      getUser: async () => ({
        customClaims: {},
        metadata: { creationTime: harness.creationTime },
      }),
    },
    db: {
      collection: query,
      runTransaction: async (work: any) =>
        work({
          get: (r: any) => r.get(),
          create: (r: any, data: any) => harness.requests.set(r.id, data),
          set: (r: any, data: any) =>
            harness.requests.set(r.id, {
              ...harness.requests.get(r.id),
              ...data,
            }),
        }),
    },
  };
});

import {
  PrivacyConflict,
  requestPrivacyDeletion,
} from "./privacyDeletionRequests";

const UID = "user_1";

function seedRequest(data: Record<string, unknown>) {
  harness.requests.set(UID, { ...data });
}

function stored() {
  const doc = harness.requests.get(UID);
  if (!doc) throw new Error("expected a privacy request doc to exist");
  return doc;
}

describe("privacy deletion resubmission edge cases (qa)", () => {
  it("resets a failed request to pending with a bumped generation", async () => {
    harness.requests.clear();
    seedRequest({
      status: "failed",
      attempts: 5,
      failures: 5,
      generation: 0,
      targetCreatedAt: "2026-01-01T00:00:00.000Z",
      lastErrorCode: "CLEANUP_FAILED",
    });
    await requestPrivacyDeletion(UID);
    const doc = stored();
    expect(doc.status).toBe("pending");
    expect(doc.failures).toBe(0);
    expect(doc.generation).toBe(1);
    expect(doc.phase).toBe("cleaning");
    expect(typeof doc.nextAttemptAt).toBe("number");
  });

  it("does NOT reset a processing request on resubmission", async () => {
    harness.requests.clear();
    seedRequest({
      status: "processing",
      attempts: 2,
      failures: 1,
      generation: 2,
      executorId: "exec_1",
      deadlineAt: Date.now() + 600_000,
      targetCreatedAt: "2026-01-01T00:00:00.000Z",
    });
    await requestPrivacyDeletion(UID);
    const doc = stored();
    // An active processing claim must survive resubmission untouched.
    expect(doc.status).toBe("processing");
    expect(doc.generation).toBe(2);
    expect(doc.failures).toBe(1);
    expect(doc.executorId).toBe("exec_1");
    expect(doc.phase).toBeUndefined();
  });

  it("throws PrivacyConflict when the account identity changed", async () => {
    harness.requests.clear();
    harness.creationTime = "2026-01-01T00:00:00.000Z";
    seedRequest({
      status: "failed",
      failures: 5,
      generation: 0,
      targetCreatedAt: "2026-01-01T00:00:00.000Z",
    });
    // The Auth account was recreated: creationTime no longer matches.
    harness.creationTime = "2026-02-02T00:00:00.000Z";
    await expect(requestPrivacyDeletion(UID)).rejects.toThrow(PrivacyConflict);
    await expect(requestPrivacyDeletion(UID)).rejects.toThrow(
      /identity changed/i,
    );
    // The failed request must not be revived or mutated.
    expect(stored().status).toBe("failed");
    harness.creationTime = "2026-01-01T00:00:00.000Z";
  });

  it("resubmission after a second failure bumps generation again", async () => {
    harness.requests.clear();
    seedRequest({
      status: "failed",
      attempts: 5,
      failures: 5,
      generation: 0,
      targetCreatedAt: "2026-01-01T00:00:00.000Z",
    });
    await requestPrivacyDeletion(UID);
    expect(stored().generation).toBe(1);
    expect(stored().status).toBe("pending");
    // Resubmitting while still pending must not bump generation again.
    await requestPrivacyDeletion(UID);
    expect(stored().generation).toBe(1);
    // The worker fails the revived request; a fresh resubmission bumps again.
    seedRequest({ ...stored(), status: "failed", failures: 5 });
    await requestPrivacyDeletion(UID);
    const doc = stored();
    expect(doc.status).toBe("pending");
    expect(doc.generation).toBe(2);
    expect(doc.failures).toBe(0);
    expect(doc.phase).toBe("cleaning");
  });
});
