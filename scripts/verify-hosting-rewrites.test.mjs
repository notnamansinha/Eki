import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatReport,
  parseArgs,
  percentile,
  summarize,
  verifyHostingRewrites,
} from "./verify-hosting-rewrites.mjs";

const HOSTING = "https://eki.web.app";
const DIRECT = "https://eki-backend.run.app";

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const html = (status = 200, headers = {}) =>
  new Response("<!doctype html>", { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

/** A correctly configured Hosting site in front of the backend; `override` breaks one route. */
function site({ override = () => undefined, cost = { [HOSTING]: 80, [DIRECT]: 30 } } = {}) {
  const state = { t: 0, requests: [] };
  const fetchImpl = async (url, init = {}) => {
    const { origin, pathname } = new URL(url);
    state.requests.push({ method: init.method, url, headers: init.headers ?? {} });
    state.t += cost[origin] ?? 0;
    const custom = override(pathname, init, origin);
    if (custom) return custom;
    const authorization = new Headers(init.headers).get("authorization");
    switch (pathname) {
      case "/live": return json(200, { status: "alive" });
      case "/health": return json(200, { status: "ok" });
      case "/api/health":
        return authorization
          ? json(401, { error: "Invalid or expired token." })
          : json(401, { error: "Missing or malformed Authorization header." });
      // The backend authenticates before it routes, so an unknown API path answers 401.
      case "/api/eki-rewrite-check-unknown": return json(401, { error: "Missing or malformed Authorization header." });
      case "/": case "/passenger": case "/admin": case "/__/auth/handler": return html();
      case "/sw.js":
        return new Response("//sw", { status: 200, headers: { "content-type": "application/javascript" } });
      default: return html(404);
    }
  };
  return { fetchImpl, now: () => state.t, state };
}

const run = (s, extra = {}) =>
  verifyHostingRewrites({ hosting: HOSTING, samples: 5, fetchImpl: s.fetchImpl, now: s.now, ...extra });
const failed = (report) => report.checks.filter((c) => !c.ok).map((c) => c.name);

describe("Hosting rewrite verification", () => {
  it("passes against a correctly configured site", async () => {
    const report = await run(site());
    assert.deepEqual(failed(report), []);
    assert.equal(report.ok, true);
  });

  it("sends only GET requests", async () => {
    const s = site();
    await run(s);
    assert.ok(s.state.requests.length > 0);
    assert.ok(s.state.requests.every((r) => r.method === "GET"));
  });

  it("fails when a rewrite is missing and the API path returns Hosting HTML", async () => {
    const report = await run(site({ override: (p) => (p.startsWith("/api/") ? html(404) : undefined) }));
    const names = failed(report);
    assert.ok(names.includes("Unauthenticated API call returns the backend JSON 401"));
    assert.ok(names.includes("Unknown API path is answered by the backend as JSON"));
    assert.equal(report.ok, false);
  });

  it("fails when /live redirects", async () => {
    const report = await run(site({
      override: (p) => (p === "/live" ? new Response(null, { status: 301, headers: { location: "/other" } }) : undefined),
    }));
    assert.ok(failed(report).includes("GET /live returns JSON status alive"));
    assert.ok(report.checks[0].detail.includes("redirect 301"));
  });

  it("fails when Hosting drops the Authorization header", async () => {
    const report = await run(site({
      override: (p) => (p === "/api/health"
        ? json(401, { error: "Missing or malformed Authorization header." })
        : undefined),
    }));
    assert.deepEqual(failed(report), ["Authorization header reaches the backend"]);
  });

  it("accepts a backend JSON 404 for an unknown API path", async () => {
    const report = await run(site({
      override: (p) => (p === "/api/eki-rewrite-check-unknown" ? json(404, { error: "Not found." }) : undefined),
    }));
    assert.deepEqual(failed(report), []);
  });

  it("fails when API responses carry no Cache-Control header", async () => {
    const report = await run(site({
      override: (p) => (p === "/api/health"
        ? new Response(JSON.stringify({ error: "x" }), { status: 401, headers: { "content-type": "application/json" } })
        : undefined),
    }));
    assert.ok(failed(report).includes("API responses are not cacheable"));
  });

  it("fails when API responses can be cached", async () => {
    const report = await run(site({
      override: (p) => (p === "/api/health"
        ? json(401, { error: "x" }, { "cache-control": "public, max-age=60" })
        : undefined),
    }));
    assert.ok(failed(report).includes("API responses are not cacheable"));
  });

  it("matches the no-store directive exactly, not as a substring", async () => {
    for (const cacheControl of ["public, max-age=60, x-no-store", "no-store-foo", "max-age=60"]) {
      const report = await run(site({
        override: (p) => (p === "/api/health" ? json(401, { error: "x" }, { "cache-control": cacheControl }) : undefined),
      }));
      assert.ok(failed(report).includes("API responses are not cacheable"), cacheControl);
    }
    for (const cacheControl of ["No-Store", "private,no-store", "no-store, max-age=0"]) {
      const report = await run(site({
        override: (p, init) => (p === "/api/health" && !new Headers(init.headers).get("authorization")
          ? json(401, { error: "Missing or malformed Authorization header." }, { "cache-control": cacheControl })
          : undefined),
      }));
      assert.deepEqual(failed(report), [], cacheControl);
    }
  });

  it("accepts private, no-store as non-cacheable", async () => {
    const report = await run(site({
      override: (p, init) => (p === "/api/health" && !new Headers(init.headers).get("authorization")
        ? json(401, { error: "Missing or malformed Authorization header." }, { "cache-control": "private, no-store" })
        : undefined),
    }));
    assert.deepEqual(failed(report), []);
  });

  it("fails when the rewrite is a catch-all that answers non-API paths", async () => {
    const report = await run(site({
      override: (p) => (p === "/eki-rewrite-check-no-such-page" ? json(404, { error: "Not found." }) : undefined),
    }));
    assert.deepEqual(failed(report), ["A page that does not exist is not answered by the backend"]);
  });

  it("fails when the Auth helper path is swallowed by the backend", async () => {
    const report = await run(site({
      override: (p) => (p === "/__/auth/handler" ? json(404, { error: "Not found." }) : undefined),
    }));
    assert.ok(failed(report).includes("Service worker and Auth helper path are untouched"));
  });

  it("fails when a static role page is not HTML", async () => {
    const report = await run(site({ override: (p) => (p === "/admin" ? json(200, {}) : undefined) }));
    assert.ok(failed(report).includes("Static role pages still come from Hosting"));
  });

  it("treats a degraded /health as a pass unless readiness is required", async () => {
    const degraded = { override: (p) => (p === "/health" ? json(503, { status: "degraded" }) : undefined) };
    assert.equal((await run(site(degraded))).ok, true);
    const strict = await run(site(degraded), { requireReady: true });
    assert.deepEqual(failed(strict), ["GET /health returns JSON readiness"]);
  });

  it("fails /health that is not JSON", async () => {
    const report = await run(site({ override: (p) => (p === "/health" ? html(200) : undefined) }));
    assert.ok(failed(report).includes("GET /health returns JSON readiness"));
  });

  it("reports a network error as a failed check, not a crash", async () => {
    const s = site({ override: (p) => { if (p === "/live") throw new TypeError("fetch failed"); } });
    const report = await run(s);
    assert.ok(failed(report).includes("GET /live returns JSON status alive"));
  });

  it("measures the latency that Hosting adds over the direct service", async () => {
    const report = await run(site(), { direct: DIRECT, maxAddedP95Ms: 100 });
    assert.equal(report.latency.hosting.p50, 80);
    assert.equal(report.latency.direct.p50, 30);
    assert.equal(report.latency.addedP50, 50);
    assert.equal(report.latency.addedP95, 50);
    assert.deepEqual(failed(report), []);
  });

  it("fails when Hosting adds more than the allowed p95 latency", async () => {
    const report = await run(site(), { direct: DIRECT, maxAddedP95Ms: 20 });
    assert.deepEqual(failed(report), ["Added p95 latency through Hosting is at most 20 ms"]);
  });

  it("alternates Hosting and direct requests while timing", async () => {
    const s = site();
    await run(s, { direct: DIRECT });
    const timed = s.state.requests.slice(-10).map((r) => new URL(r.url).origin);
    assert.deepEqual(timed, Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? HOSTING : DIRECT)));
  });

  it("fails the header check when the request without the header got no answer", async () => {
    const report = await run(site({
      override: (p, init) => {
        if (p === "/api/health" && !new Headers(init.headers).get("authorization")) throw new TypeError("fetch failed");
      },
    }));
    const header = report.checks.find((c) => c.name === "Authorization header reaches the backend");
    assert.equal(header.ok, false);
    assert.match(header.detail, /no JSON answer without the header/);
  });

  it("accepts an origin with a trailing slash, an upper-case host or the default port", async () => {
    for (const hosting of ["https://eki.web.app/", "https://EKI.web.app", "https://eki.web.app:443"]) {
      const s = site();
      const report = await run(s, { hosting });
      assert.deepEqual(failed(report), [], hosting);
      assert.ok(s.state.requests.every((r) => r.url.startsWith(`${HOSTING}/`)), hosting);
    }
  });

  it("rejects an invalid --direct origin before sending any request", async () => {
    for (const direct of ["http://eki-backend.run.app", "https://eki-backend.run.app/live", "not a url"]) {
      const s = site();
      await assert.rejects(() => run(s, { direct }), /--direct/, direct);
      assert.equal(s.state.requests.length, 0, `requests were sent for ${direct}`);
    }
  });

  it("rejects an origin that is not https or carries a path", async () => {
    await assert.rejects(() => verifyHostingRewrites({ hosting: "http://eki.web.app", fetchImpl: site().fetchImpl }), /https origin/);
    await assert.rejects(() => verifyHostingRewrites({ hosting: "https://eki.web.app/app", fetchImpl: site().fetchImpl }), /https origin/);
  });
});

