import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { contractFetch } from "../../test-support/openapi";

const state = vi.hoisted(() => ({
  principal: null as Record<string, unknown> | null,
  session: null as Record<string, unknown> | null,
  error: false,
  reads: 0,
}));
vi.mock("../middleware/requireAuth", () => ({ requireAuth: (req: any, res: any, next: () => void) => {
  if (!state.principal) { res.status(401).json({ error: "Authentication required." }); return; }
  req.user = state.principal; next();
} }));
vi.mock("../lib/firebaseAdmin", () => ({
  db: { collection: (name: string) => ({ doc: (id: string) => ({ get: async () => {
    expect(name).toBe("ride_sessions"); expect(id).toBe("session_1"); state.reads++;
    if (state.error) throw Error("provider document includes private boarding secret");
    return { exists: state.session !== null, data: () => state.session };
  } }) }) },
  rtdb: {},
}));
import router from "./sessions";
let server: Server, origin: string;
beforeAll(async () => {
  const app = express(); app.use("/api/sessions", router);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("Loopback server unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  state.principal = { uid: "passenger_1", role: "passenger" };
  state.session = { busId: "bus_1", routeId: "route_1", driverId: "driver_1", status: "completed", boardingCode: "PRIVATE", passengers: { passenger_1: { userId: "passenger_1", userName: "Private passenger", originStopId: "private-stop" } }, internal: "PRIVATE" };
  state.error = false; state.reads = 0;
});
const request = () => contractFetch(`${origin}/api/sessions/session_1/status`);

describe("joined ride status authorization and closed HTTP response", () => {
  it("requires authentication before reading a durable ride", async () => {
    state.principal = null; const response = await request(); expect(response.status).toBe(401); expect(state.reads).toBe(0);
  });
  it("returns only immutable ride identity and terminal status with no shared cache", async () => {
    const response = await request(); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ sessionId: "session_1", busId: "bus_1", routeId: "route_1", status: "completed" });
    expect(state.reads).toBe(1);
  });
  it("does not distinguish a missing ride from another passenger's existing ride", async () => {
    state.principal = { uid: "outsider", role: "passenger" }; const other = await request();
    state.session = null; const missing = await request();
    expect(other.status).toBe(403); expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual(await other.json());
  });
  it.each([null, {}, { userId: "another-user" }, "malformed"]) ("rejects a malformed or mismatched manifest membership %j", async entry => {
    state.session!.passengers = { passenger_1: entry };
    expect((await request()).status).toBe(403);
  });
  it("rejects inherited membership and a passengerIds-only claim", async () => {
    state.session!.passengers = Object.create({ passenger_1: { userId: "passenger_1" } });
    state.session!.passengerIds = ["passenger_1"];
    expect((await request()).status).toBe(403);
  });
  it("denies a passenger removed from the current manifest even when passengerIds still lists them", async () => {
    state.session!.passengers = {}; state.session!.passengerIds = ["passenger_1"];
    expect((await request()).status).toBe(403);
  });
  it.each([
    { uid: "admin", role: "admin", admin: true },
    { uid: "admin", role: "passenger", admin: true },
    { uid: "driver", role: "driver", driverId: "driver_1", assignedBusId: "bus_1" },
  ])("allows an authorized privileged principal %j", async principal => {
    state.principal = principal; expect((await request()).status).toBe(200);
  });
  it.each([
    { uid: "driver", role: "driver", driverId: "wrong", assignedBusId: "bus_1" },
    { uid: "driver", role: "driver", driverId: "driver_1", assignedBusId: "wrong" },
    { uid: "passenger_1", role: "driver" },
    { uid: "passenger_1", role: "device" },
    { uid: "admin", role: "admin" },
    { uid: "admin", role: "admin", admin: false },
    { uid: "admin", role: "passenger", admin: "true" },
  ])("rejects an unauthorized privileged or device principal %j", async principal => {
    state.principal = principal; expect((await request()).status).toBe(403);
  });
  it.each(["pending", "armed", "active", "completed", "interrupted", "failed"]) ("returns the documented durable status %s", async status => {
    state.session!.status = status; const response = await request(); expect(response.status).toBe(200); expect((await response.json()).status).toBe(status);
  });
  it.each(["unknown", ["completed"], null, 123, true, {}])("fails closed on malformed durable status %j", async status => {
    state.session!.status = status; expect((await request()).status).toBe(503);
  });
  it.each(["bad/path", "bad.id", " ", "x".repeat(129)])("rejects an invalid session ID %j before a document read", async id => {
    const response = await contractFetch(`${origin}/api/sessions/${encodeURIComponent(id)}/status`);
    expect(response.status).toBe(400); expect(state.reads).toBe(0);
  });
  it.each(["a", "B_-1", "x".repeat(128)])("accepts an allowlisted durable identity of length %j", async id => {
    state.session!.busId = id; state.session!.routeId = id;
    const response = await request(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: "session_1", busId: id, routeId: id, status: "completed" });
  });
  it.each([null, {}, "bad/path", " ", "x".repeat(129)])("rejects a malformed durable identity %j", async id => {
    state.session!.busId = id; expect((await request()).status).toBe(503);
  });
  it("fails closed on an invalid durable identity or provider outage without printing source data", async () => {
    state.session!.routeId = "bad/path"; expect((await request()).status).toBe(503);
    state.error = true; const unavailable = await request(); expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private");
  });
});
