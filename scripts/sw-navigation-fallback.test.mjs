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

// What Cache Storage rejects with under storage pressure or on a restricted
// iOS profile.
const storageFailure = () => new DOMException("Unexpected internal error.", "UnknownError");

function loadWorker(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const routes = [];
  const caches = createCacheStorage();
  globalThis.caches = caches;
  // Reads to make reject: the runtime cache (read through Workbox's
  // StrategyHandler) and precached URLs.
  const unreadable = { runtime: false, precache: new Set() };
  const matchRuntime = caches.match;
  caches.match = async (...args) => {
    if (unreadable.runtime) throw storageFailure();
    return matchRuntime(...args);
  };
  // The worker's own timers that have neither fired nor been cleared.
  const pendingTimers = new Set();
  let respond = () => {};
  globalThis.fetch = () => new Promise((resolve, reject) => { respond = { resolve, reject }; });
  class Stub { constructor(options = {}) { this.options = options; } }
  class NavigationRoute { constructor(handler, options) { this.handler = handler; this.options = options; } }
  runInNewContext(source, {
    self: { location: { origin: ORIGIN }, addEventListener() {} },
    caches,
    URL,
    setTimeout: (callback, ms, ...args) => {
      const id = globalThis.setTimeout((...values) => {
        pendingTimers.delete(id);
        callback(...values);
      }, ms, ...args);
      pendingTimers.add(id);
      return id;
    },
    clearTimeout: (id) => {
      pendingTimers.delete(id);
      globalThis.clearTimeout(id);
    },
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
    matchPrecache: async (url) => {
      if (unreadable.precache.has(url)) throw storageFailure();
      return PRECACHE.has(url) ? html(PRECACHE.get(url)) : undefined;
    },
    registerRoute: (match, strategy) => routes.push({ match, strategy }),
  });
  const route = routes.find(({ match }) => match instanceof NavigationRoute).match;

  return {
    caches,
    unreadable,
    pendingTimers: () => pendingTimers.size,
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

test("a hanging network is answered with the precached shell before the runtime-cached copy", async (t) => {
  // Activation empties the runtime cache, so a copy there that differs from
  // the shell came from a newer deploy whose chunks this worker has not cached.
  const worker = loadWorker(t);
  await (await worker.caches.open(NAVIGATION_CACHE))
    .put(`${ORIGIN}/passenger`, html("<html>runtime copy</html>"));
  const { response } = worker.navigate("/passenger?utm=qr");
  await worker.advance(2500);
  assert.equal(response.done, true, "navigation is still waiting for the network after 2.5 s");
  assert.equal(await response.value.text(), "<html>passenger shell</html>");
});

// On a flaky network the first open gets the shell while the late response,
// from a deploy newer than this worker, is stored unrendered. If a later open
// served that HTML, its uncached chunks would have to come over the same
// flaky network (or none at all) and the page would sit unhydrated.
async function storeNewerDeployLate(worker) {
  const first = worker.navigate("/passenger?utm=qr");
  await worker.advance(2500);
  assert.equal(await first.response.value.text(), "<html>passenger shell</html>");
  worker.network().resolve(html("<html>newer deploy</html>"));
  for (let tick = 0; tick < 5; tick += 1) await worker.advance(1);
  assert.equal(await worker.runtimeCached("/passenger"), "<html>newer deploy</html>");
}

test("a newer deploy's HTML stored after one slow navigation is not served to the next one", async (t) => {
  const worker = loadWorker(t);
  await storeNewerDeployLate(worker);
  const second = worker.navigate("/passenger");
  await worker.advance(2500);
  assert.equal(second.response.done, true, "navigation is still waiting for the network after 2.5 s");
  assert.equal(await second.response.value.text(), "<html>passenger shell</html>");
});

test("a newer deploy's HTML stored after one slow navigation is not served when the next fetch fails", async (t) => {
  // NetworkFirst answers a failed fetch from its runtime cache by itself.
  const worker = loadWorker(t);
  await storeNewerDeployLate(worker);
  const second = worker.navigate("/passenger");
  await worker.advance(1);
  worker.network().reject(new TypeError("Failed to fetch"));
  await worker.advance(1);
  assert.equal(second.response.done, true, "/passenger must fall back as soon as the network fails");
  assert.equal(second.response.error, undefined);
  assert.equal(await second.response.value.text(), "<html>passenger shell</html>");
});

test("a route with no precached shell is answered with its runtime-cached copy within 2.5 s", async (t) => {
  const worker = loadWorker(t);
  await (await worker.caches.open(NAVIGATION_CACHE))
    .put(`${ORIGIN}/unshelled-route`, html("<html>runtime copy</html>"));
  const { response } = worker.navigate("/unshelled-route?utm=qr");
  await worker.advance(2500);
  assert.equal(response.done, true, "navigation is still waiting for the network after 2.5 s");
  assert.equal(await response.value.text(), "<html>runtime copy</html>");
});

test("a route with no precached shell still gets its runtime-cached copy when the fetch fails", async (t) => {
  const worker = loadWorker(t);
  await (await worker.caches.open(NAVIGATION_CACHE))
    .put(`${ORIGIN}/unshelled-route`, html("<html>runtime copy</html>"));
  const { response } = worker.navigate("/unshelled-route?utm=qr");
  await worker.advance(1);
  worker.network().reject(new TypeError("Failed to fetch"));
  await worker.advance(1);
  assert.equal(response.done, true, "/unshelled-route must fall back as soon as the network fails");
  assert.equal(response.error, undefined);
  assert.equal(await response.value.text(), "<html>runtime copy</html>");
});

test("an unreadable precached shell falls through to the runtime-cached copy within 2.5 s", async (t) => {
  const worker = loadWorker(t);
  worker.unreadable.precache.add("/passenger.html");
  await (await worker.caches.open(NAVIGATION_CACHE))
    .put(`${ORIGIN}/passenger`, html("<html>runtime copy</html>"));
  const { response } = worker.navigate("/passenger?utm=qr");
  await worker.advance(2500);
  assert.equal(response.done, true, "navigation is still waiting for the network after 2.5 s");
  assert.equal(response.error, undefined);
  assert.equal(await response.value.text(), "<html>runtime copy</html>");
});

test("an unreadable precached shell keeps the runtime-cached copy when the fetch fails", async (t) => {
  const worker = loadWorker(t);
  worker.unreadable.precache.add("/passenger.html");
  await (await worker.caches.open(NAVIGATION_CACHE))
    .put(`${ORIGIN}/passenger`, html("<html>runtime copy</html>"));
  const { response } = worker.navigate("/passenger?utm=qr");
  await worker.advance(1);
  worker.network().reject(new TypeError("Failed to fetch"));
  await worker.advance(1);
  assert.equal(response.done, true, "/passenger must fall back as soon as the network fails");
  assert.equal(response.error, undefined);
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

test("an unreadable cache at the 2.5 s budget is a miss, so the navigation keeps waiting for the network", async (t) => {
  // The cached copy is only a shortcut: a read that rejects must not fail a
  // navigation Hosting is still answering.
  const worker = loadWorker(t);
  worker.unreadable.runtime = true;
  worker.unreadable.precache.add("/passenger.html");
  const { response } = worker.navigate("/passenger?utm=qr");
  await worker.advance(2500);
  assert.equal(response.done, false, "an unreadable cache failed the navigation");
  worker.network().resolve(html("<html>fresh deploy</html>"));
  await worker.advance(1);
  assert.equal(response.done, true);
  assert.equal(response.error, undefined);
  assert.equal(await response.value.text(), "<html>fresh deploy</html>");
});

test("an unreadable runtime cache still answers a hanging network with the precached shell", async (t) => {
  const worker = loadWorker(t);
  worker.unreadable.runtime = true;
  const { response } = worker.navigate("/passenger?utm=qr");
  await worker.advance(2500);
  assert.equal(response.done, true, "navigation is still waiting for the network after 2.5 s");
  assert.equal(response.error, undefined);
  assert.equal(await response.value.text(), "<html>passenger shell</html>");
});

test("after an unreadable cache at the budget, a network failure still falls back to the precached shell, then the root shell", async (t) => {
  for (const [path, shell] of [["/passenger", "passenger shell"], ["/no-such-page", "root shell"]]) {
    const worker = loadWorker(t);
    worker.unreadable.runtime = true;
    worker.unreadable.precache.add("/passenger.html");
    const { response } = worker.navigate(path);
    await worker.advance(2500);
    assert.equal(response.done, false, `${path}: an unreadable cache failed the navigation`);
    // Storage pressure passes; the network then fails.
    worker.unreadable.runtime = false;
    worker.unreadable.precache.clear();
    worker.network().reject(new TypeError("Failed to fetch"));
    await worker.advance(1);
    assert.equal(response.done, true, `${path} must fall back as soon as the network fails`);
    assert.equal(response.error, undefined);
    assert.equal(await response.value.text(), `<html>${shell}</html>`);
    t.mock.timers.reset();
  }
});

test("a network failure with an unreadable route shell falls back to the root shell", async (t) => {
  const worker = loadWorker(t);
  worker.unreadable.precache.add("/passenger.html");
  const { response } = worker.navigate("/passenger");
  await worker.advance(1);
  worker.network().reject(new TypeError("Failed to fetch"));
  await worker.advance(1);
  assert.equal(response.done, true, "/passenger must fall back as soon as the network fails");
  assert.equal(response.error, undefined);
  assert.equal(await response.value.text(), "<html>root shell</html>");
});

test("a network failure with no readable shell fails with the network's error, not the storage error", async (t) => {
  const worker = loadWorker(t);
  worker.unreadable.precache.add("/passenger.html").add("/index.html");
  const { response } = worker.navigate("/passenger");
  await worker.advance(1);
  worker.network().reject(new TypeError("Failed to fetch"));
  await worker.advance(1);
  assert.equal(response.done, true, "/passenger must not hang once the network has failed");
  // NetworkFirst reports a failed fetch with no runtime copy as "no-response".
  assert.equal(response.error?.name, "no-response");
});

test("the 2.5 s budget timer never outlives the navigation", async (t) => {
  // A pending timer would keep the worker busy after the page has its answer.
  const paths = [
    ["network answers inside the budget", async (worker) => {
      await worker.advance(999);
      worker.network().resolve(html("<html>fresh deploy</html>"));
      await worker.advance(1);
    }],
    ["network fails inside the budget", async (worker) => {
      worker.network().reject(new TypeError("Failed to fetch"));
      await worker.advance(1);
    }],
    ["network fails and no shell can be read", async (worker) => {
      worker.unreadable.precache.add("/passenger.html").add("/index.html");
      worker.network().reject(new TypeError("Failed to fetch"));
      await worker.advance(1);
    }],
    ["budget expires onto the precached shell", async (worker) => {
      await worker.advance(2499);
    }],
    ["budget expires onto an unreadable cache, then the network answers", async (worker) => {
      worker.unreadable.runtime = true;
      worker.unreadable.precache.add("/passenger.html");
      await worker.advance(2499);
      worker.network().resolve(html("<html>fresh deploy</html>"));
      await worker.advance(1);
    }],
  ];
  for (const [label, drive] of paths) {
    const worker = loadWorker(t);
    const { response } = worker.navigate("/passenger");
    await worker.advance(1);
    assert.equal(worker.pendingTimers(), 1, `${label}: the budget timer was not observed`);
    await drive(worker);
    assert.equal(response.done, true, `${label}: the navigation has not settled`);
    assert.equal(worker.pendingTimers(), 0, `${label}: the budget timer outlives the navigation`);
    t.mock.timers.reset();
  }
});
