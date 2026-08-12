import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeEmulatorRuleset } from "./rules-for-emulator.mjs";

/**
 * Runs the Firebase emulator rules-integration suite against App Check-free
 * copies of the rules (see rules-for-emulator.mjs). The emulators:exec test
 * command contains spaces, so it is passed as a single argv element: POSIX
 * spawns the npx shim directly, and Windows spawns node with npm's npx CLI
 * entry (avoiding .cmd shims and cmd.exe quote mangling entirely). The
 * deployable repository rule files are never modified.
 */
const { configPath } = await writeEmulatorRuleset();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const emulatorArgs = [
  "--yes",
  "firebase-tools@15.14.0",
  "emulators:exec",
  "--config",
  configPath,
  "--only",
  "firestore,database",
  "--project",
  "eki-rules-test",
  "npm run test:rules-integration --workspace=backend",
];

function spawnNpx() {
  const env = { ...process.env, FIREBASE_RULES_TEST: "1" };
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

child.on("error", (err) => {
  console.error("Failed to start emulator runner:", err);
  process.exit(1);
});
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
