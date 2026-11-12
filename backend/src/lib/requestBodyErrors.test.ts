import type { Server } from "node:http";
import { gzipSync } from "node:zlib";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientRequestErrorHandler } from "./requestErrors";

let server: Server;
let url = "";
let unhandled = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "512b", strict: true }));
  app.post("/body", (req, res) => { res.json({ body: req.body ?? null }); });
  app.use(clientRequestErrorHandler);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next;
    unhandled += 1;
    res.status(500).json({ error: "Internal server error." });
  });
  server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  url = `http://127.0.0.1:${address.port}/body`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function post(headers: Record<string, string>, body: string | Buffer) {
  const response = await fetch(url, { method: "POST", headers, body });
  return { status: response.status, body: await response.json() };
}

describe("request body parser errors", () => {
  it("keeps the documented 413 and 400 responses", async () => {
    expect(await post({ "content-type": "application/json" }, `{"a":"${"x".repeat(600)}"}`))
      .toEqual({ status: 413, body: { error: "Request body is too large.", code: "REQUEST_TOO_LARGE" } });
    expect(await post({ "content-type": "application/json" }, "{not json"))
      .toEqual({ status: 400, body: { error: "Invalid JSON body.", code: "INVALID_JSON_BODY" } });
  });

  it("rejects undecodable bodies as client errors instead of internal failures", async () => {
    const before = unhandled;
    for (const headers of [
      { "content-type": "application/json", "content-encoding": "x-unknown" },
      { "content-type": "application/json; charset=x-unknown" },
    ]) {
      expect(await post(headers, "{}")).toEqual({ status: 415, body: { error: "Unsupported request body encoding.", code: "UNSUPPORTED_ENCODING" } });
    }
    for (const headers of [
      { "content-type": "application/json", "content-encoding": "gzip" },
      { "content-type": "application/json", "content-encoding": "deflate" },
    ]) {
      expect(await post(headers, "{}")).toEqual({ status: 400, body: { error: "Invalid request.", code: "INVALID_REQUEST" } });
    }
    expect(unhandled).toBe(before);
  });

  it("still decodes a valid compressed body and bounds its inflated size", async () => {
    const headers = { "content-type": "application/json", "content-encoding": "gzip" };
    expect(await post(headers, gzipSync('{"ok":true}'))).toEqual({ status: 200, body: { body: { ok: true } } });
    expect((await post(headers, gzipSync(`{"a":"${"x".repeat(100_000)}"}`))).status).toBe(413);
  });
});
