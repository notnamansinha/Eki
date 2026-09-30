import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backendOriginFromUrl } from "./csp-backend-origin.mjs";

export function connectSourcesFromCsp(csp) {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src "));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

export function assertWebBackendContract(firebase, backendUrl, strict = false) {
  const origin = backendOriginFromUrl(backendUrl);
  if (!origin) {
    if (strict) {
      throw new Error("NEXT_PUBLIC_BACKEND_URL is required for a production web build.");
    }
    return { checked: false, origin: null };
  }
  const globalHeaders = firebase?.hosting?.headers?.find(
    (entry) => entry?.source === "**",
  );
  const csp = globalHeaders?.headers?.find(
    (header) => header?.key?.toLowerCase() === "content-security-policy",
  )?.value;
  if (typeof csp !== "string") {
    throw new Error("Global Content-Security-Policy header not found.");
  }
  if (!connectSourcesFromCsp(csp).includes(origin)) {
    throw new Error("The configured backend origin is missing from CSP connect-src.");
  }
  return { checked: true, origin };
}

async function run() {
  const root = path.resolve(import.meta.dirname, "..");
  const firebase = JSON.parse(await readFile(path.join(root, "firebase.json"), "utf8"));
  const result = assertWebBackendContract(
    firebase,
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.EKI_STRICT_PRODUCTION_BUILD === "true",
  );
  if (!result.checked) {
    console.log("Web/backend contract skipped: no backend URL configured for this local build.");
    return;
  }
  if (process.env.EKI_RUNTIME_SMOKE === "1") {
    const response = await fetch(`${result.origin}/health`, {
      signal: AbortSignal.timeout(5_000),
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    if (!response.ok) throw new Error(`Backend health probe failed with HTTP ${response.status}.`);
  }
  console.log("Web/backend CSP contract verified.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
