import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  liveNode: {} as Record<string, unknown>,
  lock: null as Record<string, unknown> | null,
  docSets: [] as { id: string; data: Record<string, unknown> }[],
  batchSets: [] as { id: string; data: Record<string, unknown> }[],
  rtdbUpdates: [] as Record<string, unknown>[],
  activeRide: null as Record<string, unknown> | null,
  eventLog: [] as string[],
  afterRtdbTransaction: null as (() => void) | null,
  failActiveRidesWrite: false,
  user: {
    uid: "driver_uid",
    role: "driver",
    driverId: "driver_1",
    assignedBusId: "bus_1",
  } as Record<string, unknown>,
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

vi.mock("../lib/firebaseAdmin", () => {
  const snapshot = (exists: boolean, data?: Record<string, unknown>) => ({
    exists,
    data: () => data,
  });
  const document = (collectionName: string, id?: string) => ({
    collectionName,
    id: id ?? "new_session_1",
    get: async () => {
      if (collectionName === "drivers") {
        return snapshot(true, { authUid: "driver_uid", assignedBusId: "bus_1" });
      }
      if (collectionName === "buses") {
        return snapshot(true, { assignedRoutes: ["route_1"] });
      }
      if (collectionName === "routes") {
        return snapshot(true, {
          stops: [
            { id: "stop_1", name: "Stop 1", lat: 23.0, lng: 72.5 },
            { id: "stop_2", name: "Stop 2", lat: 23.2, lng: 72.7 },
          ],
        });
      }
      if (collectionName === "_active_bus_locks") {
        return snapshot(harness.lock !== null, harness.lock ?? undefined);
      }
      if (collectionName === "ride_sessions" && id) {
        return snapshot(true, { status: "active" });
      }
      if (collectionName === "active_rides") {
        return snapshot(harness.activeRide !== null, harness.activeRide ?? undefined);
      }
      return snapshot(false);
    },
    set: async (data: unknown) => {
      if (collectionName === "active_rides" && harness.failActiveRidesWrite) {
        throw new Error("simulated Firestore failure");
      }
      harness.docSets.push({
        id: id ?? "new_session_1",
        data: data as Record<string, unknown>,
      });
    },
  });

  return {
    db: {
      collection: (collectionName: string) => ({
        doc: (id?: string) => document(collectionName, id),
      }),
      runTransaction: async (
        callback: (transaction: {
          get: (ref: unknown) => Promise<ReturnType<typeof snapshot>>;
          set: (ref: unknown, data: unknown) => void;
          create: (ref: { id: string }, data: unknown) => void;
          delete: (ref: unknown) => void;
        }) => Promise<unknown>,
      ) => {
        return callback({
          get: async (ref) => {
            const typedRef = ref as { collectionName?: string };
            if (typedRef.collectionName === "active_rides") {
              return snapshot(
                harness.activeRide !== null,
                harness.activeRide ?? undefined,
              );
            }
            return snapshot(harness.lock !== null, harness.lock ?? undefined);
          },
          set: (ref, data) => {
            const typedRef = ref as { collectionName?: string; id?: string };
            if (typedRef.collectionName === "active_rides") {
              if (harness.failActiveRidesWrite) {
                throw new Error("simulated Firestore failure");
              }
              harness.activeRide = {
                ...(harness.activeRide ?? {}),
                ...(data as Record<string, unknown>),
              };
              harness.eventLog.push("firestore");
            }
            harness.docSets.push({
              id: typedRef.id ?? "lock",
              data: data as Record<string, unknown>,
            });
          },
          create: async (ref, data) => {
            harness.docSets.push({
              id: ref.id,
              data: data as Record<string, unknown>,
            });
          },
          delete: async () => {
            harness.lock = null;
          },
        });
      },
      batch: () => ({
        set: (ref: { id: string }, data: unknown) => {
          harness.batchSets.push({
            id: ref.id,
            data: data as Record<string, unknown>,
          });
        },
        commit: async () => {},
      }),
    },
    rtdb: {
      ref: () => ({
        once: async () => ({ val: () => harness.liveNode }),
        update: async (data: Record<string, unknown>) => {
          harness.rtdbUpdates.push(data);
        },
        transaction: async (callback: (value: unknown) => unknown) => {
          const result = callback(harness.liveNode);
          if (result === undefined) {
            return {
              committed: false,
              snapshot: { val: () => harness.liveNode },
            };
          }
          harness.liveNode = result as Record<string, unknown>;
          harness.eventLog.push("rtdb");
          harness.afterRtdbTransaction?.();
          return {
            committed: true,
            snapshot: { val: () => harness.liveNode },
          };
        },
      }),
    },
  };
});

