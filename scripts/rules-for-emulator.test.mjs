import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { stripRulesText } from "./rules-for-emulator.mjs";

describe("stripRulesText (App Check removal for emulator tests)", () => {
  it("removes every isAppChecked() gate from Firestore rules", () => {
    const input = [
      "function isOwner(uid) {",
      "  return isAuthenticated() && request.auth.uid == uid;",
      "}",
      "",
      "    // App Check (issue #39): enforcement note",
      "    function isAppChecked() {",
      "      return request.app != null;",
      "    }",
      "",
      "match /users/{uid} {",
      "  allow read: if isOwner(uid) && isAppChecked();",
      "  allow create: if false;",
      "}",
      "match /routes/{routeId} {",
      "  allow read: if isAuthenticated() && isAppChecked();",
      "}",
    ].join("\n");

    const { firestore } = stripRulesText(input, "{}");

    assert.ok(!firestore.includes("isAppChecked"));
    assert.ok(!firestore.includes("request.app"));
    assert.ok(!firestore.includes("App Check (issue #39)"));
    assert.ok(firestore.includes("allow read: if isOwner(uid);"));
    assert.ok(firestore.includes("allow read: if isAuthenticated();"));
    assert.ok(firestore.includes("allow create: if false;"));
  });

  it("handles CRLF line endings (the committed rules use \\r\\n)", () => {
    const input =
      "function isOwner(uid) {\r\n" +
      "  return isAuthenticated() && request.auth.uid == uid;\r\n" +
      "}\r\n" +
      "\r\n" +
      "    // App Check (issue #39): enforcement note\r\n" +
      "    function isAppChecked() {\r\n" +
      "      return request.app != null;\r\n" +
      "    }\r\n" +
      "\r\n" +
      "match /users/{uid} {\r\n" +
      "  allow read: if isOwner(uid) && isAppChecked();\r\n" +
      "}\r\n";

    const { firestore } = stripRulesText(input, "{}");
    assert.ok(!firestore.includes("isAppChecked"));
    assert.ok(firestore.includes("allow read: if isOwner(uid);"));
  });

  it("removes request.app from Realtime Database rules", () => {
    const database = JSON.stringify(
      {
        rules: {
          ".read": false,
          ".write": false,
          activeBuses: {
            ".read": "auth != null && request.app != null",
            ".write": false,
          },
        },
      },
      null,
      2,
    );

    const { database: stripped } = stripRulesText("{}", database);
    assert.ok(!stripped.includes("request.app"));
    assert.ok(stripped.includes('".read": "auth != null"'));
  });

  it("fails loudly when an isAppChecked() call survives stripping", () => {
    // A gate written differently (no ' && ' prefix) must not slip through.
    const input = [
      "match /users/{uid} {",
      "  allow read: if isAppChecked() || isOwner(uid);",
      "}",
    ].join("\n");
    assert.throws(() => stripRulesText(input, "{}"), /still contains isAppChecked/);
  });

  it("keeps the real committed Firestore rules balanced after stripping", async () => {
    const { readFile } = await import("node:fs/promises");
    const firestore = await readFile(
      new URL("../firestore.rules", import.meta.url),
      "utf8",
    );
    const database = await readFile(
      new URL("../database.rules.json", import.meta.url),
      "utf8",
    );
    const { firestore: strippedFirestore } = stripRulesText(firestore, database);

    let depth = 0;
    for (const char of strippedFirestore) {
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
    }
    assert.equal(depth, 0);
  });
});
