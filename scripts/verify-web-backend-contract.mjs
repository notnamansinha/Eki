import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backendOriginFromUrl } from "./csp-backend-origin.mjs";
import { loadFrontendEnv } from "./load-frontend-env.mjs";

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
      throw new Error(
        "NEXT_PUBLIC_BACKEND_URL is required for a production web build (shell or frontend/.env* files).",
      );
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

/** Read-only release gate: reject dead tunnels, error pages and blocked CORS. */
export async function verifyBackendAvailability(origin, frontendOrigin, fetchImpl = fetch) {
  if (!frontendOrigin || new URL(frontendOrigin).origin !== frontendOrigin) {
    throw new Error("EKI_FRONTEND_ORIGIN must be the deployed frontend origin.");
  }
  const isNgrok = [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"]
    .some(suffix => new URL(origin).hostname.endsWith(suffix));
  const headers = { Origin: frontendOrigin, ...(isNgrok ? { "ngrok-skip-browser-warning": "1" } : {}) };
  const requestedHeaders = ["authorization", "content-type", ...(isNgrok ? ["ngrok-skip-browser-warning"] : [])];
  const response = await fetchImpl(`${origin}/health`, {
    headers, redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Backend health probe failed with HTTP ${response.status}.`);
  const body = await response.json();
  if (body?.status !== "ok") throw new Error("Backend did not report healthy readiness.");
  const allowsOrigin = response.headers.get("access-control-allow-origin");
  if (allowsOrigin !== frontendOrigin && allowsOrigin !== "*") {
    throw new Error("Backend CORS does not allow the deployed frontend.");
  }
  // The browser sends this preflight before authenticated JSON mutations.
  // OPTIONS does not create a profile or modify an account.
  const preflight = await fetchImpl(`${origin}/api/users/bootstrap`, {
    method: "OPTIONS", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { ...headers, "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": requestedHeaders.join(",") },
  });
  const tokens = name => (preflight.headers.get(name) ?? "").toLowerCase().split(",").map(value => value.trim());
  const preflightOrigin = preflight.headers.get("access-control-allow-origin");
  if (!preflight.ok || ![frontendOrigin, "*"].includes(preflightOrigin) ||
      !tokens("access-control-allow-methods").includes("post") ||
      !requestedHeaders.every(name => tokens("access-control-allow-headers").includes(name))) {
    throw new Error("Backend rejected the authenticated browser request preflight.");
  }
}

async function run() {
  const root = path.resolve(import.meta.dirname, "..");
  // Check the URL `next build` compiled into the bundle, not only the shell's.
  loadFrontendEnv(root);
  const firebase = JSON.parse(await readFile(path.join(root, "firebase.json"), "utf8"));
  const result = assertWebBackendContract(
    firebase,
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.EKI_STRICT_PRODUCTION_BUILD === "true",
  );
  if (!result.checked) {
    console.log(
      "Web/backend contract skipped: no NEXT_PUBLIC_BACKEND_URL in the shell or frontend/.env* files.",
    );
    return;
  }
  if (process.env.EKI_RUNTIME_SMOKE === "1") {
    await verifyBackendAvailability(result.origin, process.env.EKI_FRONTEND_ORIGIN);
  }
  console.log("Web/backend CSP contract verified.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
