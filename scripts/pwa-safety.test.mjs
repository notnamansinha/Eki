import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [generator, registrar, worker] = await Promise.all([
  readFile(new URL("./generate-sw.mjs", import.meta.url), "utf8"),
  readFile(new URL("../frontend/src/components/ServiceWorkerRegistrar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../frontend/src/sw.js", import.meta.url), "utf8"),
]);

test("keeps role-specific chunks out of the install precache", () => {
  assert.doesNotMatch(generator, /_next\/static\/\*\*\/\*\.\{js,css\}/);
  assert.match(generator, /PRECACHE_BUDGET_BYTES/);
  assert.match(worker, /eki-next-static/);
  assert.match(worker, /url\.pathname\.startsWith\("\/_next\/static\/"\)/);
});

test("never forces a waiting worker to reload an active tab", () => {
  assert.doesNotMatch(registrar, /SKIP_WAITING|controllerchange|location\.reload/);
  assert.doesNotMatch(worker, /skipWaiting|SKIP_WAITING/);
});
