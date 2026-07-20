# UI/UX Competitive Audit — Nakshatra Nav (BusTracker)

> **Scope**: Mobile-first web app for lakhs of bus passengers in Indian cities  
> **Competitors Studied**: Uber Transit, Moovit, Google Maps Transit, Citymapper, Transit App  
> **Date**: 2026-05-18  

---

## 1 · Current Feature Inventory

### Passenger Side
| Feature | Status | Files |
|---|---|---|
| Live bus tracking on Google Map | ✅ Implemented | `PassengerMap.tsx` |
| Route selector (active buses only) | ✅ Implemented | `passenger/page.tsx` |
| Stop selector ("Alight at") | ✅ Implemented | `passenger/page.tsx` |
| Turbo / Budget / ♿ toggle | ✅ Stub only (no logic) | `passenger/page.tsx` L156-158 |
| Route Timeline bottom sheet | ✅ Implemented | `RouteTimelineSheet.tsx` |
| Per-stop ETA (speed-aware) | ✅ Implemented | `PassengerMap.tsx` |
| Walk-to-stop ETA | ✅ Implemented | `PassengerMap.tsx` L122-126 |
| Arrival audio buzz | ✅ Implemented | `audioUtils.ts`, `PassengerMap.tsx` |
| Buzzer on/off toggle | ✅ Implemented | `AccountTab.tsx` |
| Live messaging (driver ↔ rider) | ✅ Implemented | `MessagingPanel.tsx` |
| Profanity filter + rate limiter | ✅ Implemented | `MessagingPanel.tsx` |
| Post-ride feedback modal (stars) | ✅ Implemented | `FeedbackModal.tsx` |
| General feedback / suggestions | ✅ Implemented | `AccountTab.tsx` → `FeedbackModal` |
| Recenter-on-me button | ✅ Implemented | `PassengerMap.tsx` |
| Gamification buttons (✨ 🏅 ⚠️) | ✅ Stub only | `PassengerMap.tsx` L484-503 |
| Google Auth sign-in | ✅ Implemented | `useAuth.ts` |
| "No drivers online" empty state | ✅ Implemented | `passenger/page.tsx` L247-270 |
| Passenger geolocation (blue dot) | ✅ Implemented | `PassengerMap.tsx` L107-161 |

### Driver Side
| Feature | Status | Files |
|---|---|---|
| Vehicle / operator / route selectors | ✅ Implemented | `TransmitterControls.tsx` |
| GPS tracking → Firebase RTDB | ✅ Implemented | `driver/page.tsx` |
| Route preview with alternatives | ✅ Implemented | `DriverMap.tsx`, `useGoogleDirections.ts` |
| Turn-by-turn navigation mode | ✅ Implemented | `DriverMap.tsx` (3D tilt + heading lock) |
| Auto-advance stop on proximity | ✅ Implemented | `DriverMap.tsx` L102-115 |
| Manual next-stop override | ✅ Implemented | `DriverMap.tsx` L93-99 |
| Delay buffer (+/- minutes) | ✅ Implemented | `DriverMap.tsx` L73-90 |
| Off-route auto-reroute | ✅ Implemented | `DriverMap.tsx` L344-397 |
| SOS + Headway Warning buttons | ✅ Stub only | `DriverMap.tsx` L681-688 |
| End Shift cleanup (RTDB + messages) | ✅ Implemented | `driver/page.tsx` |
| Driver profile tab | ✅ Implemented | `DriverProfileTab.tsx` |

### Other
| Feature | Status | Files |
|---|---|---|
| Route Planner (offline, no auth) | ✅ Implemented | `route-planner/page.tsx` |
| Admin panel | ✅ Exists | `admin/` directory |
| Landing page (Apple-style) | ✅ Implemented | `app/page.tsx` |
| Predefined routes data | ✅ Implemented | `predefinedRoutes.ts` |

---

## 2 · Gap Analysis vs Competitors

### 2.1 — What We're Missing (High-Signal Gaps)

| Gap | Uber | Moovit | GMaps | Citymapper | Impact |
|---|:---:|:---:|:---:|:---:|---|
| **Search-first home screen** (Where to?) | ✅ | ✅ | ✅ | ✅ | Users must manually pick route+stop — no destination search |
| **Live departure board** (next bus in X min) | ✅ | ✅ | ✅ | ✅ | No at-a-glance "next bus" without opening timeline |
| **"Get Off" push alert** (lock-screen) | — | ✅ | ✅ | ✅ | Buzzer only works if app is open + unmuted |
| **Crowding / occupancy indicator** | ✅ | ✅ | ✅ | ✅ | No seat availability info at all |
| **Saved places** (Home, Work, Favorites) | ✅ | ✅ | ✅ | ✅ | Every session starts from zero |
| **Trip history** | ✅ | ✅ | ✅ | ✅ | No record of past rides |
| **Onboarding flow** | ✅ | ✅ | — | ✅ | App dumps user on landing page cold |
| **Multi-language (Hindi, Gujarati)** | ✅ | ✅ | ✅ | — | English only — excludes majority ridership |
| **Offline schedule / map cache** | — | ✅ | ✅ | ✅ | Dead app in no-connectivity zones |
| **Haptic feedback** | ✅ | ✅ | ✅ | ✅ | No vibration on any interaction |
| **Accessibility (VoiceOver, contrast)** | ✅ | ✅ | ✅ | ✅ | Missing aria-labels, no high-contrast mode |
| **Service disruption alerts** | — | ✅ | ✅ | ✅ | No way to communicate route diversions |
| **Crowdsourced reporting** | — | ✅ | ✅ | — | Gamification stubs exist but do nothing |

