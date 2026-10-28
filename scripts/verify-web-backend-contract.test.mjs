import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  assertWebBackendContract,
  connectSourcesFromCsp,
  verifyBackendAvailability,
} from "./verify-web-backend-contract.mjs";

function config(csp) {
  return {
    hosting: {
      headers: [{
        source: "**",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      }],
    },
  };
}

describe("web/backend deployment contract", () => {
  it("extracts only connect-src tokens", () => {
    assert.deepEqual(
      connectSourcesFromCsp("default-src 'self'; connect-src 'self' https://api.test; img-src data:;"),
      ["'self'", "https://api.test"],
    );
  });

  it("accepts the exact configured backend origin", () => {
    assert.deepEqual(
      assertWebBackendContract(
        config("default-src 'self'; connect-src 'self' https://api.test;"),
        "https://api.test/v1",
        true,
      ),
      { checked: true, origin: "https://api.test" },
    );
  });

  it("rejects a missing origin and an unset strict production URL", () => {
    assert.throws(() => assertWebBackendContract(
      config("connect-src 'self' https://old.test;"),
      "https://api.test",
      true,
    ));
    assert.throws(() => assertWebBackendContract(config("connect-src 'self';"), "", true));
  });
});

const execute = promisify(execFile);

/**
 * Runs the real verifier CLI in an isolated repo layout. The temp tree stays
 * below the workspace so `@next/env` resolves through the root node_modules.
 */
async function runVerifier({ envFiles = {}, csp, shell = {} }) {
  const scratch = fileURLToPath(new URL("../temp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "eki-contract-"));
  try {
    await mkdir(path.join(root, "scripts"));
    await mkdir(path.join(root, "frontend"));
    for (const file of ["verify-web-backend-contract.mjs", "csp-backend-origin.mjs", "load-frontend-env.mjs"])
      await copyFile(new URL(file, import.meta.url), path.join(root, "scripts", file));
    for (const [name, contents] of Object.entries(envFiles))
      await writeFile(path.join(root, "frontend", name), contents);
    await writeFile(path.join(root, "firebase.json"), JSON.stringify(config(csp)));
    const env = { ...process.env, ...shell };
    for (const name of ["NEXT_PUBLIC_BACKEND_URL", "EKI_STRICT_PRODUCTION_BUILD", "EKI_RUNTIME_SMOKE", "NODE_ENV"])
      if (!(name in shell)) delete env[name];
    try {
      const { stdout } = await execute(process.execPath, [path.join(root, "scripts/verify-web-backend-contract.mjs")], { env });
      return { code: 0, output: stdout };
    } catch (error) {
      return { code: error.code, output: `${error.stdout}${error.stderr}` };
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("web/backend contract CLI resolves the URL the way next build does", () => {
  it("checks a backend URL that only frontend/.env.local configures", async () => {
    const result = await runVerifier({
      envFiles: { ".env.local": "NEXT_PUBLIC_BACKEND_URL=http://localhost:4000\n" },
      csp: "default-src 'self'; connect-src 'self';",
    });
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /missing from CSP connect-src/);
    assert.doesNotMatch(result.output, /skipped/);
  });

  it("passes when the CSP contains the env-file origin", async () => {
    const result = await runVerifier({
      envFiles: { ".env.local": "NEXT_PUBLIC_BACKEND_URL=http://localhost:4000\n" },
      csp: "default-src 'self'; connect-src 'self' http://localhost:4000;",
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /contract verified/);
  });

  it("lets the strict production gate accept a URL from frontend/.env.production", async () => {
    const result = await runVerifier({
      envFiles: { ".env.production": "NEXT_PUBLIC_BACKEND_URL=https://api.example.test\n" },
      csp: "default-src 'self'; connect-src 'self' https://api.example.test;",
      shell: { EKI_STRICT_PRODUCTION_BUILD: "true" },
    });
    assert.equal(result.code, 0, result.output);
  });

  it("keeps a shell value ahead of frontend env files, as next build does", async () => {
    const result = await runVerifier({
      envFiles: { ".env.local": "NEXT_PUBLIC_BACKEND_URL=http://localhost:4000\n" },
      csp: "default-src 'self'; connect-src 'self' https://api.example.test;",
      shell: { NEXT_PUBLIC_BACKEND_URL: "https://api.example.test" },
    });
    assert.equal(result.code, 0, result.output);
  });

  it("skips only when neither the shell nor any frontend env file sets the URL", async () => {
    const result = await runVerifier({ csp: "default-src 'self'; connect-src 'self';" });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /skipped: no NEXT_PUBLIC_BACKEND_URL in the shell or frontend\/\.env\* files/);
  });
});

describe("live backend release preflight", () => {
  const origin = "https://api.example.test";
  const frontend = "https://eki.example.test";
  const healthy = () => new Response(JSON.stringify({ status: "ok" }), {
    headers: { "access-control-allow-origin": frontend },
  });
  const allowed = () => new Response(null, { status: 204, headers: {
    "access-control-allow-origin": frontend,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Authorization,Content-Type,Ngrok-Skip-Browser-Warning",
  } });

  it("checks readiness and an actual browser preflight without writing data", async () => {
    const calls = [];
    await verifyBackendAvailability(origin, frontend, async (url, init) => {
      calls.push([url, init]);
      return calls.length === 1 ? healthy() : allowed();
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], `${origin}/health`);
    assert.equal(calls[1][0], `${origin}/api/users/bootstrap`);
    assert.equal(calls[1][1].method, "OPTIONS");
    assert.equal(calls[1][1].headers.Origin, frontend);
    assert.equal(calls[1][1].body, undefined);
    assert.equal(calls[0][1].redirect, "error");
    assert.equal(calls[1][1].headers["Access-Control-Request-Headers"], "authorization,content-type");
  });

  it("includes the browser's ngrok interstitial bypass header only for ngrok", async () => {
    const calls = [];
    await verifyBackendAvailability("https://example.ngrok-free.dev", frontend, async (url, init) => {
      calls.push([url, init]); return calls.length === 1 ? healthy() : allowed();
    });
    assert.equal(calls[0][1].headers["ngrok-skip-browser-warning"], "1");
    assert.match(calls[1][1].headers["Access-Control-Request-Headers"], /ngrok-skip-browser-warning/);
  });

  it("rejects dead DNS and degraded or misleading health responses", async () => {
    await assert.rejects(verifyBackendAvailability(origin, frontend, async () => { throw new TypeError("fetch failed"); }));
    for (const response of [
      new Response('{"status":"degraded"}', { status: 503 }),
      new Response('{"status":"degraded"}'),
      new Response('<html>Tunnel offline</html>'),
    ]) await assert.rejects(verifyBackendAvailability(origin, frontend, async () => response));
  });

  it("rejects healthy APIs that the deployed browser cannot access", async () => {
    await assert.rejects(verifyBackendAvailability(origin, frontend, async () => new Response('{"status":"ok"}')), /CORS/);
    for (const missing of ["access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers"]) {
      let calls = 0;
      await assert.rejects(verifyBackendAvailability(origin, frontend, async () => {
        if (++calls === 1) return healthy();
        const response = allowed(); response.headers.delete(missing); return response;
      }), /preflight/);
    }
  });

  it("requires an explicit frontend origin", async () => {
    await assert.rejects(verifyBackendAvailability(origin, undefined), /EKI_FRONTEND_ORIGIN/);
    await assert.rejects(verifyBackendAvailability(origin, `${frontend}/path`), /EKI_FRONTEND_ORIGIN/);
  });
});
