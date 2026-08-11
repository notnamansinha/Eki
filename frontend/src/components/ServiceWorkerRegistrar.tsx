"use client";

import { useEffect } from "react";
import {
  canActivateServiceWorker,
  DRIVER_SHIFT_UPDATE_EVENT,
} from "@/lib/serviceWorkerUpdate";

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

    let cancelled = false;
    let updateInterval: ReturnType<typeof setInterval> | undefined;
    let activeRegistration: ServiceWorkerRegistration | undefined;
    let reloading = false;
    let hadController = Boolean(navigator.serviceWorker.controller);

    const activateWaitingWorker = () => {
      if (canActivateServiceWorker()) {
        activeRegistration?.waiting?.postMessage({ type: "SKIP_WAITING" });
      }
    };

    const handleControllerChange = () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      activeRegistration?.update().catch(() => {
        // Offline update checks are retried on the next focus or interval.
      });
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(DRIVER_SHIFT_UPDATE_EVENT, activateWaitingWorker);

    // Defer registration until after initial paint + load to avoid contention
    // between SW precaching and the page's own critical resource fetches.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => {
          if (cancelled) return;
          activeRegistration = registration;

          // Check for updates periodically (every 15 minutes).
          // This is important for a campus transit app where the tab may be
          // open for hours — students keep the PWA open all day.
          updateInterval = setInterval(() => {
            registration.update().catch(() => {
              // Silently ignore update check failures (offline, etc.)
            });
          }, 15 * 60 * 1000);

          // A live or not-yet-restored driver shift keeps this worker waiting.
          activateWaitingWorker();

          // Listen for new SWs that finish installing while the page is open.
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (!newWorker) return;

            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                activateWaitingWorker();
              }
            });
          });

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

    return () => {
      cancelled = true;
      if (updateInterval) clearInterval(updateInterval);
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(DRIVER_SHIFT_UPDATE_EVENT, activateWaitingWorker);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  return null;
}
