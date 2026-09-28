/**
 * Eki Transit – Service Worker (source)
 *
 * Workbox injectManifest replaces the precache manifest placeholder below
 * with the real precache manifest at build time. HTML, identity assets and
 * icons form the install shell; hashed role-specific chunks cache on use.
 *
 * Caching strategies (ordered by priority):
 *   1. NetworkFirst – HTML navigation, with precached shells for offline use.
 *   2. Precache – HTML shells, manifest, icons and bootstrap chunks.
 *   3. CacheFirst – same-origin hashed Next.js JS/CSS chunks, cached on use.
 *   4. StaleWhileRevalidate – Google Fonts CSS/woff2 (if ever added).
 *   5. CacheFirst – Google Maps tiles, Firebase SDK CDN scripts.
 *   6. NetworkOnly – authenticated Firebase/API responses.
 *
 * Navigation requests check Hosting first and use cached HTML when offline.
 */

import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from "workbox-precaching";
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
// Let an update wait until clients using the previous worker have closed.
// Replacing their controller mid-session can break lazy-loaded assets that
// belong to the previous deployment.

// Remove entries from previous precache versions that are no longer in the
// manifest. Prevents stale cache bloat across deployments.
cleanupOutdatedCaches();

// ─── Navigation requests ────────────────────────────────────────────────────
// Register before the precache route so a refresh checks Hosting for the
// current HTML instead of always serving the previous deployment's shell.
const navigationStrategy = new NetworkFirst({
  cacheName: "eki-navigations",
  networkTimeoutSeconds: 3,
  plugins: [
    new CacheableResponsePlugin({ statuses: [0, 200] }),
  ],
});
const navigationHandler = new NavigationRoute(
  async (options) => {
    try {
      return await navigationStrategy.handle(options);
    } catch (error) {
      const pathname = new URL(options.request.url).pathname;
      const shell = pathname === "/"
        ? "/index.html"
        : pathname.endsWith("/") ? `${pathname}index.html` : `${pathname}.html`;
      const cached = await matchPrecache(shell) || await matchPrecache("/index.html");
      if (cached) return cached;
      throw error;
    }
  },
  {
    // Don't let the SW intercept Firebase Auth iframe URLs
    denylist: [/\/__\/auth\//, /\/__(.*)/],
  }
);
registerRoute(navigationHandler);

// ─── Precache ───────────────────────────────────────────────────────────────
// The placeholder below is replaced by workbox-build's injectManifest with
// the list of URLs and revision hashes from the static export. Navigation is
// handled above; precached HTML remains available when offline.
precacheAndRoute(self.__WB_MANIFEST || []);

// Hashed Next.js assets are immutable. Cache only the chunks a user's role
// actually loads instead of downloading admin and passenger bundles together
// during every service-worker install.
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    url.pathname.startsWith("/_next/static/"),
  new CacheFirst({
    cacheName: "eki-next-static",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// ─── Runtime caching: Google Maps ───────────────────────────────────────────
// Map tiles, the Maps JS SDK, and marker icons. Cache-first with a 7-day
// expiration and a cap of 200 entries — tiles are large and we don't want
// to consume excessive storage on low-end devices.
registerRoute(
  ({ url }) =>
    url.origin === "https://maps.googleapis.com" ||
    url.origin === "https://maps.gstatic.com" ||
    url.hostname === "ggpht.com" || url.hostname.endsWith(".ggpht.com"),
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