### 2.2 — What We Already Do Well

- **Real-time GPS tracking** with interpolation animation — on par with Uber
- **Speed-aware ETA** that propagates delay buffers — better than most transit apps
- **Driver ↔ Rider messaging** — unique feature not found in any competitor
- **Arrival audio buzz** — good accessibility feature, just needs lock-screen extension
- **Off-route auto-reroute** with Firebase sync — production-grade
- **Dark premium aesthetic** — matches modern design standards

---

## 3 · Implementation-Ready Feature Proposals

### Priority Key
- **P0** = Critical for scale (implement first)
- **P1** = High impact on engagement
- **P2** = Differentiator / polish

---

### P0-1 · Destination Search Bar ("Where to?")

> **Inspired by**: Uber, Google Maps, Moovit

**What**: Replace the route/stop `<select>` dropdowns with a single search input at the top of the passenger map. User types a destination (or nearby stop name), and the app auto-selects the best route + alighting stop.

**Why**: Every competitor puts a search bar front-and-center. Our current flow forces users to *already know* which route number they need — that's expert-mode UX that fails for new riders.

**Files to modify**:
- `passenger/page.tsx` — Replace the `<select>` header with a search component
- New: `components/passenger/DestinationSearch.tsx`
- `hooks/usePlacesAutocomplete.ts` — Already exists, wire it up

**Technical sketch**:
```
1. Render <DestinationSearch /> in the top gradient overlay
2. On selection -> find nearest stop to destination across all active routes
3. Auto-set selectedRouteId + selectedStopId
4. Collapse search bar into a summary pill showing "-> {stopName}"
5. Keep manual route/stop selectors accessible via a "Change" link
```

---

### P0-2 · Live Departure Board (Next Bus Card)

> **Inspired by**: Google Maps departure board, Moovit home screen

**What**: A persistent, glanceable card at the bottom of the map showing: route number, bus ETA, occupancy level, and delay status — without needing to open the timeline sheet.

**Why**: The #1 question for every bus rider is "When is my bus coming?" This must be answerable in less than 1 second.

**Files to modify**:
- New: `components/passenger/NextBusCard.tsx`
- `passenger/page.tsx` — Render above bottom nav
- `PassengerMap.tsx` — Expose `liveEtaMinutes`, `liveDistKm`, `hasBus` via props/context

**Technical sketch**:
```tsx
<div className="fixed bottom-[64px] inset-x-0 z-40 px-4 pb-2">
  <div className="bg-brand-surface/95 backdrop-blur-xl rounded-2xl p-4 border border-white/10">
    <div className="flex items-center justify-between">
      <div>
        <span className="route-badge">{routeName}</span>
        <span className="text-white/50 text-xs">-> {targetStopName}</span>
      </div>
      <div className="text-right">
        <span className="text-2xl font-black text-white">{etaMinutes}</span>
        <span className="text-xs text-white/50 ml-1">MIN</span>
      </div>
    </div>
    <OccupancyIndicator level={occupancy} />
  </div>
</div>
```

---

### P0-3 · "Get Off" Vibration + Lock-Screen Alert

> **Inspired by**: Moovit "Get Off" alert, Citymapper "GO" mode

**What**: When the bus approaches the passenger's alighting stop (< 400m), trigger:
1. `navigator.vibrate([200, 100, 200, 100, 400])` — haptic pattern
2. A Web Notification via `Notification API` so it appears on lock-screen
3. The existing audio buzz (already implemented)

**Why**: Current buzz only works if the phone is unmuted AND the app is in the foreground. Riders miss their stops.

**Files to modify**:
- `PassengerMap.tsx` L330-333 — Add vibration + notification alongside `buzzController.playBuzz()`
- `audioUtils.ts` — Add `vibratePattern()` method
- `passenger/page.tsx` — Request `Notification.requestPermission()` on mount

**Technical sketch**:
```ts
// Inside the arrival detection block (PassengerMap.tsx L330)
if (arrivedByIndex || arrivedByProximity) {
  buzzController.playBuzz();
  
  // Haptic
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 400]);
  }
  
  // Lock-screen notification
  if (Notification.permission === 'granted') {
    new Notification('Time to get off!', {
      body: `Your stop "${targetStop.name}" is approaching`,
      icon: '/BusLogo.png',
      tag: 'arrival-alert',
      requireInteraction: true,
    });
  }
  
  lastBuzzedStopIdRef.current = targetStop.id;
}
```

