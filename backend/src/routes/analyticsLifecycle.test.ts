import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [
  { status: "active", tripState: "pre_departure" },
  { status: "active", tripState: "in_service" },
  { status: "offline", tripState: "in_service" },
] }));
vi.mock("../lib/firebaseAdmin", () => {
  function query(rows: Record<string, unknown>[]): any {
    return { where: (field: unknown, _operator?: unknown, value?: unknown) =>
      query(typeof field === "string" ? rows.filter(row => row[field] === value) : rows),
    select: () => query(rows), limit: () => query(rows), count: () => ({ rows }),
    get: async () => ({ size: rows.length, docs: rows.map(row => ({ data: () => row })),
      forEach: (visit: (doc: unknown) => void) => rows.forEach(row => visit({ data: () => row })) }) };
  }
  return { db: { collection: (name: string) => query(name === "bus_locations" ? state.rows : []),
    runTransaction: (work: (tx: any) => unknown) => work({ get: async (value: any) => ({ data: () => ({ count: value.rows.length }) }) }) } };
});
vi.mock("../middleware/requireAdmin", () => ({ requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next() }));
import router, { analyticsCache } from "./analytics";
let server: Server;
afterEach(async () => { if (server) await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); });
describe("armed journey analytics", () => {
  it.each(["", "?scope=all"])("counts ongoing passenger service separately from armed fleet availability: %s", async scope => {
    analyticsCache.invalidate();
    const app = express(); app.use("/analytics", router);
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(done => server.once("listening", done));
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/analytics/fleet${scope}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ activeBuses: 2, ongoingTrips: 1 });
  });
});
