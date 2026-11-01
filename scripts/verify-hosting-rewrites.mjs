import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read-only check of the Firebase Hosting rewrites to the Cloud Run backend
 * (`/api/**`, `/health`, `/live`). It sends GET requests only and never writes
 * data. Run it against a Hosting preview channel before the rewrites reach the
 * live site, and again after release. See docs/api/HTTP_CONTRACT.md, Section 3.4.
 *
 *   node scripts/verify-hosting-rewrites.mjs --hosting <origin> [--direct <origin>]
 *     [--samples 30] [--require-ready] [--max-added-p95-ms 300]
 *
 * One request carries `Authorization: Bearer invalid`. The backend answers it
 * with a 401 whose body differs from the answer to a request with no header,
 * which shows that Hosting forwarded the header. The backend logs that request
 * as a failed token verification.
 */

const JSON_TYPE = /^application\/json\b/i;
const HTML_TYPE = /^text\/html\b/i;

function originOf(value, flag) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${flag} must be an origin such as https://example.web.app.`);
  }
  // A trailing slash, an upper-case host or the default port still name the same origin.
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error(`${flag} must be an https origin with no path, got ${value}.`);
  }
  return url.origin;
}

/** Nearest-rank percentile of a numeric list. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarize(values) {
  return {
    samples: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  };
}

async function get(fetchImpl, url, headers = {}) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = response.headers.get("content-type") ?? "";
  let json = null;
  if (JSON_TYPE.test(contentType)) {
    try {
      json = await response.json();
    } catch {
      json = null;
    }
  } else {
    await response.arrayBuffer().catch(() => undefined);
  }
  return {
    status: response.status,
    contentType,
    cacheControl: response.headers.get("cache-control") ?? "",
    location: response.headers.get("location"),
    json,
  };
}

const isRedirect = (status) => status >= 300 && status < 400;
// Match the directive exactly: a substring test would also accept `x-no-store`.
const noStore = (value) => value.split(",").some((directive) => directive.trim().toLowerCase() === "no-store");

/** Each check returns `[ok, detail]`. A thrown error fails the check. */
const CHECKS = [
  ["GET /live returns JSON status alive", async (ctx) => {
    const r = await get(ctx.fetchImpl, `${ctx.hosting}/live`);
    if (isRedirect(r.status)) return [false, `redirect ${r.status} to ${r.location}`];
    if (r.status !== 200) return [false, `HTTP ${r.status}`];
    if (!JSON_TYPE.test(r.contentType)) return [false, `content-type ${r.contentType || "missing"}`];
    return [r.json?.status === "alive", `status ${r.json?.status}`];
  }],
  ["GET /health returns JSON readiness", async (ctx) => {
    const r = await get(ctx.fetchImpl, `${ctx.hosting}/health`);
    if (isRedirect(r.status)) return [false, `redirect ${r.status} to ${r.location}`];
    if (!JSON_TYPE.test(r.contentType)) return [false, `HTTP ${r.status}, content-type ${r.contentType || "missing"}`];
    const state = r.json?.status;
    if (state !== "ok" && state !== "degraded") return [false, `unexpected body status ${state}`];
    if (!noStore(r.cacheControl)) return [false, `cache-control "${r.cacheControl}" lacks no-store`];
    if (ctx.requireReady && state !== "ok") return [false, "backend reports degraded"];
    return [true, `HTTP ${r.status}, status ${state}`];
  }],
  ["Unauthenticated API call returns the backend JSON 401", async (ctx) => {
    const r = await get(ctx.fetchImpl, `${ctx.hosting}/api/health`);
    ctx.unauthenticated = r;
    if (isRedirect(r.status)) return [false, `redirect ${r.status} to ${r.location}`];
    if (r.status !== 401) return [false, `HTTP ${r.status}`];
    if (!JSON_TYPE.test(r.contentType)) return [false, `content-type ${r.contentType || "missing"}, not JSON`];
    return [typeof r.json?.error === "string", `error "${r.json?.error}"`];
  }],
  ["Authorization header reaches the backend", async (ctx) => {
    const r = await get(ctx.fetchImpl, `${ctx.hosting}/api/health`, { Authorization: "Bearer invalid" });
    if (r.status !== 401 || !JSON_TYPE.test(r.contentType)) return [false, `HTTP ${r.status}, content-type ${r.contentType || "missing"}`];
    // Without the header the backend says it is missing; with it, the token is rejected.
    // Identical bodies mean the header never arrived.
    const without = ctx.unauthenticated?.json;
    if (!without) return [false, "no JSON answer without the header to compare with"];
    return [JSON.stringify(r.json) !== JSON.stringify(without), `error "${r.json?.error}"`];
  }],
  ["API responses are not cacheable", async (ctx) => {
    const r = ctx.unauthenticated ?? await get(ctx.fetchImpl, `${ctx.hosting}/api/health`);
    return [noStore(r.cacheControl), `cache-control "${r.cacheControl}"`];
  }],
  ["Unknown API path is answered by the backend as JSON", async (ctx) => {
    // The backend authenticates before it routes, so an unknown path may answer 401 or 404.
    const r = await get(ctx.fetchImpl, `${ctx.hosting}/api/eki-rewrite-check-unknown`);
    if (r.status !== 401 && r.status !== 404) return [false, `HTTP ${r.status}`];
    return [JSON_TYPE.test(r.contentType), `HTTP ${r.status}, content-type ${r.contentType || "missing"}`];
  }],
  ["Static role pages still come from Hosting", async (ctx) => {
    for (const route of ["/", "/passenger", "/admin"]) {
      const r = await get(ctx.fetchImpl, `${ctx.hosting}${route}`);
      if (r.status !== 200 || !HTML_TYPE.test(r.contentType)) {
        return [false, `${route}: HTTP ${r.status}, content-type ${r.contentType || "missing"}`];
      }
    }
    return [true, "/, /passenger and /admin return HTML"];
  }],
  ["Service worker and Auth helper path are untouched", async (ctx) => {
    const sw = await get(ctx.fetchImpl, `${ctx.hosting}/sw.js`);
    if (sw.status !== 200 || !/javascript/i.test(sw.contentType)) {
      return [false, `/sw.js: HTTP ${sw.status}, content-type ${sw.contentType || "missing"}`];
    }
    const auth = await get(ctx.fetchImpl, `${ctx.hosting}/__/auth/handler`);
    if (JSON_TYPE.test(auth.contentType)) return [false, "/__/auth/handler returned JSON from the backend"];
    return [auth.status === 200, `/__/auth/handler HTTP ${auth.status}`];
  }],
  ["A page that does not exist is not answered by the backend", async (ctx) => {
    const r = await get(ctx.fetchImpl, `${ctx.hosting}/eki-rewrite-check-no-such-page`);
    if (JSON_TYPE.test(r.contentType)) return [false, "the backend answered a non-API path: the rewrite is a catch-all"];
    return [r.status === 404, `HTTP ${r.status}, content-type ${r.contentType || "missing"}`];
  }],
];