---

### P0-4 · Multi-Language Support (i18n)

> **Inspired by**: Moovit (45+ languages), Google Maps

**What**: Implement i18n with at minimum **English, Hindi, Gujarati** — covering Ahmedabad's ridership demographics.

**Why**: A bus app for "lakhs of users" in Gujarat that's English-only excludes the majority of its target audience.

**Files to modify**:
- New: `lib/i18n.ts` — Translation dictionary + hook
- New: `locales/en.json`, `locales/hi.json`, `locales/gu.json`
- All UI components — Replace hardcoded strings with `t('key')` calls
- `AccountTab.tsx` — Add language selector in Preferences

**Technical sketch**:
```ts
// lib/i18n.ts
const translations = { en: {...}, hi: {...}, gu: {...} };
export function useTranslation() {
  const [lang, setLang] = useState(localStorage.getItem('lang') || 'en');
  const t = (key: string) => translations[lang][key] || key;
  return { t, lang, setLang };
}
```

---

### P1-1 · Saved Places (Home, Work, Favorites)

> **Inspired by**: Uber, Google Maps, Citymapper

**What**: Let users save frequent stops as "Home" and "Work" with one-tap access. Store in Firestore under `users/{uid}/savedPlaces`.

**Files to modify**:
- New: `components/passenger/SavedPlaces.tsx`
- `passenger/page.tsx` — Render saved places chips above the map
- `AccountTab.tsx` — "Manage Saved Places" menu item
- New: Firestore collection `users/{uid}/savedPlaces`

**Data shape**:
```ts
interface SavedPlace {
  label: string;       // "Home", "Work", or custom
  stopId: string;
  routeId: string;
  lat: number;
  lng: number;
}
```

---

### P1-2 · Crowding / Occupancy Indicator

> **Inspired by**: Google Maps, Transit App, Moovit

**What**: Show a 3-tier occupancy indicator (Green=Empty / Yellow=Some seats / Red=Standing only) on the bus marker and the NextBusCard.

**Data source options (pick one)**:
1. **Driver-reported**: Add a 3-button occupancy selector to the driver's nav panel
2. **Crowdsourced**: Let passengers tap to report current crowding level
3. **Both**: Driver sets initial, passengers confirm/override

**Files to modify**:
- `DriverMap.tsx` — Add occupancy selector buttons in `bottomControls`
- Firebase RTDB `activeBuses/{id}` — Add `occupancy: "low" | "medium" | "high"` field
- New: `components/passenger/OccupancyBadge.tsx`
- `PassengerMap.tsx` — Read occupancy from bus data, render badge
- `NextBusCard.tsx` — Display occupancy bar

---

### P1-3 · Trip History

> **Inspired by**: Uber, Moovit

**What**: Log each completed ride (route, start/end stop, duration, date, driver rating) to Firestore. Display in Account tab.

**Files to modify**:
- `passenger/page.tsx` — On feedback modal close, write trip record
- New: `components/passenger/TripHistory.tsx`
- `AccountTab.tsx` — Add "Trip History" menu item
- New: Firestore collection `users/{uid}/trips`

**Data shape**:
```ts
interface TripRecord {
  routeId: string;
  routeName: string;
  startStopName: string;
  endStopName: string;
  busId: string;
  driverId: string;
  rating: number;
  startTime: Timestamp;
  endTime: Timestamp;
}
```

---

### P1-4 · Onboarding Flow (First-Time User)

> **Inspired by**: Citymapper, Moovit

**What**: A 3-step onboarding for first-time users:
1. **Location permission** — "Allow location to find nearby buses"
2. **Notification permission** — "Get alerted when your bus arrives"
3. **Quick demo** — Animated overlay showing: search -> track -> get off

**Why**: Current app drops users on a landing page, then into a blank map. 70%+ of new users will churn if they don't understand the value in 10 seconds.

**Files to modify**:
- New: `components/passenger/OnboardingFlow.tsx`
- `passenger/page.tsx` — Check `localStorage.getItem('onboarded')`, show flow if missing
- Request permissions progressively during the flow

---

### P1-5 · Service Disruption Alerts

> **Inspired by**: Citymapper, Google Maps, Moovit

**What**: Admin/driver can push route-level alerts (detour, breakdown, cancellation) that appear as a banner on the passenger's map.

**Files to modify**:
- Firebase RTDB: new path `alerts/{routeId}` with `{ type, message, severity, timestamp }`
- New: `components/passenger/DisruptionBanner.tsx`
- `passenger/page.tsx` — Subscribe to `alerts/{selectedRouteId}`
- `admin/` — Add alert creation UI

---

### P1-6 · Haptic Feedback on Key Interactions

> **Inspired by**: Uber, iOS native apps

**What**: Add `navigator.vibrate()` micro-haptics to:
- Route selection change
- Timeline sheet open/close
- "Go Live" button press (driver)
- Message sent confirmation
- Stop arrival

