// Read-only runtime probes. No tokens, live telemetry, rides or messages are written.
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes("--frontend") || !args.includes("--backend")) {
  throw new Error("Usage: node scripts/check-stationary-runtime.mjs --frontend <origin> --backend <origin> [--out <json>]");
}
const frontend = new URL(option("--frontend"));
const backend = new URL(option("--backend"));
for (const url of [frontend, backend]) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use HTTP(S) origins without credentials.");
  }
}
const headers = { Origin: frontend.origin };
if ([".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"].some(s => backend.hostname.endsWith(s))) {
  headers["ngrok-skip-browser-warning"] = "1";
}
async function probe(name, url, init, expectedStatus) {
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    const result = {
      name, status: response.status, expectedStatus, pass: response.status === expectedStatus,
      durationMs: Math.round(performance.now() - started),
      allowOrigin: response.headers.get("access-control-allow-origin"),
      contentType: response.headers.get("content-type"),
    };
    await response.body?.cancel();
    return result;
  } catch (error) {
    return { name, pass: false, error: error.name, durationMs: Math.round(performance.now() - started) };
  }
}
const checks = await Promise.all([
  probe("frontend reachable", frontend.origin, {}, 200),
  probe("public backend health", `${backend.origin}/health`, { headers }, 200),
  probe("API preflight", `${backend.origin}/api/places/search?q=Ahmedabad`, {
    method: "OPTIONS", headers: { ...headers, "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,ngrok-skip-browser-warning" },
  }, 204),
  probe("Places authentication boundary", `${backend.origin}/api/places/search?q=Ahmedabad`, {
    headers: { ...headers, "User-Agent": "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36" },
  }, 401),
]);
for (const check of checks.filter(c => c.name !== "frontend reachable")) {
  if (check.allowOrigin !== frontend.origin) check.pass = false;
}
const report = { generatedAt: new Date().toISOString(), frontend: frontend.origin,
  backend: backend.origin, checks,
  limitations: "Does not prove authenticated Places results, served CSP, browser rendering or physical route behavior." };
if (args.includes("--out")) await writeFile(option("--out"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (checks.some(c => !c.pass)) process.exitCode = 1;
