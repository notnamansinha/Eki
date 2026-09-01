import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePolyline } from "../lib/polylineUtils";

const harness = vi.hoisted(() => ({
  user: { uid: "passenger_1", name: "Token Name" },
  routes: new Map<string, Record<string, unknown>>(),
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

vi.mock("../lib/firebaseAdmin", () => ({
  db: {
    collection: (collection: string) => ({
      doc: (id: string) => ({
        collection,
        id,
        get: async () => {
          const data = harness.routes.get(id);
          return { exists: Boolean(data), data: () => data };
        },
      }),
    }),
  },
}));

import planRouter from "./plan";

let server: Server;
let baseUrl = "";

const A = { id: "a", name: "Alpha", shortName: "A", lat: 23, lng: 72 };
const Z = { id: "z", name: "Zulu", shortName: "Z", lat: 23.01, lng: 72.01 };
const forwardPolyline = encodePolyline([A, Z]);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/plan", planRouter);
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
  harness.routes = new Map();
});

async function plan(
  routeId: string,
  startStopId: string,
  endStopId: string,
): Promise<{ status: number; direction?: string; polyline?: string }> {
  const response = await fetch(`${baseUrl}/api/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ routeId, startStopId, endStopId }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    direction?: string;
    polyline?: string;
  };
  return { status: response.status, ...body };
}

describe("POST /api/plan directional geometry", () => {
  it("plans both directions for a legacy route with no reversePolyline", async () => {
    harness.routes.set("legacy_route", {
      id: "legacy_route",
      name: "Legacy A-Z",
      color: "#000",
      stops: [A, Z],
      waypoints: [],
      polyline: forwardPolyline,
    });

    const forward = await plan("legacy_route", "a", "z");
    expect(forward.status).toBe(200);
    expect(forward.direction).toBe("forward");
    expect(forward.polyline).toBe(forwardPolyline);

    // No reversePolyline stored → reverse planning must fall back to the
    // reversed forward geometry (Z→A travel order) instead of returning 422
    // or silently returning the unreversed forward geometry.
    const reverse = await plan("legacy_route", "z", "a");
    expect(reverse.status).toBe(200);
    expect(reverse.direction).toBe("reverse");
    expect(reverse.polyline).toBe(encodePolyline([Z, A]));
  });

  it("prefers an independently routed reversePolyline when present", async () => {
    const reversePolyline = encodePolyline([Z, A]);
    harness.routes.set("directional_route", {
      id: "directional_route",
      name: "Directional A-Z",
      color: "#000",
      stops: [A, Z],
      waypoints: [],
      polyline: forwardPolyline,
      forwardPolyline,
      reversePolyline,
    });

    const reverse = await plan("directional_route", "z", "a");
    expect(reverse.status).toBe(200);
    expect(reverse.direction).toBe("reverse");
    expect(reverse.polyline).toBe(reversePolyline);
  });

  it("still rejects a route with no decodable geometry", async () => {
    harness.routes.set("empty_route", {
      id: "empty_route",
      name: "Empty",
      color: "#000",
      stops: [A, Z],
      waypoints: [],
    });

    const forward = await plan("empty_route", "a", "z");
    expect(forward.status).toBe(422);
  });
});