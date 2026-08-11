/**
 * Eki Transit – Service Worker (source)
 *
 * Workbox injectManifest replaces the precache manifest placeholder below
 * with the real precache manifest at build time. Everything in the static
 * export (`out/`) is precached for instant offline-capable PWA launches.
 *
 * Caching strategies (ordered by priority):
 *   1. Precache  – app shell: HTML pages, JS chunks, CSS, manifest, icons,
 *                  hero images. Served cache-first with revision hashing.
 *   2. StaleWhileRevalidate – Google Fonts CSS/woff2 (if ever added).
 *   3. CacheFirst – Google Maps tiles, Firebase SDK CDN scripts.
 *   4. NetworkOnly – authenticated Firebase/API responses.
 *   5. NetworkOnly – reCAPTCHA, analytics, non-cacheable third-party.
 *
 * Navigation requests are served from the precache (offline-capable) with
 * a Network-First fallback for any route not in the manifest.
 */

import { clientsClaim } from "workbox-core";
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import {
  registerRoute,
  NavigationRoute,
  setDefaultHandler,
} from "workbox-routing";
import {
  CacheFirst,
  NetworkOnly,
  NetworkFirst,
  StaleWhileRevalidate,
} from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// ─── Lifecycle ──────────────────────────────────────────────────────────────
// The application asks an installed worker to activate only when no driver
// shift is active. This prevents controllerchange from reloading a live shift.
clientsClaim();

// Remove entries from previous precache versions that are no longer in the
// manifest. Prevents stale cache bloat across deployments.
cleanupOutdatedCaches();

// ─── Precache ───────────────────────────────────────────────────────────────
// The placeholder below is replaced by workbox-build's injectManifest with
// the list of URLs and revision hashes from the static export.
precacheAndRoute(self.__WB_MANIFEST || []);

// ─── Navigation requests ────────────────────────────────────────────────────
// All navigation requests (HTML page loads) are served from the precache.
// Since every route has its own HTML file in the static export, this gives
// instant page transitions without any network dependency.
//
// If a navigation doesn't match a precached URL (e.g. a new route added
// after the SW was installed), fall back to network-first.
const navigationHandler = new NavigationRoute(
  new NetworkFirst({
    cacheName: "eki-navigations",
    networkTimeoutSeconds: 3,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  {
    // Don't let the SW intercept Firebase Auth iframe URLs
    denylist: [/\/__\/auth\//, /\/__(.*)/],
  }
);
registerRoute(navigationHandler);

// ─── Runtime caching: Google Maps ───────────────────────────────────────────
// Map tiles, the Maps JS SDK, and marker icons. Cache-first with a 7-day
// expiration and a cap of 200 entries — tiles are large and we don't want
// to consume excessive storage on low-end devices.
registerRoute(
  ({ url }) =>
    url.origin === "https://maps.googleapis.com" ||
    url.origin === "https://maps.gstatic.com" ||
    url.origin.includes("ggpht.com"),
  new CacheFirst({
    cacheName: "eki-google-maps",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  })
);

// ─── Runtime caching: Google Fonts ──────────────────────────────────────────
// Currently using system fonts, but if Google Fonts are added in future,
// the stylesheets use SWR and the font files use cache-first.
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new StaleWhileRevalidate({
    cacheName: "eki-google-fonts-css",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "eki-google-fonts-woff",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }),
    ],
  })
);

// ─── Runtime caching: Firebase Auth ─────────────────────────────────────────
// Auth iframe JS from apis.google.com and gstatic.com. These change
// infrequently so StaleWhileRevalidate is fine — we always serve from cache
// but refresh in the background.
registerRoute(
  ({ url }) =>
    url.origin === "https://apis.google.com" ||
    (url.origin === "https://www.gstatic.com" &&
      url.pathname.startsWith("/firebasejs/")),
  new StaleWhileRevalidate({
    cacheName: "eki-firebase-sdk",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  })
);

// ─── Firebase REST APIs (RTDB and Auth only) ───────────────────────────────
// Never cache account-scoped responses: a URL cache key does not represent
// the currently signed-in user. Live RTDB WebSockets also bypass HTTP caches.
registerRoute(
  ({ url }) =>
    url.hostname.endsWith(".firebaseio.com") ||
    url.hostname.endsWith(".firebasedatabase.app") ||
    url.origin === "https://identitytoolkit.googleapis.com" ||
    url.origin === "https://securetoken.googleapis.com",
  new NetworkOnly()
);

// ─── Runtime caching: Same-origin static images ─────────────────────────────
registerRoute(
  ({ request, url }) =>
    request.destination === "image" && url.origin === self.location.origin,
  new CacheFirst({
    cacheName: "eki-images",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// ─── Default handler ────────────────────────────────────────────────────────
// Unknown requests, including backend APIs, always use the network.
setDefaultHandler(new NetworkOnly());

// ─── Message handling ───────────────────────────────────────────────────────
// Allow the app to tell the SW to skip waiting (for update prompts).
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