import shiftsRouter from "./shifts";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/shifts", shiftsRouter);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  harness.docSets = [];
  harness.batchSets = [];
  harness.rtdbUpdates = [];
  harness.activeRide = null;
  harness.eventLog = [];
  harness.afterRtdbTransaction = null;
  harness.lock = null;
  harness.failActiveRidesWrite = false;
  harness.user = {
    uid: "driver_uid",
    role: "driver",
    driverId: "driver_1",
    assignedBusId: "bus_1",
  };
});

async function startShift(
  driverId?: string,
  extra: Record<string, unknown> = {},
) {
  return fetch(`${baseUrl}/api/shifts/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ busId: "bus_1", routeId: "route_1", driverId, ...extra }),
  });
}

describe("shift delay updates", () => {
  beforeEach(() => {
    harness.liveNode = {
      busId: "bus_1",
      driverId: "driver_1",
      routeId: "route_1",
      status: "active",
      tripState: "in_service",
      sessionId: "session_live",
      delayMinutes: 5,
      delayUpdatedAt: 100,
    };
    harness.activeRide = {
      busId: "bus_1",
      driverId: "driver_1",
      routeId: "route_1",
      status: "active",
      tripState: "in_service",
      sessionId: "session_live",
      delayMinutes: 5,
      delayUpdatedAt: 100,
    };
  });

  async function setDelay(delayMinutes: number, driverId?: string) {
    return fetch(`${baseUrl}/api/shifts/delay`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ busId: "bus_1", routeId: "route_1", delayMinutes, driverId }),
    });
  }

  it("publishes the delay to RTDB first and mirrors it with a timestamp", async () => {
    const response = await setDelay(15);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(true);
    expect(body.delayMinutes).toBe(15);
    expect(body.durable).toBe(true);

    expect(harness.liveNode.delayMinutes).toBe(15);
    expect(typeof harness.liveNode.delayUpdatedAt).toBe("number");
    expect(harness.eventLog).toEqual(["rtdb", "firestore"]);

    const durable = harness.docSets.find((entry) => entry.id === "bus_1_route_1");
    expect(durable?.data.delayMinutes).toBe(15);
    expect(typeof durable?.data.delayUpdatedAt).toBe("number");
  });

  it("lets an administrator update the assigned operator's ride", async () => {
    harness.user = { uid: "admin_uid", role: "admin", admin: true };
    const response = await setDelay(8, "driver_1");
    expect(response.status).toBe(200);
    expect(harness.liveNode.delayMinutes).toBe(8);
  });

  it("keeps the live delay when the durable write fails", async () => {
    harness.failActiveRidesWrite = true;
    const response = await setDelay(15);
    // The passenger-facing RTDB value is the source of truth: a Firestore
    // hiccup must not turn the driver's delay update into a 500.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(true);
    expect(body.durable).toBe(false);
    expect(harness.liveNode.delayMinutes).toBe(15);
    expect(harness.docSets.find((entry) => entry.id === "bus_1_route_1")).toBeUndefined();
  });

  it("does not mirror a delay into a replacement session", async () => {
    harness.afterRtdbTransaction = () => {
      harness.activeRide = {
        ...harness.activeRide,
        sessionId: "session_replacement",
        delayMinutes: 0,
        delayUpdatedAt: 0,
      };
    };
    const response = await setDelay(15);
    expect(response.status).toBe(200);
    expect((await response.json()).durable).toBe(false);
    expect(harness.activeRide?.sessionId).toBe("session_replacement");
    expect(harness.activeRide?.delayMinutes).toBe(0);
  });

  it("advances the live revision monotonically across clock skew", async () => {
    const futureRevision = Date.now() + 60_000;
    harness.liveNode.delayUpdatedAt = futureRevision;
    harness.activeRide!.delayUpdatedAt = futureRevision;
    const response = await setDelay(20);
    expect(response.status).toBe(200);
    expect(harness.liveNode.delayUpdatedAt).toBe(futureRevision + 1);
    expect(harness.activeRide?.delayUpdatedAt).toBe(futureRevision + 1);
  });

  it("rejects a delay with no active shift", async () => {
    harness.liveNode = { status: "offline", sessionId: "session_live" };
    const response = await setDelay(15);
    expect(response.status).toBe(409);
  });

  it("rejects a delay after the shift has reached its terminal state", async () => {
    harness.liveNode.tripState = "completed";
    const response = await setDelay(15);
    expect(response.status).toBe(409);
    expect(harness.eventLog).toEqual([]);
    expect(harness.liveNode.delayMinutes).toBe(5);
  });

  it("rejects fractional delay values before touching either store", async () => {
    const response = await setDelay(1.5);
    expect(response.status).toBe(400);
    expect(harness.eventLog).toEqual([]);
    expect(harness.liveNode.delayMinutes).toBe(5);
  });
});

describe("shift start after automatic completion", () => {
  it("lets an administrator arm a ride for an assigned operator", async () => {
    harness.user = { uid: "admin_uid", role: "admin", admin: true };
    harness.liveNode = {
      busId: "bus_1",
      lat: 23.0,
      lng: 72.5,
      timestamp: Date.now(),
      motionState: "stopped",
    };

    const response = await startShift("driver_1");
    expect(response.status).toBe(201);
    expect(harness.liveNode.driverId).toBe("driver_1");
  });

  it("starts a fresh session instead of resurrecting the completed ride", async () => {
    // Live node left by the engine right after completion: status is still
    // "active" with the old sessionId and terminal tripState "completed",
    // while the 30s cleanup has not run yet (lock already released).
    harness.liveNode = {
      busId: "bus_1",
      driverId: "driver_1",
      routeId: "route_1",
      status: "active",
      tripState: "completed",
      sessionId: "session_completed",
      currentStopIndex: 3,
      hasDepartedOrigin: true,
      delayMinutes: 12,
      delayUpdatedAt: 9_000,
      lat: 23.2,
      lng: 72.7,
      timestamp: Date.now(),
      motionState: "stopped",
    };
    harness.lock = null;

    const response = await startShift();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.resumed).toBe(false);
    expect(body.sessionId).toBe("new_session_1");

    // Z is the inferred origin for the reverse return ride.
    expect(harness.liveNode.tripState).toBe("in_service");
    expect(harness.liveNode.sessionId).toBe("new_session_1");
    expect(harness.liveNode.currentStopIndex).toBe(0);
    expect(harness.liveNode.hasDepartedOrigin).toBe(false);
    expect(harness.liveNode.delayMinutes).toBe(0);
    expect(harness.liveNode.delayUpdatedAt).toBe(0);

    // The new ride session is armed; the completed session was NOT revived.
    const sessionSet = harness.batchSets.find((entry) => entry.id === "new_session_1");
    expect(sessionSet?.data.status).toBe("active");
    expect(sessionSet?.data.direction).toBe("reverse");
    const activeRideSet = harness.batchSets.find((entry) => entry.id === "bus_1_route_1");
    expect(activeRideSet?.data.delayMinutes).toBe(0);
    expect(activeRideSet?.data.delayUpdatedAt).toBe(0);
    expect(harness.docSets.map((entry) => entry.id)).not.toContain("session_completed");
    expect(harness.batchSets.map((entry) => entry.id)).not.toContain("session_completed");
  });

  it("infers a reverse ride from the route terminus with immutable direction metadata", async () => {
    harness.liveNode = {
      busId: "bus_1",
      lat: 23.2,
      lng: 72.7,
      timestamp: Date.now(),
      motionState: "stopped",
    };

    const response = await startShift();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ direction: "reverse", resumed: false });
    expect(harness.liveNode).toMatchObject({
      direction: "reverse",
      originStopId: "stop_2",
      destinationStopId: "stop_1",
      tripState: "in_service",
      currentStopIndex: 0,
    });
    const sessionSet = harness.batchSets.find((entry) => entry.id === "new_session_1");
    expect(sessionSet?.data).toMatchObject({
      direction: "reverse",
      originStopId: "stop_2",
      destinationStopId: "stop_1",
    });
  });

  it("infers a forward ride from the first endpoint", async () => {
    harness.liveNode = {
      busId: "bus_1",
      lat: 23.0,
      lng: 72.5,
      timestamp: Date.now(),
      motionState: "stopped",
    };

    const response = await startShift(undefined, { direction: "reverse" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ direction: "forward" });
    expect(harness.liveNode).toMatchObject({
      direction: "forward",
      originStopId: "stop_1",
      destinationStopId: "stop_2",
    });
  });

  it("does not guess direction between endpoints or while the bus is moving", async () => {
    harness.liveNode = {
      busId: "bus_1",
      lat: 23.1,
      lng: 72.6,
      timestamp: Date.now(),
      motionState: "stopped",
    };
    expect((await startShift()).status).toBe(409);

    harness.liveNode = {
      busId: "bus_1",
      lat: 23.0,
      lng: 72.5,
      timestamp: Date.now(),
      motionState: "moving",
    };
    expect((await startShift()).status).toBe(409);
    expect(harness.docSets).toEqual([]);
    expect(harness.batchSets).toEqual([]);
  });

  it("still resumes an in-service shift (regression guard)", async () => {
    harness.liveNode = {
      busId: "bus_1",
      driverId: "driver_1",
      routeId: "route_1",
      status: "active",
      tripState: "in_service",
      sessionId: "session_live",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
      delayMinutes: 0,
      lat: 23.0,
      lng: 72.5,
      timestamp: Date.now(),
      motionState: "moving",
    };
    harness.lock = {
      busId: "bus_1",
      routeId: "route_1",
      driverId: "driver_1",
      sessionId: "session_live",
    };

    const response = await startShift();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resumed).toBe(true);
    expect(body.sessionId).toBe("session_live");
  });

  it("refuses to touch an active shift owned by another driver", async () => {
    // An in-service node owned by a different driver must not be resumed or
    // claimed: the resume branch requires the same driver, and the claim
    // refuses to replace an active, non-completed session.
    harness.liveNode = {
      busId: "bus_1",
      driverId: "driver_other",
      routeId: "route_1",
      status: "active",
      tripState: "in_service",
      sessionId: "session_live",
      currentStopIndex: 1,
      hasDepartedOrigin: true,
      delayMinutes: 0,
      lat: 23.0,
      lng: 72.5,
      timestamp: Date.now(),
      motionState: "moving",
    };
    harness.lock = {
      busId: "bus_1",
      routeId: "route_1",
      driverId: "driver_other",
      sessionId: "session_live",
    };

    const response = await startShift();
    expect(response.status).toBe(409);
    expect(harness.liveNode.sessionId).toBe("session_live");
    expect(harness.liveNode.tripState).toBe("in_service");
  });
});