export async function verifyHostingRewrites({ hosting, direct, samples = 30, requireReady = false,
  maxAddedP95Ms = null, fetchImpl = fetch, now = () => performance.now() }) {
  const ctx = { hosting: originOf(hosting, "--hosting"), fetchImpl, requireReady, unauthenticated: null };
  // Validate both origins before any request, so a bad argument is never reported as a failed check.
  const directOrigin = direct ? originOf(direct, "--direct") : null;
  const checks = [];
  for (const [name, run] of CHECKS) {
    try {
      const [ok, detail] = await run(ctx);
      checks.push({ name, ok, detail });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const timeRequest = async (origin) => {
    const start = now();
    const r = await get(fetchImpl, `${origin}/live`);
    if (r.status !== 200) throw new Error(`${origin}/live returned HTTP ${r.status} during timing.`);
    return now() - start;
  };

  const latency = { hosting: null, direct: null, addedP50: null, addedP95: null };
  try {
    // Alternate the two origins, so that network drift or a scale event during
    // the run affects both samples alike instead of only one of them.
    const hostingDurations = [];
    const directDurations = [];
    for (let i = 0; i < samples; i += 1) {
      hostingDurations.push(await timeRequest(ctx.hosting));
      if (directOrigin) directDurations.push(await timeRequest(directOrigin));
    }
    latency.hosting = summarize(hostingDurations);
    if (directOrigin) {
      latency.direct = summarize(directDurations);
      latency.addedP50 = latency.hosting.p50 - latency.direct.p50;
      latency.addedP95 = latency.hosting.p95 - latency.direct.p95;
    }
    if (maxAddedP95Ms !== null && latency.addedP95 !== null) {
      checks.push({
        name: `Added p95 latency through Hosting is at most ${maxAddedP95Ms} ms`,
        ok: latency.addedP95 <= maxAddedP95Ms,
        detail: `${latency.addedP95.toFixed(0)} ms`,
      });
    }
  } catch (error) {
    checks.push({ name: "Latency sampling", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  return { ok: checks.every((check) => check.ok), checks, latency };
}

export function parseArgs(argv) {
  const options = { samples: 30, requireReady: false, maxAddedP95Ms: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value.`);
      i += 1;
      return argv[i];
    };
    if (arg === "--hosting") options.hosting = value();
    else if (arg === "--direct") options.direct = value();
    else if (arg === "--samples") options.samples = Number(value());
    else if (arg === "--max-added-p95-ms") options.maxAddedP95Ms = Number(value());
    else if (arg === "--require-ready") options.requireReady = true;
    else throw new Error(`Unknown argument ${arg}.`);
  }
  if (!options.hosting) throw new Error("--hosting <origin> is required.");
  if (!Number.isInteger(options.samples) || options.samples < 1 || options.samples > 500) {
    throw new Error("--samples must be an integer from 1 to 500.");
  }
  if (options.maxAddedP95Ms !== null && (!Number.isFinite(options.maxAddedP95Ms) || options.maxAddedP95Ms < 0)) {
    throw new Error("--max-added-p95-ms must be a non-negative number.");
  }
  if (options.maxAddedP95Ms !== null && !options.direct) {
    throw new Error("--max-added-p95-ms needs --direct to compare against.");
  }
  return options;
}

const fmt = (value) => (value === null ? "n/a" : `${value.toFixed(0)} ms`);

export function formatReport(report) {
  const lines = report.checks.map((c) => `${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  const { hosting, direct, addedP50, addedP95 } = report.latency;
  if (hosting) {
    lines.push("", `Latency of GET /live (${hosting.samples} samples)`);
    lines.push(`  through Hosting: p50 ${fmt(hosting.p50)}, p95 ${fmt(hosting.p95)}, p99 ${fmt(hosting.p99)}`);
    if (direct) {
      lines.push(`  direct service:  p50 ${fmt(direct.p50)}, p95 ${fmt(direct.p95)}, p99 ${fmt(direct.p99)}`);
      lines.push(`  added by Hosting: p50 ${fmt(addedP50)}, p95 ${fmt(addedP95)}`);
    }
  }
  return lines.join("\n");
}

async function run() {
  const report = await verifyHostingRewrites(parseArgs(process.argv.slice(2)));
  console.log(formatReport(report));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
