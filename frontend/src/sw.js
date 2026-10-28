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
 *   4. StaleWhileRevalidate – Google Fonts CSS/woff2 (if ever added); CORS
 *      (status 200) responses only, never opaque ones.
 *   5. NetworkOnly – Google Maps loader, tiles and icons. These are no-cors
 *      requests whose opaque responses hide upstream errors, so caching one
 *      would replay a broken map after the upstream recovers.
 *   6. NetworkOnly – Google Auth helpers and authenticated Firebase/API responses.
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

// Retire the previous Auth-script cache when this worker activates. Auth
// helpers are online dependencies and must not replay an obsolete loader.
// Also retire navigation HTML cached under the previous worker: it references
// hashed chunks that this worker's precache cleanup removes and Hosting no
// longer serves, so an offline or slow-network fallback to it cannot boot.
// Until a fresh page is cached, the fallback uses this worker's precached shell.
// Earlier workers cached opaque Google Maps responses, possibly upstream errors;
// Maps is now network-only, so drop that cache too.
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.delete("eki-firebase-sdk"),
    caches.delete("eki-navigations"),
    caches.delete("eki-google-maps"),
  ]));
});

// ─── Navigation requests ────────────────────────────────────────────────────
// Register before the precache route so a refresh checks Hosting for the
// current HTML instead of always serving the previous deployment's shell.
// The static export's HTML does not depend on the query string (it is read
// only on the client), so store and look up one bounded entry per path rather
// than one full HTML copy per UTM/QR/trace query.
const navigationStrategy = new NetworkFirst({
  cacheName: "eki-navigations",
  networkTimeoutSeconds: 3,
  plugins: [
    {
      cacheKeyWillBeUsed: async ({ request }) => {
        const url = new URL(request.url);
        url.search = "";
        url.hash = "";
        return url.href;
      },
    },
    new CacheableResponsePlugin({ statuses: [0, 200] }),
    new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 7 * 24 * 60 * 60 }),
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

// ─── Google Maps ─────────────────────────────────────────────────────────────
// The Maps JS loader (a plain <script> without crossOrigin) and raster tiles
// (<img>) are no-cors requests, so the worker only sees opaque status-0
// responses and cannot tell a 503/429/403 from success. Caching them would
// replay a transient upstream failure (or a stale versioned loader) for days
// and bill several MB of quota padding per entry. Keep them on the network;
// the browser HTTP cache still honours Google's own cache headers.
registerRoute(
  ({ url }) =>
    url.origin === "https://maps.googleapis.com" ||
    url.origin === "https://maps.gstatic.com" ||
    url.hostname === "ggpht.com" || url.hostname.endsWith(".ggpht.com"),
  new NetworkOnly()
);

// ─── Runtime caching: Google Fonts ──────────────────────────────────────────
// Currently using system fonts, but if Google Fonts are added in future,
// the stylesheets use SWR and the font files use cache-first. Only readable
// (CORS, status 200) responses are stored: an opaque response could be an
// upstream error that would otherwise be replayed.
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new StaleWhileRevalidate({
    cacheName: "eki-google-fonts-css",
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  })
);

registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "eki-google-fonts-woff",
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  })
);

// ─── Runtime caching: Firebase Auth ─────────────────────────────────────────
// Workbox fetches these scripts, so the worker's connect-src must allow their
// origins as well as the page's script-src. Keep Auth helpers on the network.
// This worker change also makes browsers install the corrected CSP; changing
// only Hosting response headers can leave a byte-identical worker in place.
registerRoute(
  ({ url }) =>
    url.origin === "https://apis.google.com" ||
    (url.origin === "https://www.gstatic.com" &&
      url.pathname.startsWith("/firebasejs/")),
  new NetworkOnly()
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
