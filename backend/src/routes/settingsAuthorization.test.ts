import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  admin: false,
  writes: 0,
}));

vi.mock("../middleware/verifiedRequest", () => ({
  verifyRequestToken: async () => ({ uid: "user_1", admin: harness.admin }),
}));
vi.mock("../lib/firebaseAdmin", () => ({
  db: { collection: () => ({ doc: () => ({
    set: async () => { harness.writes++; },
  }) }) },
}));

import settingsRouter, { settingsV2Router } from "./settings";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/settings", settingsRouter);
  app.use("/api/v2/settings/global", settingsV2Router);
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
beforeEach(() => { harness.admin = false; harness.writes = 0; });

describe("settings route authorization", () => {
  for (const [path, method] of [
    ["/api/settings", "PUT"],
    ["/api/v2/settings/global", "PATCH"],
  ] as const) {
    it(`${method} ${path} enforces the real admin middleware`, async () => {
      const request = (authorization?: string) => fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify({ announcementActive: true }),
      });
      expect((await request()).status).toBe(401);
      expect((await request("Bearer passenger-token")).status).toBe(403);
      expect(harness.writes).toBe(0);
      harness.admin = true;
      expect((await request("Bearer admin-token")).status).toBe(200);
      expect(harness.writes).toBe(1);
    });
  }
});