**Files to modify**:
- New: `lib/haptics.ts` — Utility with patterns
- All interactive components — Add `haptics.tap()` calls

**Technical sketch**:
```ts
// lib/haptics.ts
export const haptics = {
  tap: ()     => navigator.vibrate?.(10),
  select: ()  => navigator.vibrate?.(15),
  success: () => navigator.vibrate?.([10, 50, 10]),
  alert: ()   => navigator.vibrate?.([200, 100, 200]),
  error: ()   => navigator.vibrate?.([50, 30, 50, 30, 50]),
};
```

---

### P1-7 · Activate Gamification Stubs

> **Stubs already exist in**: `PassengerMap.tsx` L484-503

**What**: The Sparkles (Cleanliness confirm), AlertTriangle (Report Delay), and Award (Badges) buttons exist but are non-functional. Wire them up.

**Implementation**:
- **Cleanliness Confirm**: Write to `crowdsourcedReports/{busId}/cleanliness` in RTDB. Show "+10 pts" toast.
- **Report Delay**: Write to `crowdsourcedReports/{busId}/delays`. If 3+ passengers report -> auto-flag route.
- **Digital Badges**: Track `users/{uid}/points` in Firestore. Award badges at thresholds (10 reports = "Scout", 50 rides = "Commuter", etc.)

**Files to modify**:
- `PassengerMap.tsx` — Add `onClick` handlers to the three buttons
- New: `lib/gamification.ts` — Points logic + badge definitions
- `AccountTab.tsx` — Display badge collection + points
- New: `components/passenger/PointsToast.tsx`

---

### P2-1 · Persistent "Ongoing Trip" Bar

> **Inspired by**: Google Maps ongoing trip bar, Uber ride-in-progress

**What**: When a bus is being tracked, show a slim persistent bar at the top of the screen (even when user navigates to Account tab) showing: route, ETA, and a "Back to Map" button.

**Files to modify**:
- New: `components/passenger/OngoingTripBar.tsx`
- `passenger/page.tsx` — Render when `hasBus && activeTab !== "map"`

---

### P2-2 · Estimated Fare Display

> **Inspired by**: Uber, Moovit

**What**: Show the bus fare for the selected route segment in the NextBusCard / Timeline. Store fare data per route in Firestore.

**Files to modify**:
- Firestore `routes/{id}` — Add `baseFare`, `perStopFare` fields
- `RouteTimelineSheet.tsx` — Display fare calculation
- `NextBusCard.tsx` — Show fare badge

---

### P2-3 · Dark/Light Theme Toggle

> **Inspired by**: Google Maps, system preference detection

**What**: Detect `prefers-color-scheme` and offer manual toggle. Currently hardcoded dark.

**Files to modify**:
- `globals.css` — Add `:root[data-theme="light"]` variables
- `AccountTab.tsx` — Add theme toggle
- New: `hooks/useTheme.ts`

---

### P2-4 · Offline Schedule Cache (Service Worker)

> **Inspired by**: Moovit, Citymapper

**What**: Cache route data + stop locations in a Service Worker so the route planner works offline. Show "Offline mode — schedules may be outdated" banner.

**Files to modify**:
- New: `public/sw.js` — Service worker with cache-first strategy for `/api/routes`
- `next.config.js` — Register SW
- `route-planner/page.tsx` — Fall back to cached `predefinedRoutes.ts`

---

### P2-5 · Accessibility Hardening

> **Inspired by**: WCAG 2.1 AA, Moovit, Google Maps

**What**: Systematic accessibility pass:
1. Add `aria-label` to every interactive element
2. Ensure 4.5:1 contrast ratio on all text
3. Add `role="status"` to live ETA regions (screen reader announces updates)
4. Add `aria-live="polite"` to the NextBusCard
5. Make the wheelchair filter functional — filter routes by wheelchair accessibility data
6. Support `prefers-reduced-motion` — disable animations

**Files to modify**:
- All components — Add missing ARIA attributes
- `globals.css` — Add `@media (prefers-reduced-motion)` rules
- `passenger/page.tsx` — Wire wheelchair button to filter `routes` by accessibility flag

---

## 4 · Implementation Roadmap

```
Phase 1 (Week 1-2) — P0 Items
  P0-1  Destination Search Bar
  P0-2  Next Bus Card
  P0-3  Get Off Alert (vibration + notification)
  P0-4  Multi-Language (en/hi/gu)

Phase 2 (Week 3-4) — P1 Items
  P1-1  Saved Places
  P1-2  Crowding Indicator
  P1-3  Trip History
  P1-4  Onboarding Flow
  P1-5  Disruption Alerts
  P1-6  Haptic Feedback
  P1-7  Gamification Activation

Phase 3 (Week 5-6) — P2 Items
  P2-1  Ongoing Trip Bar
  P2-2  Fare Display
  P2-3  Dark/Light Theme
  P2-4  Offline Cache
  P2-5  Accessibility Hardening
```

---

