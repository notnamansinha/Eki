import express from "express";
import type { Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, expect, it } from "vitest";
import { clientRequestErrorHandler } from "./requestErrors";

let server: Server, url: string;
const unhandled: unknown[] = [];
beforeAll(async () => {
  const app = express();
  app.use("/devices/:deviceId/telemetry", express.json({ limit: "512b", strict: true }));
  app.use(express.json({ limit: "16kb", strict: true }));
  app.post("/devices/:deviceId/telemetry", (_req, res) => { res.json({ ok: true }); });
  app.post("/echo", (_req, res) => { res.json({ ok: true }); });
  app.get("/boom", () => { throw new Error("secret internal detail"); });
  app.use(clientRequestErrorHandler);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next;
    unhandled.push(error);
    res.status(500).json({ error: "Internal server error." });
  });
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("No listener");
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  fetch(url + path, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

it("keeps malformed and oversized JSON on their existing client errors", async () => {
  const malformed = await post("/echo", "{\"a\":");
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ error: "Invalid JSON body.", code: "INVALID_JSON_BODY" });
  const large = await post("/echo", JSON.stringify({ x: "a".repeat(17 * 1024) }));
  expect(large.status).toBe(413);
  expect(await large.json()).toEqual({ error: "Request body is too large.", code: "REQUEST_TOO_LARGE" });
});

it("rejects unsupported charsets and content encodings as 415 instead of 500", async () => {
  const charset = await post("/devices/bus-1/telemetry", "{}", { "content-type": "application/json; charset=x-evil" });
  expect(charset.status).toBe(415);
  expect(await charset.json()).toEqual({ error: "Unsupported request body encoding.", code: "UNSUPPORTED_ENCODING" });
  const encoding = await post("/echo", "{}", { "content-encoding": "evil" });
  expect(encoding.status).toBe(415);
  expect(await encoding.json()).toEqual({ error: "Unsupported request body encoding.", code: "UNSUPPORTED_ENCODING" });
  expect(unhandled).toEqual([]);
});

it("rejects corrupt compressed bodies and undecodable path parameters as 400", async () => {
  const corrupt = await post("/echo", "notgzip", { "content-encoding": "gzip" });
  expect(corrupt.status).toBe(400);
  expect(await corrupt.json()).toEqual({ error: "Invalid request.", code: "INVALID_REQUEST" });
  const badParam = await post("/devices/%E0%A4%A/telemetry", "{}");
  expect(badParam.status).toBe(400);
  expect(await badParam.json()).toEqual({ error: "Invalid request.", code: "INVALID_REQUEST" });
  const ok = await post("/echo", gzipSync(Buffer.from("{}")), { "content-encoding": "gzip" });
  expect(ok.status).toBe(200);
  expect(unhandled).toEqual([]);
});

it("leaves genuine server faults to the generic 500 handler without leaking details", async () => {
  const response = await fetch(url + "/boom");
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("secret internal detail");
  expect(unhandled).toHaveLength(1);
});
