# Manual in-app Google Maps check

This mounts the unchanged production `MapProviders`, `PassengerMap`,
`DashboardPanel`, `DirectionsRoute`, marker selectors and animation hooks.
Google Maps JavaScript, basemap tiles, the admin traffic layer, polylines and
advanced markers are real. Synthetic stores replace Firebase/auth/fleet data.
The two maps have separate provider contexts, as they do on their actual pages.

Prerequisites: installed workspace dependencies; a configured frontend browser
Maps key and map ID; and the successful local two-direction Routes probe at
`artifacts/routing-provider/result.json`. That artifact contains public preset
geometry, not a live bus assignment. The initial probe and its manual repeat
command are documented in `docs/routing-lifecycle-verification.md`.

To prepare that ignored local artifact in a fresh checkout, explicitly run:

```powershell
npm run build --workspace=backend
node e2e/routing/live-maps/prepare-geometry.cjs 'C:\absolute\path\to\backend\.env'
```

This manual preparation calls the real server-side Routes wrapper at most twice
(one request per direction, no retries), using only the public preset stops.
It performs no Firebase initialization or writes. Do not put it in default CI.

From the repository root in PowerShell:

```powershell
$env:EKI_MAPS_ENV_FILE = 'C:\absolute\path\to\frontend\.env.local'
node node_modules/vite/bin/vite.js --config e2e/routing/live-maps/vite.config.mts
```

Open `http://127.0.0.1:3163/?telemetryTrace=1`. Use A → B / B → A, Next fix,
Play simulated GNSS, Low-confidence fix and Delayed old revision. The
Reach next stop control advances the backend-style next-stop index independently
of marker displacement: only the current road leg is blue, with other legs grey.
The actual passenger timeline and admin live-details dialog are available. Start-service
and messaging mutations are outside this replay. The dev server binds loopback
only and receives only the existing public browser Maps key/map ID.

To run the automated check (it can start the server itself):

```powershell
node_modules/.bin/playwright.cmd test --config playwright.routing.maps.config.ts
node_modules/.bin/tsc.cmd --noEmit --project e2e/routing/live-maps/tsconfig.json
```

The test waits for both real Maps `tilesloaded` events, compares each map's SDK
polyline coordinates with the independently computed directional Google paths,
and checks actual advanced-marker movement, confidence hold/fallback, recovery
and rejection of an older revision. SDK observers delegate to the real Google
objects. Screenshots and redacted SDK/network evidence go to
`artifacts/routing-in-app-maps/`. Browser traces/HAR are disabled to avoid saving
API keys in request URLs. Only loopback and the Maps/font provider hosts are
allowed by the automated test; unexpected Firebase/backend/Routes traffic fails.

This is deliberately separate from default/offline suites. Each execution loads
real Google maps and can consume Maps quota. It reuses cached route geometry and
makes no new Routes calls. It does not verify cloud subscriptions, authenticated
page navigation, the backend-to-Firebase transport, or physical GNSS accuracy.
No recurring/background verification is configured.