## 5 · Key UX Principles to Follow (from competitors)

| Principle | Source | How to Apply |
|---|---|---|
| **Two-Tap Rule** | Moovit | Any core action (find bus, track, get off) must be 2 taps or fewer from home |
| **Thumb-Reach Design** | All | Keep primary controls in bottom 40% of screen |
| **Glanceable Data** | Google Maps | ETA must be readable in under 1 second without interaction |
| **Progressive Disclosure** | Uber | Show essentials first, details on expand |
| **Context-Aware UI** | Uber | Show different controls based on tracking state |
| **Reduce Cognitive Load** | Citymapper | Max 3 data points visible at once per card |
| **Haptic Confirmation** | iOS/Android | Every button press = micro-vibration |
| **Fail Gracefully** | All | Offline? Show cached data + clear banner |

---

## 6 · Security Audit — Full-Stack Vulnerability Report

> **Audit Methodology**: Every file in `frontend/src/`, `backend/src/`, `functions/src/`, `firestore.rules`, `database.rules.json`, `firebase.json`, `serve.js`, `.gitignore`, and all config files were read line-by-line. Findings are classified using OWASP severity levels.

### Legend
- 🔴 **CRITICAL** — Exploitable now, active data leak risk
- 🟠 **HIGH** — Significant risk under adversarial conditions
- 🟡 **MEDIUM** — Defense-in-depth gap, exploitable in edge cases
- 🟢 **LOW** — Best practice violation, no immediate exploit path

---

### SEC-01 · 🔴 CRITICAL — Firebase RTDB Rules Allow Any Authenticated User to Write Bus Locations

**File**: `database.rules.json` L4-7

**The Problem**:
```json
"activeBuses": {
  ".read": true,
  "$busKey": {
    ".write": "auth != null"
  }
}
```

Any authenticated user (including a random passenger who just signed in with Google) can write to `activeBuses/{anything}`. This means **any logged-in user can inject fake bus locations**, spoof GPS coordinates, or overwrite real driver data.

**Impact**: A malicious user can make phantom buses appear on every passenger's map, redirect passengers to wrong locations, or delete real bus data.

**Fix** (implement immediately):
```json
"activeBuses": {
  ".read": true,
  "$busKey": {
    ".write": "auth != null && root.child('users/' + auth.uid).child('role').val() === 'driver'"
  }
}
```

**Priority**: P0 — fix before any public deployment

---

### SEC-02 · 🔴 CRITICAL — Firebase RTDB Messages Allow Any User to Write to Any Bus Channel

**File**: `database.rules.json` L9-14

**The Problem**:
```json
"messages": {
  "$busId": {
    ".read": true,
    ".write": "auth != null"
  }
}
```

Any authenticated user can push messages to ANY bus channel, not just one they're connected to. A single bad actor can flood every bus channel with spam, phishing links, or profanity.

**Impact**: Mass spam across all bus channels. The client-side profanity filter is trivially bypassed since it's only applied at write-time in the frontend — an attacker can use the Firebase REST API directly.

**Fix**:
```json
"messages": {
  "$busId": {
    ".read": true,
    "$messageId": {
      ".write": "auth != null",
      ".validate": "newData.hasChildren(['text', 'from', 'senderName', 'senderId', 'timestamp'])
        && newData.child('senderId').val() === auth.uid
        && newData.child('text').isString()
        && newData.child('text').val().length <= 500"
    }
  }
}
```

**Priority**: P0

---

### SEC-03 · 🟠 HIGH — Socket Auth Allows Bad Tokens as Anonymous (Not Rejected)

**File**: `backend/src/server.ts` L143-147

**The Problem**:
```ts
} catch {
  // Bad token — still let them in as anonymous rather than hard-reject
  (socket as any).user = { uid: "anonymous", role: "passenger" };
  next();
}
```

A user who provides an **invalid/expired/forged token** is silently upgraded to an anonymous connection instead of being rejected. This means an attacker can send any garbage token and still connect. Combined with SEC-04, this creates a vector for unauthorized socket events.

**Fix**: Reject bad tokens. Only allow genuinely no-token connections as anonymous:
```ts
} catch {
  return next(new Error("Invalid authentication token"));
}
```

**Priority**: P0

---

### SEC-04 · 🟠 HIGH — Socket Driver Events Lack Role Verification

**File**: `backend/src/sockets/trackingGateway.ts` L173+

**The Problem**: The `driver:start-tracking`, `driver:location-update`, `driver:stop-tracking`, and `driver:route-update` socket events do **not check** whether the connected socket has a `driver` or `admin` role. Any anonymous or passenger socket can emit these events and:
- Register as a fake driver
- Push fake GPS coordinates to all passengers
- Stop real buses from tracking

The only role check in the gateway is for `admin:join` (L144-148). All driver events trust the client completely.

