import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceFile = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("production security configuration", () => {
  it("keeps realtime bus writes bound to authenticated assignments", () => {
    const rules = workspaceFile("database.rules.json");

    expect(rules).toContain("auth.token.assignedBusId");
    expect(rules).toContain("auth.token.deviceId");
    expect(rules).toContain("auth.token.routeId");
    expect(rules).toContain('"messages"');
    expect(rules).toContain('".write": "false"');
  });

  it("keeps sensitive Firestore collections and chat identity protected", () => {
    const rules = workspaceFile("firestore.rules");

    expect(rules).toContain("match /devices/{deviceId}");
    expect(rules).toContain("allow read, write: if false");
    expect(rules).toContain("request.resource.data.senderId == request.auth.uid");
    expect(rules).toContain("request.resource.data.from == 'passenger'");
    expect(rules).toContain("request.resource.data.from == 'driver'");
  });

  it("requires verified HTTPS for hardware credentials", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");

    expect(firmware).toContain('url.startsWith("https://")');
    expect(firmware).toContain("setCACert(BACKEND_ROOT_CA)");
    expect(firmware).not.toContain("setInsecure(");
  });

  it("ships browser security headers", () => {
    const firebase = workspaceFile("firebase.json");

    expect(firebase).toContain("Content-Security-Policy");
    expect(firebase).toContain("Strict-Transport-Security");
    expect(firebase).toContain("X-Content-Type-Options");
    expect(firebase).toContain("Referrer-Policy");
  });
});
