# Eki frontend

Next.js 16 App Router static-export PWA with public landing and authenticated passenger, driver, admin and feedback workspaces. Firebase Auth supplies identity; RTDB `onValue` pushes live buses; Firestore `onSnapshot`/queries provide configuration, sessions, messages, settings and feedback. REST mutations use native `fetch` with Firebase bearer tokens.

## Run

```powershell
npm install
Copy-Item frontend/env.production.example frontend/.env.local
npm run dev --workspace=frontend
```

The template lists every production-required public variable including RTDB URL, Maps API key/map ID, reCAPTCHA Enterprise App Check key and HTTPS backend. Browser Firebase/Maps values are public identifiers and must be restricted in their consoles. App Check debug tokens are local-only secrets and must never be production/committed.

```powershell
npm run lint --workspace=frontend
npm run test --workspace=frontend
npm run build --workspace=frontend
```

The root `npm run build` follows Next export with Workbox manifest injection and CSP hash regeneration. `npm run build:production` enables strict required-variable and non-local HTTPS validation.

## Runtime design

- `RoleGuard` improves presentation/routing only; Firestore/RTDB rules and backend middleware are the authorization boundary.
- `liveBusStore` maintains one shared RTDB subscription and prunes stale non-active entries. Firestore collection/settings hooks also share/auth-gate listeners.
- Google Maps provider loads once per protected workspace. Stored polylines and local distance/speed math avoid passenger runtime Routes calls.
- Only the active admin tab is mounted, preventing hidden maps/listeners/timers.
- Service worker precaches the revisioned static app, may cache explicit public maps/fonts/images, and never caches authenticated Firebase/API or unknown requests.
- Dialogs trap/restore focus and support Escape; selects are native; map smoothing respects reduced motion; private routes are no-index.

See [LLD](../docs/design/LOW_LEVEL_DESIGN.md), [Firebase model](../docs/data/FIREBASE_DATA_MODEL.md), and [test strategy](../docs/testing/TEST_STRATEGY.md).
