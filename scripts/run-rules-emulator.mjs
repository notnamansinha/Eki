import { spawn } from "node:child_process";
import { writeEmulatorRuleset } from "./rules-for-emulator.mjs";

/**
 * Runs the Firebase emulator rules-integration suite against App Check-free
 * copies of the rules (see rules-for-emulator.mjs). Cross-platform: spawns
 * npx directly instead of relying on shell quoting, and never modifies the
 * deployable repository rule files.
 */
const { configPath } = await writeEmulatorRuleset();

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(
  npx,
  [
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
  ],
  {
    stdio: "inherit",
    env: { ...process.env, FIREBASE_RULES_TEST: "1" },
  },
);

child.on("error", (err) => {
  console.error("Failed to start emulator runner:", err);
  process.exit(1);
});
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
