import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [generator, registrar, worker] = await Promise.all([
  readFile(new URL("./generate-sw.mjs", import.meta.url), "utf8"),
  readFile(new URL("../frontend/src/components/ServiceWorkerRegistrar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../frontend/src/sw.js", import.meta.url), "utf8"),
]);

test("precaches each exported shell's immutable bootstrap chunks", () => {
  assert.match(generator, /bootstrapShellEntries/);
  assert.match(generator, /const bootstrap = await bootstrapShellEntries\(\)/);
  assert.match(generator, /additionalManifestEntries: bootstrap\.entries/);
  assert.match(generator, /result\.size \+ bootstrap\.size/);
  assert.match(generator, /html\.matchAll/);
  assert.match(generator, /exceeds the 1 MB precache-file limit/);
  assert.match(generator, /_next\\\/static/);
  assert.match(generator, /PRECACHE_BUDGET_BYTES/);
  assert.match(generator, /"icon\*\.png"/);
  assert.doesNotMatch(generator, /"\*\.webp"/);
  assert.match(worker, /eki-next-static/);
  assert.match(worker, /url\.pathname\.startsWith\("\/_next\/static\/"\)/);
});

test("never forces a waiting worker to reload an active tab", () => {
  assert.doesNotMatch(registrar, /SKIP_WAITING|controllerchange|location\.reload/);
  assert.doesNotMatch(worker, /skipWaiting|SKIP_WAITING/);
});
