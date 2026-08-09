import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Ref = { collection: string; id: string };

const harness = vi.hoisted(() => ({
  cooldown: undefined as Record<string, unknown> | undefined,
  feedbacks: new Map<string, Record<string, unknown>>(),
  profile: { displayName: "Verified Profile" } as Record<string, unknown>,
  session: {} as Record<string, unknown>,
  user: { uid: "passenger_1", name: "Token Name" },
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (
    req: { user?: Record<string, unknown> },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = harness.user;
    next();
  },
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (
    req: { user?: Record<string, unknown> },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { uid: "admin_1", role: "admin", admin: true };
    next();
  },
}));

vi.mock("../lib/firebaseAdmin", () => {
  const snapshot = (exists: boolean, data?: Record<string, unknown>) => ({
    exists,
    data: () => data,
  });
  const read = (ref: Ref) => {
    if (ref.collection === "feedbackCooldowns") {
      return snapshot(Boolean(harness.cooldown), harness.cooldown);
    }
    if (ref.collection === "users") return snapshot(true, harness.profile);
    if (ref.collection === "ride_sessions") return snapshot(true, harness.session);
    const feedback = harness.feedbacks.get(ref.id);
    return snapshot(Boolean(feedback), feedback);
  };

  return {
    db: {
      collection: (collection: string) => ({
        doc: (id: string) => ({ collection, id }),
      }),
      runTransaction: async (
        callback: (transaction: {
          create: (ref: Ref, value: Record<string, unknown>) => void;
          get: (ref: Ref) => Promise<ReturnType<typeof snapshot>>;
          getAll: (...refs: Ref[]) => Promise<Array<ReturnType<typeof snapshot>>>;
          set: (ref: Ref, value: Record<string, unknown>) => void;
          update: (ref: Ref, value: Record<string, unknown>) => void;
        }) => Promise<unknown>,
      ) => callback({
        create: (ref, value) => harness.feedbacks.set(ref.id, value),
        get: async (ref) => read(ref),
        getAll: async (...refs) => refs.map(read),
        set: (ref, value) => {
          if (ref.collection === "feedbackCooldowns") harness.cooldown = value;
        },
        update: (ref, value) => {
          const current = harness.feedbacks.get(ref.id) ?? {};
          harness.feedbacks.set(ref.id, { ...current, ...value });
        },
      }),
    },
  };
});

import feedbackRouter from "./feedback";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/feedback", feedbackRouter);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => {
  harness.cooldown = undefined;
  harness.feedbacks = new Map();
  harness.profile = { displayName: "Verified Profile" };
  harness.user = { uid: "passenger_1", name: "Token Name" };
  harness.session = {
    status: "completed",
    busId: "bus_1",
    driverId: "driver_1",
    passengers: {
      passenger_1: { userId: "passenger_1", userName: "Manifest Name" },
    },
  };
});

async function submit(overrides: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "ride",
      sessionId: "session_1",
      busId: "bus_1",
      driverId: "driver_1",
      rating: 5,
      comment: "Safe ride",
      requestId: "feedback_request_1",
      ...overrides,
    }),
  });
}

describe("feedback routes", () => {
  it("derives identity and atomically creates feedback plus cooldown", async () => {
    const response = await submit();

    expect(response.status).toBe(201);
    expect(harness.cooldown).toMatchObject({ userId: "passenger_1" });
    expect([...harness.feedbacks.values()][0]).toMatchObject({
      userId: "passenger_1",
      userName: "Verified Profile",
      type: "ride",
      status: "new",
    });
  });

  it("returns an identical retry without creating a second record", async () => {
    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(200);
    expect(harness.feedbacks.size).toBe(1);
  });

  it("rejects request-id reuse with a different payload", async () => {
    expect((await submit()).status).toBe(201);
    expect((await submit({ comment: "Changed" })).status).toBe(409);
  });

  it("enforces cooldown from the transaction read", async () => {
    harness.cooldown = { lastSubmittedAt: new Date(Date.now() - 1_000) };

    const response = await submit();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(harness.feedbacks.size).toBe(0);
  });

  it("requires an exact manifest entry and completed matching ride", async () => {
    harness.session.passengers = { passenger_1: { userId: "other" } };
    expect((await submit()).status).toBe(403);

    harness.session.passengers = {
      passenger_1: { userId: "passenger_1", userName: "Manifest Name" },
    };
    harness.session.status = "active";
    expect((await submit({ requestId: "feedback_request_2" })).status).toBe(409);
  });

  it("rejects client-supplied identity and nonnumeric ratings", async () => {
    expect((await submit({ userName: "Impostor" })).status).toBe(400);
    expect((await submit({ rating: "5" })).status).toBe(400);
    expect((await submit({ rating: 7 })).status).toBe(400);
  });

  it("updates feedback status through the admin route", async () => {
    harness.feedbacks.set("feedback_1", { status: "new", comment: "Keep me" });

    const response = await fetch(`${baseUrl}/api/feedback/feedback_1/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "reviewed" }),
    });

    expect(response.status).toBe(200);
    expect(harness.feedbacks.get("feedback_1")).toMatchObject({
      status: "reviewed",
      comment: "Keep me",
      reviewedBy: "admin_1",
    });

    const retry = await fetch(`${baseUrl}/api/feedback/feedback_1/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "reviewed" }),
    });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual({ updated: false, status: "reviewed" });

    const extraField = await fetch(`${baseUrl}/api/feedback/feedback_1/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved", comment: "overwrite" }),
    });
    expect(extraField.status).toBe(400);
  });
});