describe("statistics", () => {
  it("computes nearest-rank percentiles", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(values, 50), 50);
    assert.equal(percentile(values, 95), 95);
    assert.equal(percentile(values, 99), 99);
    assert.equal(percentile([7], 99), 7);
    assert.equal(percentile([], 50), null);
  });

  it("does not reorder its input", () => {
    const values = [3, 1, 2];
    summarize(values);
    assert.deepEqual(values, [3, 1, 2]);
  });
});

describe("command line", () => {
  it("parses every option", () => {
    assert.deepEqual(
      parseArgs(["--hosting", HOSTING, "--direct", DIRECT, "--samples", "10", "--require-ready", "--max-added-p95-ms", "250"]),
      { hosting: HOSTING, direct: DIRECT, samples: 10, requireReady: true, maxAddedP95Ms: 250 },
    );
  });

  it("applies defaults", () => {
    assert.deepEqual(parseArgs(["--hosting", HOSTING]), { hosting: HOSTING, samples: 30, requireReady: false, maxAddedP95Ms: null });
  });

  it("rejects bad input", () => {
    assert.throws(() => parseArgs([]), /--hosting/);
    assert.throws(() => parseArgs(["--hosting"]), /needs a value/);
    assert.throws(() => parseArgs(["--hosting", HOSTING, "--nope"]), /Unknown argument/);
    assert.throws(() => parseArgs(["--hosting", HOSTING, "--samples", "0"]), /--samples/);
    assert.throws(() => parseArgs(["--hosting", HOSTING, "--samples", "1.5"]), /--samples/);
    assert.throws(() => parseArgs(["--hosting", HOSTING, "--max-added-p95-ms", "-1"]), /non-negative/);
    assert.throws(() => parseArgs(["--hosting", HOSTING, "--max-added-p95-ms", "100"]), /needs --direct/);
  });

  it("formats a report with a verdict per check and the latency table", async () => {
    const report = await run(site(), { direct: DIRECT });
    const text = formatReport(report);
    assert.match(text, /^PASS {2}GET \/live returns JSON status alive/m);
    assert.match(text, /through Hosting: p50 80 ms/);
    assert.match(text, /added by Hosting: p50 50 ms, p95 50 ms/);
    const broken = formatReport(await run(site({ override: (p) => (p === "/live" ? html(200) : undefined) })));
    assert.match(broken, /^FAIL {2}GET \/live/m);
  });
});
