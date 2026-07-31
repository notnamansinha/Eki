"use client";

import { useEffect } from "react";

/**
 * Registers the Workbox service worker after hydration.
 *
 * Deferred to `window.load` so SW install / precache fetches never compete
 * with the page's own critical resources (JS chunks, Firebase Auth, hero
 * image). On subsequent visits the SW is already active and serves from cache.
 *
 * In development the SW is unregistered to prevent caching stale dev builds.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // In development, unregister any leftover SW to avoid caching issues.
    if (process.env.NODE_ENV === "development") {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      });
      return;
    }

    // Defer registration until after initial paint + load to avoid contention
    // between SW precaching and the page's own critical resource fetches.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          // Check for updates periodically (every 60 minutes).
          // This is important for a campus transit app where the tab may be
          // open for hours — students keep the PWA open all day.
          const interval = setInterval(() => {
            registration.update().catch(() => {
              // Silently ignore update check failures (offline, etc.)
            });
          }, 60 * 60 * 1000);

          // If a new SW is already waiting (e.g. updated while another tab
          // was open), activate it immediately. For a transit app, the latest
          // version is always the right version.
          if (registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          }

          // Listen for new SWs that finish installing while the page is open.
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (!newWorker) return;

            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                // A new SW is installed and there's already an active one.
                // Tell it to take over immediately — no reload prompt needed
                // for a transit app where data is always live from Firebase.
                newWorker.postMessage({ type: "SKIP_WAITING" });
              }
            });
          });

          // Clean up interval on page unload
          window.addEventListener(
            "beforeunload",
            () => clearInterval(interval),
            { once: true }
          );
        })
        .catch((error) => {
          console.error("[SW] Registration failed:", error);
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return null;
}
