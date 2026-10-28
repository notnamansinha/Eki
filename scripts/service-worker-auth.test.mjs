import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { it } from "node:test";
import { connectSourcesFromCsp } from "./verify-web-backend-contract.mjs";

it("allows worker fetches of the Google Auth loader in shipped and generated CSP", async () => {
  const firebase = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
  const policy = firebase.hosting.headers.find(entry => entry.source === "**")
    .headers.find(header => header.key === "Content-Security-Policy").value;
  assert.ok(new Set(connectSourcesFromCsp(policy)).has("https://apis.google.com"));
  // Evaluate the actual source-list expression used by the build generator,
  // so a later build cannot silently remove the shipped fix.
  const generator = await readFile(new URL("./update-csp.mjs", import.meta.url), "utf8");
  const expression = generator.match(/const connectSources = ([\s\S]*?)\.join\(" "\);/)[1];
  const sources = runInNewContext(expression, { backendOrigin: "https://api.example.test" });
  const allowed = new Set(sources);
  assert.ok(allowed.has("https://apis.google.com"));
  assert.ok(allowed.has("https://api.example.test"));
  assert.ok(!allowed.has("*"));
});

it("keeps Auth helpers on the network and retires only their obsolete cache", async () => {
  const routes = [], events = new Map(), deleted = [];
  class Strategy { constructor(options) { this.options = options; } }
  class NetworkOnly extends Strategy {}
  class NavigationRoute { constructor(handler, options) { this.handler = handler; this.options = options; } }
  const source = (await readFile(new URL("../frontend/src/sw.js", import.meta.url), "utf8"))
    .replace(/import\s+[\s\S]*?\s+from\s+"[^"]+";/g, "");
  runInNewContext(source, {
    self: { location: { origin: "https://app.example.test" }, addEventListener: (name, callback) => events.set(name, callback) },
    caches: { delete: async name => { deleted.push(name); return true; } },
    URL, NavigationRoute, NetworkOnly, NetworkFirst: Strategy, CacheFirst: Strategy,
    StaleWhileRevalidate: Strategy, ExpirationPlugin: Strategy, CacheableResponsePlugin: Strategy,
    cleanupOutdatedCaches() {}, precacheAndRoute() {}, matchPrecache() {}, setDefaultHandler() {},
    registerRoute: (match, strategy) => routes.push({ match, strategy }),
  });
  for (const url of ["https://apis.google.com/js/api.js?onload=callback", "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js"]) {
    const route = routes.find(({ match }) => typeof match === "function" && match({ url: new URL(url), request: { destination: "script" } }));
    assert.ok(route?.strategy instanceof NetworkOnly);
  }
  let cleanup;
  events.get("activate")({ waitUntil: promise => { cleanup = promise; } });
  await cleanup;
  // Deployment-scoped navigation HTML and the retired opaque Maps cache are
  // also removed; static caches stay.
  assert.deepEqual(deleted, ["eki-firebase-sdk", "eki-navigations", "eki-google-maps"]);
});
