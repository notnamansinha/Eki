import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { apiCompatibilityStatus, createApiCompatibilityTraffic } from "./apiCompatibilityTraffic";
import type { Request, Response } from "express";
describe("bounded compatibility traffic inventory", () => {
  it.each([
    ["PUT", "/api/routes/private-route", "route-save:legacy"],
    ["GET", "/api/routes/private-route/save-operations/private-save", "route-save-status:legacy"],
    ["PUT", "/api/v2/routes/private-route", "route-save:v2"],
    ["POST", "/api/sessions/private-session/join", "boarding:legacy"],
    ["PUT", "/api/v2/ride-sessions/private-session/passengers/me", "boarding:v2"],
    ["POST", "/api/v2/ride-sessions/private-session/messages", "chat:v2"],
    ["PATCH", "/api/v2/settings/global", "settings:v2"],
  ])("classifies %s %s without retaining resource identifiers", (method, path, key) => {
    const before = apiCompatibilityStatus()[key]?.requests ?? 0;
    const response = Object.assign(new EventEmitter(), { statusCode: 200 });
    let next = false;
    createApiCompatibilityTraffic()({ method, path } as Request, response as unknown as Response, () => { next = true; });
    expect(next).toBe(true); response.emit("finish");
    expect(apiCompatibilityStatus()[key].requests).toBe(before + 1);
    expect(JSON.stringify(apiCompatibilityStatus())).not.toContain("private-");
  });
  it("does not create labels for unknown routes and separates failures from successful calls", () => {
    const response = Object.assign(new EventEmitter(), { statusCode: 403 });
    createApiCompatibilityTraffic()({ method: "POST", path: "/api/unknown/private-resource" } as Request, response as unknown as Response, () => {});
    expect(response.listenerCount("finish")).toBe(0);
    const before = apiCompatibilityStatus()["chat:legacy"]?.successful ?? 0;
    createApiCompatibilityTraffic()({ method: "POST", path: "/api/sessions/private-session/messages" } as Request, response as unknown as Response, () => {});
    response.emit("finish"); expect(apiCompatibilityStatus()["chat:legacy"].successful).toBe(before);
  });
});
