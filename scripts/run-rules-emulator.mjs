import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeEmulatorRuleset } from "./rules-for-emulator.mjs";
import { safetyPreflight } from "./qa/safety-preflight.mjs";
import {
  assertEmulatorPortsFree,
  killProcessTree,
  reapOrphanedEmulators,
  resolveJavaHome,
  withJdkFirstOnPath,
} from "./qa/emulator-process.mjs";

/**
 * Runs the Firebase emulator rules-integration suite against isolated copies
 * of the rules (see rules-for-emulator.mjs). The emulators:exec test
 * command contains spaces, so it is passed as a single argv element: POSIX
 * spawns the npx shim directly, and Windows spawns node with npm's npx CLI
 * entry (avoiding .cmd shims and cmd.exe quote mangling entirely). The
 * deployable repository rule files are never modified.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !['--browser', '--browser-providers', '--browser-service', '--api'].includes(args[0]))) throw new Error('Only named browser or API scopes are supported');
const api = args[0] === '--api';
const browser = args.length === 1 && !api;
const evidenceDirectory = path.join(ROOT, 'artifacts/qa'); mkdirSync(evidenceDirectory, { recursive: true });
const prefix = api ? 'api' : browser ? 'browser' : 'emulator';
for (const name of [`${prefix}-${browser ? 'playwright' : 'vitest'}.json`, `${prefix}-junit.xml`, `${prefix}-report.md`, `${prefix}-run.log`, ...(browser ? ['browser-results', 'browser-progress.json'] : [])]) rmSync(path.join(evidenceDirectory, name), { force: true, recursive: true });
writeFileSync(path.join(evidenceDirectory, `${prefix}-report.json`), JSON.stringify({
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).trim()),
  startedAt: new Date().toISOString(), timezone: 'Asia/Calcutta', verdict: 'BLOCKED',
  setupError: 'Emulator setup has not yet produced observed execution evidence', counts: null,
  physicalMotionExecuted: false, realProvidersExecuted: false,
  node: process.version, platform: process.platform, firebaseTools: '15.14.0',
}, null, 2) + '\n');
safetyPreflight(process.env); // Reject inherited provider/cloud credentials before tooling starts.
// Fail fast (naming port and owner) when a previous run's emulators still hold a port.
try {
  await assertEmulatorPortsFree();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const { configPath, firestorePath, databasePath } = await writeEmulatorRuleset();

const emulatorArgs = [
  "--yes",
  "firebase-tools@15.14.0",
  "emulators:exec",
  "--config",
  configPath,
  "--only",
  "firestore,database,auth",
  "--project",
  "demo-eki-qa",
  `node "${path.join(ROOT, api ? 'scripts/qa/run-api.mjs' : browser ? 'scripts/qa/run-browser-tests.mjs' : 'scripts/qa/run-emulator-tests.mjs')}"`,
];

function spawnNpx() {
  // Windows: put the real JDK first on PATH so firebase-tools spawns java.exe
  // itself rather than Oracle's javapath launcher stub; otherwise its SIGINT
  // only terminates the stub and the emulator JVMs keep their ports open.
  const baseEnv = process.platform === "win32"
    ? withJdkFirstOnPath(process.env, resolveJavaHome(process.env))
    : process.env;
  const env = {
    ...baseEnv,
    FIREBASE_RULES_TEST: "1",
    FIRESTORE_RULES_PATH: firestorePath,
    DATABASE_RULES_PATH: databasePath,
    GCLOUD_PROJECT: 'demo-eki-qa',
    FIREBASE_DATABASE_URL: 'http://127.0.0.1:9005/',
    EKI_QA_EXTERNAL_PROVIDERS: 'mock',
    EKI_QA_CONFIRM_DISPOSABLE: '1',
    EKI_QA_BASE_URL: 'http://127.0.0.1:3116/',
    EKI_QA_BROWSER_SCOPE: args[0] === '--browser-providers' ? 'providers' : args[0] === '--browser-service' ? 'service' : 'all',
    DOTENV_CONFIG_PATH: path.join(ROOT, 'artifacts/qa/nonexistent.env'),
    METADATA_SERVER_DETECTION: 'none', // No GCP environment discovery in local demo tests.
  };
  const opts = { stdio: "inherit", cwd: ROOT, env };

  if (process.platform !== "win32") {
    return spawn("npx", emulatorArgs, opts);
  }

  // Windows: node + npm's npx CLI keeps every argument (including the quoted
  // emulators:exec script) intact — no .cmd shim, no cmd.exe quote parsing.
  const npxCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  if (existsSync(npxCli)) {
    return spawn(process.execPath, [npxCli, ...emulatorArgs], opts);
  }

  // Fallback: .cmd shim through a shell (spaces in the script arg may be
  // mangled; prefer the node entry above).
  return spawn("npx.cmd", emulatorArgs, { ...opts, shell: true });
}

const child = spawnNpx();
// Deadline: kill the whole tree (Windows: taskkill /T), not just the npx process.
const deadline = setTimeout(() => { console.error('Emulator runner deadline exceeded; dependent tests BLOCKED.'); killProcessTree(child); }, (browser ? 8 : 6) * 60_000);

function finish(code) {
  clearTimeout(deadline);
  // Windows: emulator JVMs are spawned detached, outside the job object, and
  // can outlive the runner. The port preflight proved the ports were free at
  // start, so any java.exe still listening on them was orphaned by this run.
  const reaped = reapOrphanedEmulators();
  if (reaped.length) console.error(`Stopped orphaned emulator JVM(s): ${reaped.join(", ")}`);
  process.exit(code);
}

child.on("error", (err) => {
  console.error("Failed to start emulator runner:", err);
  finish(1);
});
child.on("exit", (code) => finish(code ?? 1));
