import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Produces App Check-free copies of the security rules for the Firestore/RTDB
 * emulator integration suite, WITHOUT touching the deployable repository
 * files (audit #113: a stale in-place rewrite could be deployed by accident).
 *
 * Why stripping is needed: @firebase/rules-unit-testing v5 has no API to
 * attach an App Check token (authenticatedContext only customizes auth
 * claims), so the emulator always evaluates `request.app == null`. Enforcing
 * App Check in rules (issue #39) would make every simulated request fail.
 *
 * This module writes the stripped rules plus a temporary firebase.json (which
 * references them by absolute path) into a fresh OS temp directory and returns
 * that config's path. The committed rules stay enforced in production and are
 * statically verified by securityConfig.test.ts. The `test:rules` script and
 * the CI emulator step run firebase emulators:exec against that temp config.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_FIRESTORE = path.join(ROOT, "firestore.rules");
const REPO_DATABASE = path.join(ROOT, "database.rules.json");
const REPO_CONFIG = path.join(ROOT, "firebase.json");

// The exact gate fragments added by the App Check enforcement. Replacing them
// with the empty string restores the pre-App-Check condition text. Gates are
// evaluated FIRST (before auth/session lookups), so the Firestore fragment
// carries a trailing " && ".
const FIRESTORE_GATE = "isAppChecked() && ";

// The helper function block (comment + function) added for App Check; removed
// wholesale so the emulator ruleset contains no App Check residue at all.
const FIRESTORE_HELPER =
  /^\s*\/\/ App Check \(issue #39\):[\s\S]*?\r?\n    \}\r?\n\r?\n/m;

export function stripRulesText(firestoreText, databaseText) {
  let strippedFirestore = firestoreText
    .split(FIRESTORE_GATE)
    .join("")
    .replace(FIRESTORE_HELPER, "");
  const strippedDatabase = databaseText;

  if (strippedFirestore.includes("isAppChecked(")) {
    throw new Error(
      "firestore.rules still contains isAppChecked() after stripping; " +
        "the gate fragment must be exactly 'isAppChecked() && '.",
    );
  }
  return { firestore: strippedFirestore, database: strippedDatabase };
}

function assertBalanced(text) {
  let depth = 0;
  for (const char of text) {
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Writes stripped rules + a temp firebase.json into a fresh temp dir and
 * returns the paths. Never overwrites the repository's rule files.
 */
export async function writeEmulatorRuleset() {
  const dir = await mkdtemp(path.join(tmpdir(), "eki-rules-"));
  const firestore = await readFile(REPO_FIRESTORE, "utf8");
  const database = await readFile(REPO_DATABASE, "utf8");

  const { firestore: strippedFirestore, database: strippedDatabase } =
    stripRulesText(firestore, database);

  if (!assertBalanced(strippedFirestore)) {
    throw new Error("firestore.rules is unbalanced after stripping.");
  }

  const firestorePath = path.join(dir, "firestore.rules");
  const databasePath = path.join(dir, "database.rules.json");
  await writeFile(firestorePath, strippedFirestore);
  await writeFile(databasePath, strippedDatabase);

  // Temp firebase.json: rules point at the temp files (absolute paths), while
  // every other deployable setting (hosting, indexes, headers) is unchanged.
  const config = JSON.parse(await readFile(REPO_CONFIG, "utf8"));
  if (config.firestore) {
    config.firestore.rules = firestorePath;
    if (typeof config.firestore.indexes === "string") {
      config.firestore.indexes = path.join(ROOT, config.firestore.indexes);
    }
  }
  if (config.database) {
    config.database.rules = databasePath;
  }
  const configPath = path.join(dir, "firebase.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));

  return { dir, configPath, firestorePath, databasePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { configPath } = await writeEmulatorRuleset();
  console.log(configPath);
}
