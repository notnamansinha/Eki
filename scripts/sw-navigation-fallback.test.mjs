// Behavioural tests for the service worker's navigation handler, run against
// the real Workbox 7 strategies (NetworkFirst, StrategyHandler and
// CacheableResponsePlugin) with a fake network, Cache Storage, precache and
// clock. The expiry plugin is stubbed because it needs IndexedDB.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// The shipped worker is bundled in production mode (scripts/generate-sw.mjs);
// Workbox's development-only logging and assertions need browser globals.
process.env.NODE_ENV = "production";
globalThis.self = globalThis;
globalThis.FetchEvent ??= class FetchEvent {};

const strategies = await import("workbox-strategies");
const { CacheableResponsePlugin } = await import("workbox-cacheable-response");
const source = (await readFile(new URL("../frontend/src/sw.js", import.meta.url), "utf8"))
  .replace(/import\s+[\s\S]*?\s+from\s+"[^"]+";/g, "");

const ORIGIN = "https://app.example.test";
const NAVIGATION_CACHE = "eki-navigations";
const PRECACHE = new Map([
  ["/index.html", "<html>root shell</html>"],
  ["/passenger.html", "<html>passenger shell</html>"],
]);

function createCacheStorage() {
  const stores = new Map();
  const keyOf = (request) => (typeof request === "string" ? request : request.url);
  const open = async (name) => {
    if (!stores.has(name)) {
      const entries = new Map();
      stores.set(name, {
        entries,
        match: async (request) => entries.get(keyOf(request))?.clone(),
        put: async (request, response) => { entries.set(keyOf(request), response); },
        delete: async (request) => entries.delete(keyOf(request)),
      });
    }
    return stores.get(name);
  };
  return {
    open,
    has: async (name) => stores.has(name),
    delete: async (name) => stores.delete(name),
    async match(request, { cacheName } = {}) {
      for (const name of cacheName ? [cacheName] : [...stores.keys()]) {
        const hit = await stores.get(name)?.match(request);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

function track(promise) {
  const state = { done: false };
  promise.then(
    (value) => Object.assign(state, { done: true, value }),
    (error) => Object.assign(state, { done: true, error }),
  );
  return state;
}

// Let every queued promise reaction (including Workbox's) run.
async function settle() {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

function loadWorker(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const routes = [];
  const caches = createCacheStorage();
  globalThis.caches = caches;
  let respond = () => {};
  globalThis.fetch = () => new Promise((resolve, reject) => { respond = { resolve, reject }; });
  class Stub { constructor(options = {}) { this.options = options; } }
  class NavigationRoute { constructor(handler, options) { this.handler = handler; this.options = options; } }
  runInNewContext(source, {
    self: { location: { origin: ORIGIN }, addEventListener() {} },
    caches,
    URL,
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    NavigationRoute,
    NetworkFirst: strategies.NetworkFirst,
    StrategyHandler: strategies.StrategyHandler,
    NetworkOnly: Stub,
    CacheFirst: Stub,
    StaleWhileRevalidate: Stub,
    CacheableResponsePlugin,
    ExpirationPlugin: Stub,
    cleanupOutdatedCaches() {},
    precacheAndRoute() {},
    setDefaultHandler() {},
    matchPrecache: async (url) => (PRECACHE.has(url) ? html(PRECACHE.get(url)) : undefined),
    registerRoute: (match, strategy) => routes.push({ match, strategy }),
  });
  const route = routes.find(({ match }) => match instanceof NavigationRoute).match;

  return {
    caches,
    network: () => respond,
    async advance(ms) {
      await settle();
      t.mock.timers.tick(ms);
      await settle();
    },
    navigate(path) {
      const url = new URL(path, ORIGIN);
      const request = new Request(url);
      const lifetimes = [];
      const event = { request, waitUntil: (promise) => { lifetimes.push(track(promise)); } };
      return { lifetimes, response: track(route.handler({ url, request, event, params: undefined })) };
    },
    async runtimeCached(path) {
      return (await (await caches.open(NAVIGATION_CACHE)).match(new URL(path, ORIGIN).href))?.text();
    },
  };
}

test("a hanging network is answered with the route's precached shell within 2.5 s", async (t) => {
  // eki-navigations is emptied on every activation, so the first reopen after
  // a deploy has only the precache. Workbox's own networkTimeoutSeconds then
  // keeps waiting for the network indefinitely.
  for (const [path, shell] of [["/passenger?utm=qr", "passenger shell"], ["/", "root shell"]]) {
    const worker = loadWorker(t);
    const { response } = worker.navigate(path);
    await worker.advance(2499);
    assert.equal(response.done, false, `${path} must give the network its full budget`);
    await worker.advance(1);
    assert.equal(response.done, true, `${path} is still waiting for the network after 2.5 s`);
    assert.equal(await response.value.text(), `<html>${shell}</html>`);
    t.mock.timers.reset();
  }
});

test("a hanging network is answered with the runtime-cached copy before the precached shell", async (t) => {
  const worker = loadWorker(t);
  await (await worker.caches.open(NAVIGATION_CACHE))
    .put(`${ORIGIN}/passenger`, html("<html>runtime copy</html>"));
  const { response } = worker.navigate("/passenger?utm=qr");
  await worker.advance(2500);
  assert.equal(response.done, true, "navigation is still waiting for the network after 2.5 s");
  assert.equal(await response.value.text(), "<html>runtime copy</html>");
});

test("a late network response still refreshes the runtime cache while the fetch event stays alive", async (t) => {
  const worker = loadWorker(t);
  const { response, lifetimes } = worker.navigate("/passenger?utm=qr");
  await worker.advance(2500);
  assert.equal(response.done, true, "navigation is still waiting for the network after 2.5 s");
  assert.equal(await response.value.text(), "<html>passenger shell</html>");
  assert.ok(lifetimes.some((lifetime) => !lifetime.done),
    "the fetch event must stay alive until the network response is stored");

  worker.network().resolve(html("<html>fresh deploy</html>"));
  for (let tick = 0; tick < 5; tick += 1) await worker.advance(1);
  assert.ok(lifetimes.every((lifetime) => lifetime.done && !lifetime.error));
  assert.equal(await worker.runtimeCached("/passenger"), "<html>fresh deploy</html>");
});

test("a network response inside the budget is served and cached under a query-free key", async (t) => {
  const worker = loadWorker(t);
  await (await worker.caches.open(NAVIGATION_CACHE))
    .put(`${ORIGIN}/passenger`, html("<html>runtime copy</html>"));
  const { response } = worker.navigate("/passenger?utm=qr");
  await worker.advance(1000);
  worker.network().resolve(html("<html>fresh deploy</html>"));
  await worker.advance(1);
  assert.equal(response.done, true);
  assert.equal(await response.value.text(), "<html>fresh deploy</html>");
  await worker.advance(2500);
  assert.equal(await worker.runtimeCached("/passenger"), "<html>fresh deploy</html>");
});

test("a network failure still falls back to the precached shell, then the root shell", async (t) => {
  for (const [path, shell] of [["/passenger", "passenger shell"], ["/no-such-page", "root shell"]]) {
    const worker = loadWorker(t);
    const { response } = worker.navigate(path);
    await worker.advance(1);
    worker.network().reject(new TypeError("Failed to fetch"));
    await worker.advance(1);
    assert.equal(response.done, true, `${path} must fall back as soon as the network fails`);
    assert.equal(await response.value.text(), `<html>${shell}</html>`);
    t.mock.timers.reset();
  }
});

test("with no cached copy of the route, a slow navigation keeps waiting for the network", async (t) => {
  // An unknown path must not be answered with the root shell while Hosting may
  // still return the real response (for example its 404 page).
  const worker = loadWorker(t);
  const { response } = worker.navigate("/no-such-page");
  await worker.advance(2500);
  assert.equal(response.done, false);
  await worker.advance(10_000);
  assert.equal(response.done, false);
  worker.network().resolve(html("<html>not found</html>", 404));
  await worker.advance(1);
  assert.equal(response.done, true);
  assert.equal(response.value.status, 404);
  assert.equal(await response.value.text(), "<html>not found</html>");
});
