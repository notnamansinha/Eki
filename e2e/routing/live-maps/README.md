# Live Google Maps Check

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-011 | 1.1 | Current | 2026-11-02 |

## 1. Purpose

This manual L4 check mounts the production `MapProviders`, `PassengerMap`, `DashboardPanel`, `DirectionsRoute`, marker selectors and animation hooks against the real Google Maps JavaScript API: basemap tiles, the admin traffic layer, polylines and advanced markers are real. Synthetic stores replace Firebase, Auth and fleet data, and chat is excluded. The passenger and admin maps have separate provider contexts, as on their real pages.

Each run loads real Google maps and can consume Maps quota. Keep it out of CI and the default suites; no recurring run is configured.

## 2. Prerequisites

- Installed workspace dependencies.
- A frontend `.env.local` with a browser Maps key (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) and map ID (`NEXT_PUBLIC_GOOGLE_MAP_ID`). The fixture server refuses to start without both. The page is served from `http://127.0.0.1:3163`, so the key must allow the referrer `http://127.0.0.1:3163/*`. The shared browser key (project `bustrack-501917`) allows only the Hosting origins and `http://localhost:3000/*` and `http://localhost:3001/*`; add the referrer to the key you use or use a separate development key.
- A successful two-direction Routes probe in `artifacts/routing-provider/result.json` (ignored by Git). The file holds public preset geometry, not a live bus assignment. The [routing lifecycle verification record](../../../docs/testing/ROUTING_LIFECYCLE_VERIFICATION.md) documents the original probe.

## 3. Prepare the route geometry

Run once in a fresh checkout, from the repository root in PowerShell:

```powershell
npm run build --workspace=backend
node e2e/routing/live-maps/prepare-geometry.cjs 'C:\absolute\path\to\backend\.env'
```

The script calls the compiled server-side Routes wrapper at most twice (one request per direction, no retries) with the public preset stops. It does not initialise Firebase or write any data.

## 4. Manual check

1. Start the fixture:

   ```powershell
   $env:EKI_MAPS_ENV_FILE = 'C:\absolute\path\to\frontend\.env.local'
   node node_modules/vite/bin/vite.js --config e2e/routing/live-maps/vite.config.mts
   ```

   The server binds `127.0.0.1:3163` and passes only the public browser Maps key and map ID to the page.

2. Open `http://127.0.0.1:3163/?telemetryTrace=1`.

3. Use the controls: **A → B** and **B → A**, **Next fix**, **Play simulated GNSS**, **Low-confidence fix** and **Delayed old revision**. **Reach next stop** advances the backend-style next-stop index without moving the marker, so road progress can be checked separately from position. The real passenger timeline and admin live details dialog are available.

4. **Open route editor** mounts the real admin route editor on the preset route. Colour changes redraw its road preview through the real SDK, and Cancel discards the draft. Saving is not possible here; it is tested in the [disposable browser acceptance](../../../qa/BROWSER_ACCEPTANCE.md) suite.

## 5. Automated check

With the geometry prepared and `EKI_MAPS_ENV_FILE` set, run from the repository root:

```powershell
node_modules/.bin/playwright.cmd test --config playwright.routing.maps.config.ts
node_modules/.bin/tsc.cmd --noEmit --project e2e/routing/live-maps/tsconfig.json
```

The configuration reuses a running fixture server or starts one. `in-app.spec.ts` has two tests:

- At 1920 x 1080, it waits for `tilesloaded` on both maps, compares each map's SDK polyline coordinates with the independently decoded directional paths, and checks advanced-marker movement, the confidence hold and fallback, recovery, and rejection of an older revision.
- At 360 x 800 with touch, it checks that the passenger marker and stop controls stay usable.

Requests may reach only the fixture server on port 3163, the Google Maps hosts and the Google Fonts hosts; any Firebase, backend or Routes request fails the test. Screenshots and redacted SDK and network evidence go to `artifacts/routing-in-app-maps/`. Traces and HAR files are off because Maps request URLs contain the API key.

## 6. Limits

The check makes no new Routes calls; it reuses the cached geometry. It does not cover cloud subscriptions, signed-in navigation, the backend-to-Firebase path or GNSS accuracy.
