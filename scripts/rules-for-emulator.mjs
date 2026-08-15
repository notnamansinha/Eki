import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Produces isolated copies of the security rules for the Firestore/RTDB
 * emulator integration suite, WITHOUT touching the deployable repository
 * files. App Check is enforced by Firebase at the product level; it is not a
 * Cloud Firestore Security Rules request property.
 *
 * This module writes copied rules plus a temporary firebase.json (which
 * references them by absolute path) into a fresh OS temp directory and returns
 * that config's path. The committed rules stay enforced in production and are
 * statically verified by securityConfig.test.ts. The `test:rules` script and
 * the CI emulator step run firebase emulators:exec against that temp config.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_FIRESTORE = path.join(ROOT, "firestore.rules");
const REPO_DATABASE = path.join(ROOT, "database.rules.json");
const REPO_CONFIG = path.join(ROOT, "firebase.json");

export function copyRulesText(firestoreText, databaseText) {
  if (firestoreText.includes("request.app")) {
    throw new Error(
      "firestore.rules must not use request.app; configure App Check enforcement in Firebase.",
    );
  }
  return { firestore: firestoreText, database: databaseText };
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
 * Writes copied rules + a temp firebase.json into a fresh temp dir and
 * returns the paths. Never overwrites the repository's rule files.
 */
export async function writeEmulatorRuleset() {
  const dir = await mkdtemp(path.join(tmpdir(), "eki-rules-"));
  const firestore = await readFile(REPO_FIRESTORE, "utf8");
  const database = await readFile(REPO_DATABASE, "utf8");

  const { firestore: copiedFirestore, database: copiedDatabase } =
    copyRulesText(firestore, database);

  if (!assertBalanced(copiedFirestore)) {
    throw new Error("firestore.rules is unbalanced.");
  }

  const firestorePath = path.join(dir, "firestore.rules");
  const databasePath = path.join(dir, "database.rules.json");
  await writeFile(firestorePath, copiedFirestore);
  await writeFile(databasePath, copiedDatabase);

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