**Fix**: Add role check at the top of every driver event handler:
```ts
socket.on("driver:start-tracking", async (payload) => {
  const socketUser = (socket as any).user;
  if (socketUser?.role !== "driver" && !socketUser?.admin && socketUser?.uid !== "dev-bypass") {
    console.warn(`[driver:start-tracking] Rejected — socket ${socket.id} lacks driver role`);
    return;
  }
  // ... rest of handler
});
```

**Priority**: P0

---

### SEC-05 · 🟠 HIGH — `POST /api/requests` Has No Authentication

**File**: `backend/src/routes/requests.ts` L23

**The Problem**: The `POST /` endpoint creates passenger requests without ANY authentication. No Firebase token, no session — nothing. Any bot can flood the server with fake pickup requests.

**Fix**: Add auth middleware or at minimum validate a Firebase token:
```ts
router.post("/", requireAuth, (req, res) => { ... });
```

**Priority**: P1

---

### SEC-06 · 🟠 HIGH — `GET /api/buses` and `GET /api/analytics/fleet` Are Unauthenticated

**Files**: `backend/src/routes/buses.ts` L10, `backend/src/routes/analytics.ts` L7

**The Problem**: These endpoints expose the real-time location (lat/lng, heading, speed) and fleet statistics of every active bus to **anyone on the internet** without authentication. This is operationally sensitive data.

**Fix**: At minimum, require a valid Firebase token (not necessarily admin):
```ts
router.get("/", requireAuth, (_req, res) => { ... });
```

**Priority**: P1

---

### SEC-07 · 🟡 MEDIUM — XSS via `dangerouslySetInnerHTML` in Navigation Components

**Files**:
- `DirectionsPanel.tsx` L74
- `NavInstructionBanner.tsx` L74

**The Problem**:
```tsx
dangerouslySetInnerHTML={{ __html: step.navigationInstruction?.instructions || "Drive" }}
```

These render HTML from the Google Maps Directions API directly into the DOM. While Google's API is trusted, if the response is ever intercepted (MITM), or if a future API change returns user-controlled content, this becomes an XSS vector.

**Fix**: Use `DOMPurify` to sanitize:
```ts
import DOMPurify from 'dompurify';
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(step.navigationInstruction?.instructions || "Drive") }}
```

**Priority**: P2

---

### SEC-08 · 🟡 MEDIUM — `innerHTML` in Map Markers Without Sanitization

**Files**:
- `PassengerMap.tsx` L69, L147
- `DriverMap.tsx` L435

**The Problem**: Map marker content is built using template literals injected via `innerHTML`. Currently the data is internal (route names, stop names), but if route names in Firestore are ever user-contributed (e.g., admin panel input), this becomes a stored XSS vector.

**Fix**: Use `textContent` for plain text, or sanitize dynamic values:
```ts
const name = document.createTextNode(routeName);
el.appendChild(name);
```

**Priority**: P2

---

### SEC-09 · 🟡 MEDIUM — Client-Side Role Guard is Bypassable

**File**: `frontend/src/components/shared/RoleGuard.tsx`

**The Problem**: Role-based access control on the frontend is a UI guard only — it prevents rendering but doesn't prevent direct API/Firestore access. A user can:
1. Open browser DevTools
2. Modify the `user` state to `role: "admin"`
3. Access admin panel UI

This is mitigated by Firestore rules (which properly check roles server-side), but the admin REST API endpoints in the backend are the true security boundary.

**Mitigation**: Already partially addressed — Firestore rules check `isAdmin()` server-side. Just ensure ALL backend endpoints enforce auth.

**Priority**: P2 (defense-in-depth)

---

### SEC-10 · 🟡 MEDIUM — Profanity Filter is Client-Side Only

**File**: `MessagingPanel.tsx` L86-88

**The Problem**: The `PROFANITY_REGEX` filter runs in the browser before `push()` to Firebase RTDB. An attacker can bypass it entirely by:
1. Using the Firebase REST API directly
2. Modifying the request in DevTools
3. Using a custom script

**Fix**: Implement server-side message validation via RTDB rules (see SEC-02 fix) AND/OR a Cloud Function trigger:
```ts
exports.filterMessages = functions.database
  .ref('messages/{busId}/{messageId}')
  .onCreate((snap) => {
    const text = snap.val().text;
    if (PROFANITY_REGEX.test(text)) {
      return snap.ref.update({ text: '*** [filtered] ***' });
    }
    return null;
  });
```

**Priority**: P1

---

### SEC-11 · 🟡 MEDIUM — No Input Length Limits on Frontend Text Fields

**Files**: `MessagingPanel.tsx` L241-254, `FeedbackModal.tsx` L113-118

**The Problem**: Neither the message input nor the feedback textarea has a `maxLength` attribute. A user can paste megabytes of text, which:
1. Gets written to Firebase (storage cost attack)
2. Causes rendering issues for other users reading the messages
3. Can degrade performance on low-end devices

**Fix**: Add `maxLength` to both inputs:
```tsx
<input maxLength={500} ... />   // Messages
<textarea maxLength={2000} ... /> // Feedback
```

**Priority**: P1

---

