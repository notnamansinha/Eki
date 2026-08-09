import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const environment = { ...process.env };
environment.EKI_STRICT_PRODUCTION_BUILD = "true";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is unavailable; run this script through npm.");
}
const child = spawn(process.execPath, [npmCli, "run", "build"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: environment,
  stdio: "inherit",
  shell: false,
});
child.once("exit", (code) => process.exit(code ?? 1));
child.once("error", (error) => {
  console.error(error);
  process.exit(1);
});
