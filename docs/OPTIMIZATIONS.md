# Eki (BusTrackr) — Zero-Budget Optimization Strategy

This document provides a deep dive into how the Eki architecture is explicitly engineered to operate entirely on **Free Tiers**, circumventing the typical exorbitant costs associated with live transit tracking.

Live GPS tracking is notoriously expensive due to three main factors:
1. **Concurrent Database Connections:** Maintaining WebSocket connections for thousands of passengers.
2. **Database Read/Writes:** Constantly writing GPS ticks and reading them.
3. **Map API Licensing:** Paying per-render for dynamic Maps SDKs.

We mitigated all three using advanced architectural patterns.

---

## 1. Firebase Free-Tier Optimization

Firebase Realtime Database (RTDB) and Firestore are incredibly fast but have strict free-tier limits (100 concurrent connections, 50k reads/day). We use a combination of Hardware smart-transmission and React Singletons to stay within limits.

### 1.1 Hardware Smart Transmission (Write Minimization)
If a bus updates its location every 1 second for a 12-hour shift, that is **43,200 writes per day per bus**. A fleet of 10 buses would instantly blow past the free tier and incur heavy charges.

**The Solution:**
The ESP32 hardware runs a local C++ State Machine that calculates Haversine distance and bearing locally. It only pushes a write to Firebase if:
- The bus moved more than `10 meters`.
- The bus turned more than `15 degrees` (ensuring corners are smooth).
- The bus is stationary, in which case it sends a heartbeat every `30 seconds`.

**Result:** A bus driving in a straight line on a highway only sends 1 packet every ~100 meters, reducing database writes by **~75% to 85%**.

### 1.2 Module-Level Singleton Listeners (Read Minimization)
In React, if three different components on a page need the `GlobalSettings`, using `onSnapshot` inside a hook might accidentally open three separate WebSocket connections to Firestore. In Firebase, you pay for reads, but concurrent connections are hard-capped at 100 on the Spark plan.

**The Solution:**
We implemented the `useSettings` hook as a **Module-Level Singleton**.

```typescript
// /frontend/src/hooks/useSettings.ts
let _settings = DEFAULT_SETTINGS;
let _listenerCount = 0;
let _unsubscribe: (() => void) | null = null;
const _listeners = new Set<() => void>();

export function useSettings() {
  // Only mounts ONE Firebase listener no matter how many times this hook is used
}
```
When `PassengerPage` and `SettingsPanel` both mount, the listener count increments, but `ensureListener()` only fires once. A single Firebase connection is shared across the entire client runtime. It tears down only when the last component unmounts.

---

## 2. Google Maps API Zero-Budget Strategy

Google Maps JavaScript API charges per map load ($7 per 1,000 loads) and heavily limits the Routes API.

### 2.1 The `@vis.gl/react-google-maps` Tile Strategy
Rather than using raw `new google.maps.Map()`, we utilize the official React wrapper. By strictly controlling when the `APIProvider` mounts, we ensure the map script is only requested when absolutely necessary. 

**The Lazy-Load MapProviders Wrapper:**
The landing page (`/`) does NOT load the Google Maps SDK. It is completely deferred. Only when a user navigates to `/passenger` or `/admin` does `MapProviders.tsx` dynamically inject the SDK. This eliminates wasted map-loads from bounced traffic.

### 2.2 Server-Side Polyline Baking (Routes API)
Calculating a route using Google Maps Directions API on the client side costs money per request. If 10,000 passengers open the app and request the BRTS route path, the API bill would be catastrophic.

**The Solution:**
1. The **Admin** uses the `RouteManagementPanel` to build a route.
2. The Admin clicks "Save".
3. A single, authenticated REST call is made to the **Node.js Backend**.
4. The Backend securely calls the Google Maps Routes API v2, computes the extremely complex geometric polyline, and extracts the bounding boxes.
5. The Backend saves this raw string polyline to **Firestore**.

Now, when 10,000 passengers open the app, they simply download a static string from Firestore (costing fractions of a cent) and decode it locally using `mapbox/polyline`. Google Maps Routes API is entirely bypassed for end-users.

---

## 3. PWA Auto-Update (Bypassing Aggressive Safari Cache)

One massive problem with PWAs and Next.js is that iOS Safari aggressively caches `index.html` and Javascript bundles. When you deploy a new version to Firebase, users opening the app from their home screen will be stuck on the old version because the Service Worker intercepts the request.

### 3.1 The `version.json` Polling Strategy
We implemented a robust cache-busting mechanism to force client-side reloads when the codebase updates:

1. **Build-time Fingerprinting:** `next.config.ts` dynamically generates a timestamp and writes it to `public/version.json`. It also injects this into the environment as `NEXT_PUBLIC_APP_VERSION`.
2. **No-Cache Headers:** `firebase.json` explicitly marks `/version.json` as `Cache-Control: no-cache, no-store, must-revalidate`.
3. **Visibility Polling:** The `useAutoUpdate.ts` hook listens to the DOM `visibilitychange` event. The exact millisecond a user switches back to the app on their phone, it fetches `version.json?t=[timestamp]`.
4. **Hard Reload:** If the server's version mismatches the client's baked-in version, it purges the local `caches.keys()` and forces a `window.location.reload()`, ensuring 100% of the fleet receives the latest code instantly.
