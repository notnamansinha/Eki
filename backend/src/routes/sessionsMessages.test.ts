import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type User = {
  uid: string;
  role?: string;
  name?: string;
  driverId?: string;
  assignedBusId?: string;
};

const harness = vi.hoisted(() => ({
  messages: new Map<string, Record<string, unknown>>(),
  rate: undefined as Record<string, unknown> | undefined,
  session: {} as Record<string, unknown>,
  setKinds: [] as string[],
  user: {} as User,
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (
    req: { user?: User },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = harness.user;
    next();
  },
}));

vi.mock("../lib/firebaseAdmin", () => {
  type Ref = {
    kind: "session" | "rate" | "message";
    id: string;
    collection: (name: string) => { doc: (id: string) => Ref };
    get: () => Promise<ReturnType<typeof snapshot>>;
  };
  const snapshot = (exists: boolean, data?: Record<string, unknown>) => ({
    exists,
    data: () => data,
  });
  const makeRef = (kind: Ref["kind"], id: string): Ref => ({
    kind,
    id,
    collection: (name: string) => ({
      doc: (childId: string) => makeRef(
        name === "messageRateLimits" ? "rate" : "message",
        childId,
      ),
    }),
    get: async () => snapshot(kind === "session", kind === "session" ? harness.session : undefined),
  });
  const read = (ref: Ref) => {
    if (ref.kind === "session") return snapshot(true, harness.session);
    if (ref.kind === "rate") return snapshot(Boolean(harness.rate), harness.rate);
    const message = harness.messages.get(ref.id);
    return snapshot(Boolean(message), message);
  };

  return {
    db: {
      collection: (name: string) => ({
        doc: (id: string) => makeRef(name === "ride_sessions" ? "session" : "message", id),
      }),
      runTransaction: async (
        callback: (transaction: {
          getAll: (...refs: Ref[]) => Promise<Array<ReturnType<typeof snapshot>>>;
          set: (ref: Ref, value: Record<string, unknown>) => void;
        }) => Promise<unknown>,
      ) => callback({
        getAll: async (...refs: Ref[]) => refs.map(read),
        set: (ref: Ref, value: Record<string, unknown>) => {
          harness.setKinds.push(ref.kind);
          if (ref.kind === "rate") harness.rate = value;
          if (ref.kind === "message") harness.messages.set(ref.id, value);
        },
      }),
    },
    rtdb: { ref: () => ({ once: async () => ({ val: () => null }) }) },
  };
});

import sessionsRouter from "./sessions";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionsRouter);
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
  harness.messages = new Map();
  harness.rate = undefined;
  harness.setKinds = [];
  harness.user = { uid: "passenger_1", role: "passenger", name: "Token Name" };
  harness.session = {
    status: "active",
    busId: "bus_1",
    driverId: "driver_1",
    passengers: {
      passenger_1: { userId: "passenger_1", userName: "Manifest Name" },
    },
  };
});

async function send(text = "Hello", requestId = "request_12345678", extra = {}) {
  return fetch(`${baseUrl}/api/sessions/session_1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, requestId, ...extra }),
  });
}

describe("session message route", () => {
  it("derives passenger identity and writes message plus rate state atomically", async () => {
    const response = await send();

    expect(response.status).toBe(201);
    expect(harness.setKinds).toEqual(["rate", "message"]);
    expect([...harness.messages.values()][0]).toMatchObject({
      text: "Hello",
      from: "passenger",
      senderName: "Manifest Name",
      senderId: "passenger_1",
    });
  });

  it("returns the prior result for an identical retry without consuming rate", async () => {
    expect((await send()).status).toBe(201);
    harness.setKinds = [];

    const retry = await send();

    expect(retry.status).toBe(200);
    expect(harness.setKinds).toEqual([]);
    expect(harness.messages.size).toBe(1);
  });

  it("rejects request-id reuse with different content", async () => {
    expect((await send()).status).toBe(201);
    expect((await send("Changed")).status).toBe(409);
  });

  it("rejects client-supplied identity fields", async () => {
    expect((await send("Hello", "request_12345678", { senderName: "Impostor" })).status).toBe(400);
  });

  it("normalizes and censors obfuscated profanity before it is persisted", async () => {
    const response = await send("  f.u.c.k\u200B   this  ");

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ moderated: true, sent: true });
    expect([...harness.messages.values()][0]).toMatchObject({
      text: "*** this",
      moderated: true,
      moderationVersion: 2,
    });
  });

  it("filters an unsafe server-derived display name", async () => {
    harness.session.passengers = {
      passenger_1: { userId: "passenger_1", userName: "sh1t" },
    };

    expect((await send()).status).toBe(201);
    expect([...harness.messages.values()][0]).toMatchObject({ senderName: "***" });
  });

  it("enforces the exact full hourly window", async () => {
    const now = Date.now();
    harness.rate = {
      sentAt: Array.from({ length: 60 }, (_, index) => new Date(now - 120_000 + index * 1_000)),
      lastSentAt: new Date(now - 5_000),
    };

    const response = await send();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(harness.messages.size).toBe(0);
  });

  it("rechecks membership and live session status inside the transaction", async () => {
    harness.session.passengers = {};
    expect((await send()).status).toBe(403);

    harness.session.passengers = {
      passenger_1: { userId: "passenger_1", userName: "Manifest Name" },
    };
    harness.session.status = "completed";
    expect((await send("Again", "request_abcdefgh")).status).toBe(409);
  });

  it("requires both driver identity and assigned bus and derives the token name", async () => {
    harness.user = {
      uid: "driver_auth",
      role: "driver",
      name: "Verified Driver",
      driverId: "driver_1",
      assignedBusId: "wrong_bus",
    };
    expect((await send()).status).toBe(403);

    harness.user.assignedBusId = "bus_1";
    const response = await send("Driver update", "request_driver_1234");
    expect(response.status).toBe(201);
    expect([...harness.messages.values()][0]).toMatchObject({
      from: "driver",
      senderName: "Verified Driver",
    });
  });

  it("allows an authenticated administrator without trusting client identity fields", async () => {
    harness.user = { uid: "admin_auth", role: "admin", name: "Campus Admin" };
    harness.session.passengers = {};

    const response = await send("Service update", "request_admin_12345");

    expect(response.status).toBe(201);
    expect([...harness.messages.values()][0]).toMatchObject({
      from: "driver",
      senderId: "admin_auth",
      senderName: "Campus Admin",
    });
  });
});
