import { useEffect } from 'react';

const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

export function useAutoUpdate() {
  useEffect(() => {
    // Only run this on the client
    if (typeof window === 'undefined') return;

    const checkForUpdate = async () => {
      try {
        // Append a timestamp query param to completely bust any aggressive browser/CDN cache
        const response = await fetch(`/version.json?t=${new Date().getTime()}`, {
          cache: 'no-store', // Crucial for Safari
        });
        
        const data = await response.json();
        const latestVersion = data.version;

        if (latestVersion && CURRENT_VERSION && latestVersion !== CURRENT_VERSION) {
          console.log(`[AutoUpdate] Update found! (Current: ${CURRENT_VERSION}, Latest: ${latestVersion}). Forcing refresh...`);
          await forceUpdate();
        }
      } catch (error) {
        console.error('[AutoUpdate] Failed to check for updates', error);
      }
    };

    // 1. Check for update when the app comes back into focus (crucial for iOS Home Screen apps)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 2. Check periodically (every 5 minutes) just in case they leave the app open
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
  // If we ever use Service Workers, unregister them first to clear out stale caches
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    } catch (err) {
      console.warn('[AutoUpdate] Failed to unregister service workers', err);
    }
  }

  // Clear HTTP Cache using Cache API
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    } catch (err) {
      console.warn('[AutoUpdate] Failed to clear caches', err);
    }
  }

  // Force a hard reload from the server, bypassing browser cache
  // Using true as an argument is deprecated in some browsers but still works as a hint in others
  window.location.reload();
}
