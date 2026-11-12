import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const span = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("../instrumentation", () => ({ recordActiveSpanException: span.record }));
import { clientRequestErrorHandler, unhandledRequestErrorHandler } from "./requestErrors";

const servers: Server[] = [];
afterEach(async () => {
  span.record.mockReset();
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve()); server.closeAllConnections();
  })));
});

async function boot(extra?: (app: express.Express) => void) {
  const app = express();
  app.use(express.json({ limit: "16kb", strict: true }));
  app.post("/api/echo", (req, res) => { res.json({ received: req.body !== undefined }); });
  app.get("/api/items/:id", (req, res) => { res.json({ id: req.params.id }); });
  extra?.(app);
  app.use(clientRequestErrorHandler);
  app.use(unhandledRequestErrorHandler);
  const server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("request error handlers", () => {
  it("keeps the existing JSON parse and size responses", async () => {
    const url = await boot();
    const invalid = await fetch(`${url}/api/echo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid JSON body.", code: "INVALID_JSON_BODY" });
    const large = await fetch(`${url}/api/echo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: "x".repeat(20_000) }) });
    expect(large.status).toBe(413);
  });

  it.each([
    ["an unsupported content encoding", { "Content-Encoding": "x-unknown" }, "{}", 415],
    ["a corrupt gzip body", { "Content-Encoding": "gzip" }, "not-gzip", 400],
  ])("answers %s as a client error without logging a server failure", async (_label, headers, body, status) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const url = await boot();
    const response = await fetch(`${url}/api/echo`, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
    });
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).not.toMatch(/stack|at |incorrect header|x-unknown/i);
    expect(errors).not.toHaveBeenCalled();
    expect(span.record).not.toHaveBeenCalled();
  });

  it("rejects an undecodable path parameter as 400 without echoing it", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const url = await boot();
    const response = await fetch(`${url}/api/items/%E0%A4%A`);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("%E0");
    expect(errors).not.toHaveBeenCalled();
  });

  it("keeps upstream failures that carry an HTTP status as opaque 500s", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const url = await boot(app => app.get("/api/upstream", () => {
      throw Object.assign(new Error("Maps quota secret detail"), { status: 403 });
    }));
    const response = await fetch(`${url}/api/upstream`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error.", code: "INTERNAL_ERROR" });
    expect(errors).toHaveBeenCalledOnce();
    expect(span.record).toHaveBeenCalledOnce();
  });
});
