import { request as httpRequest, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientRequestErrorHandler } from "./requestErrors";
import { createRouteSaveBodyParser, ROUTE_SAVE_BODY_LIMIT_BYTES } from "./routeSaveBody";

let server: Server;
let base = "";

/** A save at every validated maximum: 100 stops, 128-char IDs, multi-byte names. */
function maximumRouteSave(nameChar = "क") {
  return {
    mode: "edit",
    name: nameChar.repeat(100),
    color: "#3B82F6",
    saveId: "s".repeat(128),
    expectedVersion: Number.MAX_SAFE_INTEGER,
    stops: Array.from({ length: 100 }, (_, index) => ({
      id: `${String(index).padStart(3, "0")}${"x".repeat(125)}`,
      name: nameChar.repeat(100),
      shortName: nameChar.repeat(32),
      lat: -23.123456789012345,
      lng: -172.12345678901234,
    })),
  };
}

beforeAll(async () => {
  // Same order as server.ts: route-save parser, then the general 16 KiB cap.
  const app = express();
  const parseRouteSaveBody = createRouteSaveBodyParser();
  app.use("/api/routes/:routeId", parseRouteSaveBody);
  app.use("/api/v2/routes/:routeId", parseRouteSaveBody);
  app.use(express.json({ limit: "16kb", strict: true }));
  const echo = (req: express.Request, res: express.Response) => {
    res.status(401).json({ stops: Array.isArray(req.body?.stops) ? req.body.stops.length : null });
  };
  app.put("/api/routes/:routeId", echo);
  app.put("/api/v2/routes/:routeId", echo);
  app.post("/api/routes/compute-polyline", echo);
  app.get("/api/v2/routes/:routeId/segments", echo);
  app.use(clientRequestErrorHandler);
  server = await new Promise<Server>(done => { const listener = app.listen(0, "127.0.0.1", () => done(listener)); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
});

/** Raw HTTP so GET can carry a body, as the global parser also reads GETs. */
function send(method: string, path: string, body: string): Promise<{ status: number; body: unknown }> {
  return new Promise((done, reject) => {
    const request = httpRequest(`${base}${path}`, {
      method, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => done({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

describe("route-save JSON body limit", () => {
  it("admits a save at every validated field maximum on both route-save paths", async () => {
    const body = JSON.stringify(maximumRouteSave());
    expect(Buffer.byteLength(body)).toBeGreaterThan(16 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(ROUTE_SAVE_BODY_LIMIT_BYTES);
    for (const path of ["/api/routes/route-1", "/api/v2/routes/route-1", "/api/routes/route-1/"]) {
      expect(await send("PUT", path, body), path).toEqual({ status: 401, body: { stops: 100 } });
    }
  });

  it("still rejects bodies above the route-save limit", async () => {
    const body = JSON.stringify({ ...maximumRouteSave(), padding: "p".repeat(ROUTE_SAVE_BODY_LIMIT_BYTES) });
    expect(await send("PUT", "/api/routes/route-1", body))
      .toEqual({ status: 413, body: { error: "Request body is too large." } });
  });

  it("keeps the general 16 KiB cap for every other route operation", async () => {
    const body = JSON.stringify({ padding: "p".repeat(20 * 1024) });
    expect((await send("POST", "/api/routes/compute-polyline", body)).status).toBe(413);
    expect((await send("GET", "/api/v2/routes/route-1/segments", body)).status).toBe(413);
  });

  it("is mounted on both route-save paths before the general parser in server.ts", () => {
    const source = readFileSync(resolve(__dirname, "../server.ts"), "utf8");
    const general = source.indexOf('app.use(express.json({ limit: "16kb", strict: true }))');
    for (const mount of ['app.use("/api/routes/:routeId", parseRouteSaveBody)', 'app.use("/api/v2/routes/:routeId", parseRouteSaveBody)']) {
      expect(source.indexOf(mount), mount).toBeGreaterThan(0);
      expect(source.indexOf(mount), mount).toBeLessThan(general);
    }
  });
});
