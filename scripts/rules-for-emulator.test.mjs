import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { stripRulesText, writeEmulatorRuleset } from "./rules-for-emulator.mjs";

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
      "  allow read: if isAppChecked() && isOwner(uid);",
      "  allow create: if false;",
      "}",
      "match /routes/{routeId} {",
      "  allow read: if isAppChecked() && isAuthenticated();",
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
      "  allow read: if isAppChecked() && isOwner(uid);\r\n" +
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
    // A gate written differently (no 'isAppChecked() && ' prefix) must not slip
    // through — e.g. an OR-bypass that the fragment replacement cannot reach.
    const input = [
      "match /users/{uid} {",
      "  allow read: if isAppChecked() || isOwner(uid);",
      "}",
    ].join("\n");
    assert.throws(() => stripRulesText(input, "{}"), /still contains isAppChecked/);
  });

  it("keeps the real committed Firestore rules balanced after stripping", async () => {
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

describe("writeEmulatorRuleset (temp-dir output, audit #113)", () => {
  it("writes stripped rules into a temp dir and never touches repo files", async () => {
    const before = await readFile(
      new URL("../firestore.rules", import.meta.url),
      "utf8",
    );
    const { dir, configPath, firestorePath, databasePath } =
      await writeEmulatorRuleset();

    try {
      // The temp output is a fresh directory outside the repo.
      assert.ok(dir.includes("eki-rules-"));
      assert.ok(!firestorePath.includes("\\Eki\\Eki\\firestore.rules"));
      assert.ok(!databasePath.includes("\\Eki\\Eki\\database.rules.json"));

      const stripped = await readFile(firestorePath, "utf8");
      assert.ok(!stripped.includes("isAppChecked"));
      const strippedDb = await readFile(databasePath, "utf8");
      assert.ok(!strippedDb.includes("request.app"));

      // The temp firebase.json references the temp rules by absolute path.
      const config = JSON.parse(await readFile(configPath, "utf8"));
      assert.equal(config.firestore.rules, firestorePath);
      assert.equal(config.database.rules, databasePath);
    } finally {
      await import("node:fs/promises").then(({ rm }) =>
        rm(dir, { recursive: true, force: true }),
      );
    }

    // The deployable repo rules are byte-identical to before the run.
    const after = await readFile(
      new URL("../firestore.rules", import.meta.url),
      "utf8",
    );
    assert.equal(after, before);
  });
});