### SEC-12 · 🟡 MEDIUM — `DISABLE_SOCKET_AUTH` Env Bypass

**File**: `backend/src/server.ts` L127

**The Problem**:
```ts
if (process.env.DISABLE_SOCKET_AUTH === "true" && process.env.NODE_ENV !== "production") {
  (socket as any).user = { uid: "dev-bypass", role: "admin" };
  return next();
}
```

If `NODE_ENV` is not explicitly set to `"production"` on the deployment server (which is a common oversight), and `DISABLE_SOCKET_AUTH` is left as `true`, **all socket connections get admin privileges**.

**Fix**: Remove this code entirely or gate it behind a stricter check:
```ts
if (process.env.DISABLE_SOCKET_AUTH === "true" && process.env.NODE_ENV === "development") {
```

**Priority**: P1

---

### SEC-13 · 🟡 MEDIUM — Missing Security Headers on Firebase Hosting

**File**: `firebase.json` L19-38

**The Problem**: Only `Cache-Control` headers are configured. Missing:
- `Content-Security-Policy` — No CSP for the frontend (Google Maps, Firebase JS SDK, and fonts all need to be allow-listed)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` — App can be iframed for clickjacking
- `Referrer-Policy`
- `Permissions-Policy`

**Fix**: Add to `firebase.json`:
```json
{
  "source": "**",
  "headers": [
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "X-Frame-Options", "value": "DENY" },
    { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
    { "key": "Permissions-Policy", "value": "geolocation=(self), microphone=(), camera=()" }
  ]
}
```

**Priority**: P1

---

### SEC-14 · 🟢 LOW — Hardcoded Firebase Database URL in Backend

**File**: `backend/src/lib/firebaseAdmin.ts` L21, L27, L32

**The Problem**: The fallback `databaseURL` is hardcoded:
```ts
databaseURL: process.env.FIREBASE_DATABASE_URL || "https://bustrack-be165-default-rtdb.firebaseio.com"
```

If the env var is missing, the server silently connects to a specific project. This isn't a vulnerability per se, but it means a misconfigured deployment could accidentally read/write to the wrong Firebase project.

**Fix**: Fail hard if the env var is missing in production:
```ts
const dbUrl = process.env.FIREBASE_DATABASE_URL;
if (!dbUrl && process.env.NODE_ENV === "production") {
  throw new Error("FIREBASE_DATABASE_URL is required in production");
}
```

**Priority**: P2

---

### SEC-15 · 🟢 LOW — `serve.js` Static File Server Has No Rate Limiting

**File**: `serve.js`

**The Problem**: The prototype static file server has no rate limiting, no security headers, and serves all files in the project root. While it has a path traversal guard, it's likely only used in development.

**Fix**: Add a comment that this is dev-only, or remove it from the repo.

**Priority**: P2

---

### SEC-16 · 🟢 LOW — User Data Mirror to RTDB is Redundant and Expands Attack Surface

**File**: `frontend/src/hooks/useAuth.ts` L79

**The Problem**:
```ts
const userDbRef = ref(rtdb, `users/${firebaseUser.uid}`);
await set(userDbRef, userData);
```

User profile data (email, displayName, photoURL) is mirrored to RTDB, but there are NO RTDB rules for the `users/` path — which means it falls under the default deny. If someone adds a catch-all read rule later, all user PII becomes publicly readable.

**Fix**: Remove the RTDB mirror — Firestore is the stated source of truth:
```ts
// Remove lines 78-80 — RTDB user mirror is redundant
```

**Priority**: P2

---

## 7 · Security Audit Summary

### Scorecard

| Category | Score | Notes |
|---|:---:|---|
| **Firebase RTDB Rules** | 🔴 2/10 | Rules are dangerously permissive — any auth user can write bus data and messages |
| **Firestore Rules** | 🟢 9/10 | Well-structured with proper role checks, owner validation, and field constraints |
| **Socket.io Authentication** | 🟠 5/10 | Token verification exists but bad tokens aren't rejected + no role checks on driver events |
| **REST API Authentication** | 🟠 6/10 | Admin endpoints protected, but read endpoints and POST /requests are open |
| **Input Validation (Backend)** | 🟢 8/10 | Good lat/lng bounds checking, string length limits, allowlists for enums |
| **Input Validation (Frontend)** | 🟡 5/10 | Missing maxLength on inputs, profanity filter is client-only |
| **XSS Protection** | 🟡 6/10 | Two `dangerouslySetInnerHTML` usages + 3 `innerHTML` usages unsanitized |
| **CORS Configuration** | 🟢 8/10 | Properly restricted to known origins |
| **Rate Limiting** | 🟢 8/10 | HTTP limiter (200/min), socket limiter (2/sec), passenger request limiter (5/10s) |
| **Secrets Management** | 🟢 9/10 | Env vars via `.env`, `.gitignore` covers secrets, no keys in git history |
| **Security Headers** | 🟡 5/10 | Helmet on backend, but no CSP/X-Frame on Firebase Hosting frontend |
| **Logging** | 🟡 6/10 | No PII in logs, but verbose — needs log levels for production |

### Critical Fix Order

```
IMMEDIATE (before any public deployment):
├── SEC-01  Lock RTDB activeBuses writes to driver role
├── SEC-02  Lock RTDB messages with validation rules
├── SEC-03  Reject bad socket tokens (don't silently allow)
└── SEC-04  Add role checks to all driver socket events

NEXT SPRINT:
├── SEC-05  Auth on POST /api/requests
├── SEC-06  Auth on GET /api/buses & analytics
├── SEC-10  Server-side profanity filter
├── SEC-11  maxLength on all text inputs
├── SEC-12  Remove DISABLE_SOCKET_AUTH bypass
└── SEC-13  Security headers on Firebase Hosting

HARDENING:
├── SEC-07  DOMPurify for dangerouslySetInnerHTML
├── SEC-08  Sanitize innerHTML in map markers
├── SEC-09  Document that RoleGuard is UI-only
├── SEC-14  Fail-hard on missing env vars in prod
├── SEC-15  Remove or gate serve.js
└── SEC-16  Remove RTDB user data mirror
```

---

## 8 · Deep UI/UX Structural Analysis

### 8.1 — Architecture Strengths

| Pattern | Assessment |
|---|---|
| **Imperative marker management** (PassengerMap) | Excellent — avoids React reconciliation overhead for real-time map objects. Industry-standard for Google Maps Advanced Markers |
| **GPS interpolation with `requestAnimationFrame`** | Professional-grade — creates smooth 60fps bus movement between discrete GPS pings |
| **Context-aware bottom sheet** (RouteTimelineSheet) | Good use of progressive disclosure — shows stops only when relevant |
| **Safe-area padding** (MessagingPanel) | Correct iOS notch handling via `env(safe-area-inset-bottom)` |
| **Firebase RTDB for telemetry** | Correct architecture — RTDB's ~200ms latency is ideal for real-time GPS vs Firestore's ~500ms |
| **Socket.io with msgpack parser** | Reduces payload size by ~30% vs JSON — good for mobile data plans |
| **Trajectory smoothing** (Kalman filter proxy) | Reduces GPS jitter — professional touch |
| **ETA API cost optimization** (500m movement threshold) | Smart cost control — prevents unnecessary Google Routes API calls |

### 8.2 — Structural UX Issues

| Issue | Location | Impact |
|---|---|---|
| **Route selection requires expert knowledge** | `passenger/page.tsx` L125-170 | Users must know route number before they can track — fails for new riders |
| **3-dropdown cascade** (route → stop → option) | `passenger/page.tsx` L125-200 | 3 sequential selections before seeing a bus = high cognitive load |
| **Turbo/Budget/♿ toggles are non-functional** | `passenger/page.tsx` L156-158 | UI implies filtering capability that doesn't exist — breaks user trust |
| **No loading skeleton for map** | `PassengerMap.tsx` | Map shows blank white/black while Google Maps JS loads — jarring |
| **Tab bar is custom, not native-feel** | `passenger/page.tsx` L278-310 | Missing iOS safe-area bottom inset on the tab bar itself |
| **Gamification buttons do nothing on tap** | `PassengerMap.tsx` L484-503 | Three prominent buttons (✨⚠️🏅) with no click handlers = dead UI |
| **Feedback modal has no connection to trip context** | `FeedbackModal.tsx` | When opened from Account tab, has no busId/driverId — feedback is generic |
| **Driver map NavInstruction banner overlaps controls** | `DriverMap.tsx` L400-450 | On small screens, the instruction banner can overlap the delay buffer controls |
| **No empty state for Route Planner search** | `route-planner/page.tsx` | If no routes match, user sees a blank panel with no guidance |
| **Alert/toast system is `window.alert()`** | `MessagingPanel.tsx` L99 | Using native `alert()` for rate limiting breaks the premium UX aesthetic |

### 8.3 — Performance Concerns

| Issue | Location | Risk |
|---|---|---|
| **Firebase `onValue` without `.limitToLast()`** | `MessagingPanel.tsx` L47 | Downloads ALL messages on every render — will degrade as message count grows |
| **No message pagination** | `MessagingPanel.tsx` | For high-traffic routes, hundreds of messages will render simultaneously |
| **Full Firestore scan in `/api/analytics/fleet`** | `analytics.ts` L10 | `db.collection("bus_locations").get()` fetches every document — O(n) cost |
| **Route polylines cached in-memory without TTL** | `etaService.ts` L55 | If routes are updated, cached polylines never refresh until server restart |
| **No image lazy-loading** | `AccountTab.tsx` L38 | Profile photo loaded eagerly with no `loading="lazy"` attribute |

---

> **Next Step**: The security items in SEC-01 through SEC-04 (all 🔴/🟠 CRITICAL/HIGH) should be fixed **before any public launch**. Review this document and confirm the fix order. Each security fix and feature proposal is self-contained and can be implemented independently.
