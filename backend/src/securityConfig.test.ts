import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceFile = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

const ruleBlock = (rules: string, matchPath: string) => {
  const start = rules.indexOf(matchPath);
  if (start < 0) return "";

  let depth = 0;
  let opened = false;
  for (let index = start + matchPath.length; index < rules.length; index += 1) {
    if (rules[index] === "{") {
      depth += 1;
      opened = true;
    } else if (rules[index] === "}" && opened && --depth === 0) {
      return rules.slice(start, index + 1);
    }
  }
  return "";
};

describe("production security configuration", () => {
  it("keeps realtime bus writes bound to authenticated assignments", () => {
    const database = JSON.parse(workspaceFile("database.rules.json"));
    const activeBus = database.rules.activeBuses.$busKey;

    expect(activeBus[".write"]).toContain("auth.token.assignedBusId");
    expect(activeBus[".write"]).toContain("auth.token.driverId");
    expect(activeBus[".write"]).toContain("auth.token.deviceId");
    expect(activeBus[".write"]).toContain("auth.token.routeId");
    expect(database.rules.messages.sessions.$sessionId.$msgId[".write"]).toBe("false");
    expect(database.rules.messages.$busId.$msgId[".write"]).toBe("false");
  });

  it("keeps sensitive Firestore collections and chat identity protected", () => {
    const rules = workspaceFile("firestore.rules");
    const devices = ruleBlock(rules, "match /devices/{deviceId}");
    const messages = ruleBlock(rules, "match /messages/{messageId}");

    expect(devices).toContain("allow read, write: if false;");
    expect(messages).toContain("request.resource.data.senderId == request.auth.uid");
    expect(messages).toContain("request.resource.data.from == 'passenger'");
    expect(messages).toContain("request.resource.data.from == 'driver'");
  });

  it("requires verified HTTPS for hardware credentials", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");
    const tokenRequest = firmware.slice(
      firmware.indexOf("bool fetchCustomToken()"),
      firmware.indexOf("bool waitForNtpSync"),
    );

    expect(tokenRequest).toContain('url.startsWith("https://")');
    expect(tokenRequest).toContain("clientSecure.setCACert(BACKEND_ROOT_CA)");
    expect(tokenRequest).not.toContain("setInsecure(");
  });

  it("ships exact browser security headers", () => {
    const firebase = JSON.parse(workspaceFile("firebase.json"));
    const defaultHeaders = firebase.hosting.headers.find(
      (entry: { source: string }) => entry.source === "**",
    ).headers as Array<{ key: string; value: string }>;
    const headers = new Map(defaultHeaders.map(({ key, value }) => [key, value]));

    expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(headers.get("Strict-Transport-Security")).toMatch(/^max-age=\d+/);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
