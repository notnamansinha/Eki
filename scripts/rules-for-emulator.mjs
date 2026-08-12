import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Strips App Check conditions from the committed security rules so the
 * Firestore/RTDB emulator can run the authorization integration suite.
 *
 * Why: @firebase/rules-unit-testing v5 has no API to attach an App Check token
 * (authenticatedContext only customizes auth claims), so the emulator always
 * evaluates `request.app == null`. Enforcing App Check in rules (issue #39)
 * would make every simulated request fail. This script produces the
 * emulator-testable ruleset by removing the `isAppChecked()` gates; the
 * committed rules stay enforced in production and are statically verified by
 * securityConfig.test.ts.
 *
 * It overwrites the rules files in place. In CI the checkout is throwaway; for
 * local runs, `git checkout -- firestore.rules database.rules.json` restores
 * the committed rules.
 */
const root = path.resolve(import.meta.dirname, "..");

const FIRESTORE_PATH = path.join(root, "firestore.rules");
const DATABASE_PATH = path.join(root, "database.rules.json");

// The exact gate fragments added by the App Check enforcement. Replacing them
// with the empty string restores the pre-App-Check condition text.
const FIRESTORE_GATE = " && isAppChecked()";
const DATABASE_GATE = " && request.app != null";

// The helper function block (comment + function) added for App Check; removed
// wholesale so the emulator ruleset contains no App Check residue at all.
// The rules files use CRLF line endings, so every \n is actually \r\n.
const FIRESTORE_HELPER =
  /^\s*\/\/ App Check \(issue #39\):[\s\S]*?\r?\n    \}\r?\n\r?\n/m;

export function stripRulesText(firestoreText, databaseText) {
  let strippedFirestore = firestoreText
    .split(FIRESTORE_GATE)
    .join("")
    .replace(FIRESTORE_HELPER, "");
  const strippedDatabase = databaseText.split(DATABASE_GATE).join("");

  if (strippedFirestore.includes("isAppChecked(")) {
    throw new Error(
      "firestore.rules still contains isAppChecked() after stripping; " +
        "the gate fragment must be exactly ' && isAppChecked()'.",
    );
  }
  if (strippedDatabase.includes("request.app")) {
    throw new Error(
      "database.rules.json still contains request.app after stripping.",
    );
  }
  return { firestore: strippedFirestore, database: strippedDatabase };
}

export async function stripAppCheck() {
  const firestore = await readFile(FIRESTORE_PATH, "utf8");
  const database = await readFile(DATABASE_PATH, "utf8");

  const { firestore: strippedFirestore, database: strippedDatabase } =
    stripRulesText(firestore, database);

  // Guard against an accidental unbalanced strip (every removal leaves the
  // condition text valid, but a malformed source would show up as an
  // unbalanced brace count).
  const depth = (text) => {
    let d = 0;
    for (const char of text) {
      if (char === "{") d += 1;
      else if (char === "}") d -= 1;
      if (d < 0) return -1;
    }
    return d;
  };
  if (depth(strippedFirestore) !== 0) {
    throw new Error("firestore.rules is unbalanced after stripping.");
  }

  await writeFile(FIRESTORE_PATH, strippedFirestore);
  await writeFile(DATABASE_PATH, strippedDatabase);
  return { firestore: strippedFirestore, database: strippedDatabase };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stripAppCheck();
  console.log(
    "Stripped App Check gates for emulator testing:\n" +
      `  ${FIRESTORE_PATH}\n  ${DATABASE_PATH}\n` +
      "Restore with: git checkout -- firestore.rules database.rules.json",
  );
}
