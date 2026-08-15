import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { copyRulesText, writeEmulatorRuleset } from "./rules-for-emulator.mjs";

describe("copyRulesText (isolated emulator rules)", () => {
  it("keeps valid Firestore rules byte-identical", () => {
    const firestore = "match /routes/{routeId} {\n  allow read: if request.auth != null;\n}";
    const { firestore: copied } = copyRulesText(firestore, "{}");
    assert.equal(copied, firestore);
  });

  it("leaves valid Realtime Database rules unchanged", () => {
    const database = JSON.stringify(
      {
        rules: {
          ".read": false,
          ".write": false,
          activeBuses: {
            ".read": "auth != null",
            ".write": false,
          },
        },
      },
      null,
      2,
    );

    const { database: copied } = copyRulesText("{}", database);
    assert.ok(copied.includes('".read": "auth != null"'));
  });

  it("fails loudly when Firestore rules use the unsupported request.app field", () => {
    assert.throws(
      () => copyRulesText("allow read: if request.app != null;", "{}"),
      /must not use request.app/,
    );
  });

  it("keeps the real committed Firestore rules balanced", async () => {
    const firestore = await readFile(
      new URL("../firestore.rules", import.meta.url),
      "utf8",
    );
    const database = await readFile(
      new URL("../database.rules.json", import.meta.url),
      "utf8",
    );
    const { firestore: copiedFirestore } = copyRulesText(firestore, database);

    let depth = 0;
    for (const char of copiedFirestore) {
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
    }
    assert.equal(depth, 0);
  });
});

describe("writeEmulatorRuleset (temp-dir output)", () => {
  it("writes copied rules into a temp dir and never touches repo files", async () => {
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

      const copied = await readFile(firestorePath, "utf8");
      assert.equal(copied, before);
      const copiedDb = await readFile(databasePath, "utf8");
      assert.ok(copiedDb.includes('".read": "auth != null"'));

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
