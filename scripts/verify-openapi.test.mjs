import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { documentedOperations, missingBaselineStatuses, registeredOperations, verifyApiReference, verifyOpenApi } from "./verify-openapi.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(readFileSync(resolve(root, "backend/openapi.json"), "utf8"));
const apiReference = readFileSync(resolve(root, "backend/API.md"), "utf8");

test("every /api operation declares the statuses shared middleware can emit", async () => {
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (typeof operation !== "object" || !operation.responses) continue;
      assert.deepEqual(missingBaselineStatuses(path, operation), [], `${method.toUpperCase()} ${path}`);
    }
  }
  // GET bodies are parsed too: the global JSON parser runs before every handler.
  const missing = structuredClone(spec);
  delete missing.paths["/api/v2/feedback"].get.responses["415"];
  await assert.rejects(verifyOpenApi(missing), /GET \/api\/v2\/feedback: missing middleware statuses 415/);
  const bearer = structuredClone(spec);
  delete bearer.paths["/api/v2/ride-sessions/{sessionId}"].get.responses["503"];
  await assert.rejects(verifyOpenApi(bearer), /GET \/api\/v2\/ride-sessions\/\{sessionId\}: missing middleware statuses 503/);
  // Public probes outside /api have no parser/admission baseline.
  assert.deepEqual(missingBaselineStatuses("/health", { responses: { 200: {} }, security: [] }), []);
});

test("backend/API.md documents every operation with OpenAPI path parameter names", () => {
  verifyApiReference(spec, apiReference);
  assert.ok(documentedOperations("Use `PATCH /api/requests/:id`.").has("PATCH /api/requests/{id}"));
  assert.throws(
    () => verifyApiReference(spec, apiReference.replaceAll("firmware/installation", "firmware/install")),
    /Undocumented: POST \/api\/devices\/\{deviceId\}\/firmware\/installation.*unknown: POST \/api\/devices\/\{deviceId\}\/firmware\/install/,
  );
  assert.throws(
    () => verifyApiReference(spec, `${apiReference}\n\n### \`DELETE /api/requests/:uid\`\n`),
    /unknown: DELETE \/api\/requests\/\{uid\}/,
  );
});

test("validates the published contract against mounted Express routers", async () => {
  const count = await verifyOpenApi(spec);
  assert.equal(count, registeredOperations().length);
  assert.ok(count >= 45);
});

test("a newly registered handler fails until documented", async () => {
  const registered = registeredOperations(root, (filename, encoding) => {
    const text = readFileSync(filename, encoding);
    return filename.endsWith("server.ts") ? `${text}\napp.get('/api/new-resource', handler);` : text;
  });
  await assert.rejects(verifyOpenApi(spec, registered), /Missing: GET \/api\/new-resource/);
});

test("changed mount prefixes and named v2 router exports are reconciled", async () => {
  const registered = registeredOperations(root, (filename, encoding) => {
    const text = readFileSync(filename, encoding);
    return filename.endsWith("server.ts") ? text.replace('"/api/v2/settings/global"', '"/api/v3/settings/global"') : text;
  });
  await assert.rejects(verifyOpenApi(spec, registered), /Missing: PATCH \/api\/v3\/settings\/global.*stale: PATCH \/api\/v2\/settings\/global/);
});

test("removed operations and duplicate registrations fail", async () => {
  const registered = registeredOperations();
  await assert.rejects(verifyOpenApi(spec, registered.slice(1)), /stale:/);
  await assert.rejects(verifyOpenApi(spec, [...registered, registered[0]]), /duplicate registrations: GET/);
});

test("dynamic paths and unsupported chained registrations fail closed", () => {
  for (const extra of ["app.get(dynamicPath, handler);", "app.route('/dynamic').get(handler);", "app[dynamicMethod]('/dynamic', handler);"]) {
    assert.throws(() => registeredOperations(root, (filename, encoding) => {
      const text = readFileSync(filename, encoding);
      return filename.endsWith("server.ts") ? `${text}\n${extra}` : text;
    }), /explicit.*support/);
  }
});

test("dynamic router mount paths fail closed", () => {
  assert.throws(() => registeredOperations(root, (filename, encoding) => {
    const text = readFileSync(filename, encoding);
    return filename.endsWith("server.ts") ? text.replace('app.use("/api/buses",', 'app.use(dynamicMount,') : text;
  }), /dynamic mount/);
});

test("broken references and missing operational policy fail", async () => {
  const broken = structuredClone(spec);
  broken.paths["/health"].get.responses[200].content["application/json"].schema = { $ref: "#/components/schemas/DoesNotExist" };
  await assert.rejects(verifyOpenApi(broken));
  const incomplete = structuredClone(spec);
  delete incomplete.paths["/health"].get["x-retry-policy"];
  await assert.rejects(verifyOpenApi(incomplete), /missing x-retry-policy/);
});

test("routers mounted from a route-module factory call fail closed instead of vanishing", () => {
  // `app.use("/api/x", buildRouter())` registers real handlers. Skipping the
  // call silently would let an undocumented route pass the contract check.
  assert.throws(() => registeredOperations(root, (filename, encoding) => {
    if (filename.endsWith("factoryMounted.ts")) {
      return 'import { Router } from "express";\nexport function buildFactoryRouter() { const router = Router(); router.get("/hidden", handler); return router; }';
    }
    const text = readFileSync(filename, encoding);
    return filename.endsWith("server.ts")
      ? `import { buildFactoryRouter } from "./routes/factoryMounted";\n${text}\napp.use("/api/factory-mounted", buildFactoryRouter());`
      : text;
  }), /explicit inventory support/);
  // Middleware factories from outside the route modules stay allowed.
  assert.ok(registeredOperations().length > 0);
});
