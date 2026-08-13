import type { Server } from "node:http";
import express from "express";
import { FieldValue } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  liveReads: 0,
  removePassengerBeforeTransaction: false,
  sessionPassengers: {} as Record<string, Record<string, unknown>>,
  updates: [] as unknown[][],
  joinUid: "passenger_1",
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (
    req: { user?: Record<string, unknown> },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { uid: harness.joinUid, role: "passenger", name: "Token Name" };
    next();
  },
}));

vi.mock("../lib/firebaseAdmin", () => {
  const snapshot = (exists: boolean, data?: Record<string, unknown>) => ({
    exists,
    data: () => data,
  });
  const sessionData = () => ({
    status: "active",
    boardingCode: "ABCD2345",
    busId: "bus_1",
    routeId: "route_1",
    passengers: harness.sessionPassengers,
  });
  const document = (collectionName: string) => ({
    get: async () => {
      if (collectionName === "ride_sessions") return snapshot(true, sessionData());
      if (collectionName === "routes") {
        return snapshot(true, { stops: [{ id: "stop_1" }, { id: "stop_2" }] });
      }
      if (collectionName === "users") return snapshot(true, { displayName: "Profile Name" });
      return snapshot(false);
    },
  });

  return {
    db: {
      collection: (collectionName: string) => ({
        doc: () => document(collectionName),
      }),
      runTransaction: async (
        callback: (transaction: {
          get: () => Promise<ReturnType<typeof snapshot>>;
          update: (...args: unknown[]) => void;
        }) => Promise<unknown>,
      ) => {
        if (harness.removePassengerBeforeTransaction) harness.sessionPassengers = {};
        return callback({
          get: async () => snapshot(true, sessionData()),
          update: (...args: unknown[]) => harness.updates.push(args),
        });
      },
    },
    rtdb: {
      ref: () => ({
        once: async () => {
          harness.liveReads += 1;
          return {
            val: () => ({
              sessionId: "session_1",
              busId: "bus_1",
              routeId: "route_1",
              status: "active",
              deviceState: "online",
              motionState: "stopped",
              lat: 23,
              lng: 72.5,
              timestamp: Date.now(),
            }),
          };
        },
      }),
    },
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
  harness.liveReads = 0;
  harness.removePassengerBeforeTransaction = false;
  harness.sessionPassengers = {};
  harness.updates = [];
  harness.joinUid = "passenger_1";
});

async function join(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/sessions/session_1/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      boardingCode: "ABCD2345",
      boardingStopId: "stop_1",
      alightingStopId: "stop_2",
      ...body,
    }),
  });
}

describe("session passenger join route", () => {
  it("records membership in an indexable passengerIds array for privacy deletion", async () => {
    const response = await join({ lat: 23, lng: 72.5, accuracy: 20 });

    expect(response.status).toBe(200);
    const args = harness.updates[0];
    const keyIndex = args.indexOf("passengerIds");
    expect(keyIndex).toBeGreaterThan(0);
    expect(args[keyIndex + 1]).toBeInstanceOf(FieldValue);
  });

  it("rejects a first-time passenger without coordinates before live lookup", async () => {
    const response = await join({});

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Location access is required to board this bus.",
    });
    expect(harness.liveReads).toBe(0);
    expect(harness.updates).toHaveLength(0);
  });

  it("performs live proximity validation for first boarding", async () => {
    const response = await join({ lat: 23, lng: 72.5, accuracy: 20 });

    expect(response.status).toBe(200);
    expect(harness.liveReads).toBe(1);
    expect(harness.updates).toHaveLength(1);
  });

  it("updates an existing passenger without another location prompt", async () => {
    harness.sessionPassengers = {
      passenger_1: { userId: "passenger_1", joinedAt: 1234 },
    };

    const response = await join({});

    expect(response.status).toBe(200);
    expect(harness.liveReads).toBe(0);
    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0][2]).toMatchObject({
      userId: "passenger_1",
      userName: "Profile Name",
      boardingStopId: "stop_1",
      alightingStopId: "stop_2",
      joinedAt: 1234,
    });
  });

  it("rejects a coordinate-free update if membership disappears before commit", async () => {
    harness.sessionPassengers = {
      passenger_1: { userId: "passenger_1", joinedAt: 1234 },
    };
    harness.removePassengerBeforeTransaction = true;

    const response = await join({});

    expect(response.status).toBe(409);
    expect(harness.updates).toHaveLength(0);
  });

  it("does not trust unchecked coordinates if existing membership disappears", async () => {
    harness.sessionPassengers = {
      passenger_1: { userId: "passenger_1", joinedAt: 1234 },
    };
    harness.removePassengerBeforeTransaction = true;

    const response = await join({ lat: 23, lng: 72.5, accuracy: 20 });

    expect(response.status).toBe(409);
    expect(harness.liveReads).toBe(0);
    expect(harness.updates).toHaveLength(0);
  });

  it("rejects a new passenger when the ride manifest is at capacity", async () => {
    harness.joinUid = "passenger_new";
    harness.sessionPassengers = Object.fromEntries(
      Array.from({ length: 1000 }, (_, index) => [
        `existing_${index}`,
        { userId: `existing_${index}`, joinedAt: 1 },
      ]),
    );

    const response = await join({ lat: 23, lng: 72.5, accuracy: 20 });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This ride is at capacity; no more passengers can join.",
    });
    expect(harness.updates).toHaveLength(0);
  });

  it("allows a new passenger to fill the last free manifest slot", async () => {
    harness.joinUid = "passenger_new";
    harness.sessionPassengers = Object.fromEntries(
      Array.from({ length: 999 }, (_, index) => [
        `existing_${index}`,
        { userId: `existing_${index}`, joinedAt: 1 },
      ]),
    );

    const response = await join({ lat: 23, lng: 72.5, accuracy: 20 });

    expect(response.status).toBe(200);
    expect(harness.updates).toHaveLength(1);
  });

  it("lets an existing member update their stops even when the ride is full", async () => {
    harness.joinUid = "passenger_full";
    harness.sessionPassengers = {
      passenger_full: { userId: "passenger_full", joinedAt: 1 },
      ...Object.fromEntries(
        Array.from({ length: 999 }, (_, index) => [
          `existing_${index}`,
          { userId: `existing_${index}`, joinedAt: 1 },
        ]),
      ),
    };

    const response = await join({});

    expect(response.status).toBe(200);
    expect(harness.updates).toHaveLength(1);
  });
});
