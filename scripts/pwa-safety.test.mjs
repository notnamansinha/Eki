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

test("worker updates wait for active tabs without forcing a reload", () => {
  assert.doesNotMatch(registrar, /SKIP_WAITING|controllerchange|location\.reload/);
  assert.doesNotMatch(worker, /skipWaiting\(\)|clientsClaim\(\)/);
  assert.doesNotMatch(worker, /controllerchange|location\.reload/);
});

test("activating a new worker retires the previous deployment's navigation HTML", async () => {
  // Offline or slow (>3 s) navigations fall back to the NetworkFirst cache.
  // HTML cached under the previous worker references hashed chunks that the
  // new worker's precache cleanup has already deleted and Hosting no longer
  // serves, so it must not outlive the deployment that produced it.
  const events = new Map(), deleted = [];
  class Strategy { constructor(options) { this.options = options; } }
  class NavigationRoute { constructor(handler, options) { this.handler = handler; this.options = options; } }
  const strategies = [];
  class NetworkFirst extends Strategy { constructor(options) { super(options); strategies.push(this); } }
  const { runInNewContext } = await import("node:vm");
  runInNewContext(worker.replace(/import\s+[\s\S]*?\s+from\s+"[^"]+";/g, ""), {
    self: { location: { origin: "https://app.example.test" }, addEventListener: (name, callback) => events.set(name, callback) },
    caches: { delete: async name => { deleted.push(name); return true; } },
    URL, NavigationRoute, NetworkFirst, NetworkOnly: Strategy, CacheFirst: Strategy,
    StaleWhileRevalidate: Strategy, ExpirationPlugin: Strategy, CacheableResponsePlugin: Strategy,
    cleanupOutdatedCaches() {}, precacheAndRoute() {}, matchPrecache() {}, setDefaultHandler() {}, registerRoute() {},
  });
  const navigationCache = strategies.find(strategy => strategy.options?.cacheName)?.options.cacheName;
  assert.equal(navigationCache, "eki-navigations");
  let activation;
  events.get("activate")({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.ok(deleted.includes(navigationCache), "navigation cache must be cleared on activate");
});

async function loadWorkerRoutes() {
  const routes = [], events = new Map(), deleted = [];
  class Strategy { constructor(options = {}) { this.options = options; } }
  class NetworkOnly extends Strategy {}
  class NetworkFirst extends Strategy {}
  class CacheFirst extends Strategy {}
  class StaleWhileRevalidate extends Strategy {}
  class ExpirationPlugin { constructor(options) { this.options = options; } }
  class CacheableResponsePlugin { constructor(options) { this.options = options; } }
  class NavigationRoute { constructor(handler, options) { this.handler = handler; this.options = options; } }
  const strategies = [];
  const track = Base => class extends Base { constructor(options) { super(options); strategies.push(this); } };
  const { runInNewContext } = await import("node:vm");
  runInNewContext(worker.replace(/import\s+[\s\S]*?\s+from\s+"[^"]+";/g, ""), {
    self: { location: { origin: "https://app.example.test" }, addEventListener: (name, callback) => events.set(name, callback) },
    caches: { delete: async name => { deleted.push(name); return true; } },
    URL, NavigationRoute, NetworkOnly, NetworkFirst: track(NetworkFirst), CacheFirst: track(CacheFirst),
    StaleWhileRevalidate: track(StaleWhileRevalidate), ExpirationPlugin, CacheableResponsePlugin,
    cleanupOutdatedCaches() {}, precacheAndRoute() {}, matchPrecache() {}, setDefaultHandler() {},
    registerRoute: (match, strategy) => routes.push({ match, strategy }),
  });
  const routeFor = (href, destination = "") => routes.find(({ match }) =>
    typeof match === "function" && match({ url: new URL(href), request: { destination } }));
  return { routes, strategies, events, deleted, routeFor, NetworkOnly, ExpirationPlugin, CacheableResponsePlugin };
}

test("navigation HTML cache is bounded and keyed per app shell, not per query string", async () => {
  // A static export serves the same HTML whatever the query string, so UTM/QR
  // parameters must not each store another full HTML entry.
  const { strategies, ExpirationPlugin } = await loadWorkerRoutes();
  const navigation = strategies.find(strategy => strategy.options.cacheName === "eki-navigations");
  assert.ok(navigation, "navigation strategy must exist");
  const plugins = navigation.options.plugins ?? [];
  const expiration = plugins.find(plugin => plugin instanceof ExpirationPlugin);
  assert.ok(expiration, "navigation cache needs an ExpirationPlugin");
  assert.ok(Number.isFinite(expiration.options.maxEntries) && expiration.options.maxEntries <= 20);
  const keyPlugin = plugins.find(plugin => typeof plugin.cacheKeyWillBeUsed === "function");
  assert.ok(keyPlugin, "navigation cache needs a query-stripping cache key");
  const keys = new Set();
  for (let index = 0; index < 40; index += 1) {
    const key = await keyPlugin.cacheKeyWillBeUsed({
      request: new Request(`https://app.example.test/passenger?utm=${index}`), mode: "write",
    });
    keys.add(typeof key === "string" ? key : key.url);
  }
  assert.deepEqual([...keys], ["https://app.example.test/passenger"]);
});

test("Google Maps loader, tiles and icons are never runtime-cached", async () => {
  // These are no-cors requests: the worker sees opaque status-0 responses and
  // cannot tell an upstream 503/403 from success, so caching one would replay
  // a broken map after the upstream recovers.
  const { routeFor, NetworkOnly } = await loadWorkerRoutes();
  for (const href of [
    "https://maps.googleapis.com/maps/api/js?key=AIzaFAKE&v=weekly&libraries=marker&callback=google.maps.__ib__",
    "https://maps.googleapis.com/maps/vt?pb=!1m5",
    "https://maps.gstatic.com/mapfiles/transparent.png",
    "https://lh3.ggpht.com/icon.png",
  ]) {
    const route = routeFor(href, href.includes("/api/js") ? "script" : "image");
    assert.ok(!route || route.strategy instanceof NetworkOnly, `${href} must stay network-only`);
  }
});

test("cross-origin caching routes never store opaque responses", async () => {
  const { routeFor, NetworkOnly, CacheableResponsePlugin, ExpirationPlugin } = await loadWorkerRoutes();
  for (const href of [
    "https://fonts.googleapis.com/css2?family=Inter",
    "https://fonts.gstatic.com/s/inter/v1/font.woff2",
    "https://maps.googleapis.com/maps/vt?pb=!1m5",
    "https://maps.gstatic.com/mapfiles/transparent.png",
  ]) {
    const route = routeFor(href, "image");
    if (!route || route.strategy instanceof NetworkOnly) continue;
    const plugins = route.strategy.options.plugins ?? [];
    const cacheable = plugins.find(plugin => plugin instanceof CacheableResponsePlugin);
    assert.ok(cacheable, `${href} caching route needs a CacheableResponsePlugin`);
    assert.ok(!cacheable.options.statuses.includes(0), `${href} must not cache opaque responses`);
    const expiration = plugins.find(plugin => plugin instanceof ExpirationPlugin);
    if (expiration) assert.equal(expiration.options.purgeOnQuotaError, true);
  }
});

test("activation evicts Google Maps responses cached by earlier workers", async () => {
  const { events, deleted } = await loadWorkerRoutes();
  let activation;
  events.get("activate")({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.ok(deleted.includes("eki-google-maps"));
});
