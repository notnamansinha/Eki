# Comprehensive Guide: Auto-Updating Web Apps (PWAs)

> **Current project status:** Eki ships a web app manifest but does **not**
> register a service worker. This document is a future implementation guide,
> not a description of deployed behavior. Firebase Auth uses local persistence,
> so authenticated sessions survive normal reloads without a service worker.

Ensuring a web app automatically hard refreshes *only* when there's a real update—across Chrome, Safari, and installed Home Screen apps (PWAs)—can be notoriously tricky due to aggressive browser caching and Service Worker lifecycles.

Here is the most robust, battle-tested approach to achieve this.

---

## The Core Problem

When you deploy a new version of an app:
1. **Browser Cache**: Safari, in particular, aggressively caches HTML and JS.
2. **Service Worker (PWA)**: If you use a Service Worker, it intercepts network requests and serves stale cached files. Even if the browser detects a new Service Worker file, the new worker enters a **"waiting"** state. It won't take control until all existing tabs of the app are fully closed.

To fix this, we need a two-pronged strategy:
1. **A Bulletproof Version Checker**: Bypasses the Service Worker to check if a new version exists on the server.
2. **Service Worker Lifecycle Management**: Forces the waiting Service Worker to take over and triggers a hard reload.

---

## The Ultimate Solution: The `version.json` Polling Strategy

This is the most reliable method across all platforms (iOS Safari, Android Chrome, Desktop).

### Step 1: Generate a Version File at Build Time
During your build process (e.g., Webpack, Vite, Next.js), generate a `version.json` file in your `public` folder. This file should contain a unique identifier for the build (timestamp or git commit hash).

**`public/version.json`**
```json
{
  "version": "1721245893452" // e.g., Date.now() at build time
}
```

> [!IMPORTANT]
> Your server **MUST** serve `version.json` with the HTTP header `Cache-Control: no-cache, no-store, must-revalidate`. If this file gets cached by the browser, the whole system fails.

### Step 2: Store the Current Version in the App
Bake the same version hash into your app's code during the build so the client knows what version it is currently running.

In Vite, you can use `import.meta.env`; in Next.js, use `process.env`. Let's assume you have a global variable or environment variable `APP_VERSION`.

### Step 3: The Version Checker Hook (React Example)
Create a hook or utility that runs periodically and whenever the app regains focus (e.g., when the user opens the app from the background on iOS).

```typescript
import { useEffect } from 'react';

// The version baked into the app during build
const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

export function useAutoUpdate() {
  useEffect(() => {
    const checkForUpdate = async () => {
      try {
        // Append a timestamp query param to completely bust any aggressive browser/CDN cache
        const response = await fetch(`/version.json?t=${new Date().getTime()}`, {
          cache: 'no-store', // Crucial for Safari
        });
        
        const data = await response.json();
        const latestVersion = data.version;

        if (latestVersion && CURRENT_VERSION && latestVersion !== CURRENT_VERSION) {
          console.log('Update found! Forcing refresh...');
          forceUpdate();
        }
      } catch (error) {
        console.error('Failed to check for updates', error);
      }
    };

    // 1. Check for update when the app comes back into focus (crucial for iOS Home Screen apps)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 2. Check periodically (e.g., every 5 minutes) just in case they leave the app open
    const intervalId = setInterval(checkForUpdate, 5 * 60 * 1000);

    // Initial check on load
    checkForUpdate();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(intervalId);
    };
  }, []);
}

async function forceUpdate() {
  // If you use Service Workers, unregister them first to clear out stale caches
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (let registration of registrations) {
      await registration.unregister();
    }
  }

  // Clear HTTP Cache using Cache API (optional but highly recommended for PWAs)
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  }

  // Force a hard reload from the server, bypassing browser cache
  // Using true as an argument is deprecated in some browsers but still works as a hint in others
  window.location.reload(true);
}
```

---

## Handling the Service Worker (PWA) Specifically

If you are using tools like `workbox`, `next-pwa`, or `vite-plugin-pwa`, the Service Worker will still try to cache the old app. Bypassing it requires sending a message to the Service Worker.

### 1. In your Service Worker file (`sw.js`):
You must listen for a `SKIP_WAITING` message to force the new Service Worker to take over immediately.

```javascript
// Listen for messages from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
```

### 2. In your Client-side Registration Code:
Instead of just unregistering the Service Worker as shown in the previous script, you orchestrate a smooth handoff.

```typescript
export function registerServiceWorkerAndListenForUpdates() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      
      // Listen for a new Service Worker being installed
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        
        newWorker.addEventListener('statechange', () => {
          // If the new worker is installed and waiting...
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            
            // WE HAVE AN UPDATE! 
            // Send the skip waiting signal to the new Service Worker
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    });

    // Listen for the controlling Service Worker to change
    // This fires immediately AFTER skipWaiting() executes
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        // Hard refresh the page to load the new assets
        window.location.reload(); 
      }
    });
  }
}
```

---

## Why this specific setup works everywhere:

1. **iOS Safari (Home Screen)**: When an app is added to the home screen on iOS, it is basically "frozen" when backgrounded. It does not run background tasks well. By attaching to the `visibilitychange` event, the exact millisecond the user brings the app back to the foreground, it fetches the cache-busting `/version.json?t=123`.
2. **True Cache Busting**: By using `?t=${Date.now()}` on the fetch request and `Cache-Control: no-store` on the server, you guarantee that no CDN or internal browser cache can intercept the version check.
3. **No Infinite Reload Loops**: Because we check `latestVersion !== CURRENT_VERSION` (where `CURRENT_VERSION` is hardcoded at build time), it will only reload once. When it reloads, it downloads the new HTML/JS, which has the new `CURRENT_VERSION` hardcoded in it, so they match, and it stops reloading.
4. **Clean Slate**: By nuking the Cache Storage (`caches.delete()`) and unregistering/updating the Service Worker *before* the reload, you ensure the subsequent reload actually hits the network instead of pulling from the local PWA cache.

## Summary Checklist for your other Web App:
- [ ] Add a step to your build script to output `public/version.json`.
- [ ] Inject the exact same version string into your frontend environment variables.
- [ ] Ensure your hosting provider (Vercel, Netlify, Nginx) serves `version.json` with no caching.
- [ ] Implement the `visibilitychange` hook to poll the `version.json` file.
- [ ] (If PWA) Ensure your Service Worker listens for `SKIP_WAITING` and the client listens for `controllerchange`.
