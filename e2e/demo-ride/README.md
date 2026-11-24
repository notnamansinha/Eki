# Demo Ride Browser Fixture

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-013 | 1.0 | Current | 2026-11-25 |

## 1. Purpose

This fixture runs the demo ride ([SRS FR-PAS-059](../../docs/requirements/SOFTWARE_REQUIREMENTS_SPECIFICATION.md#325-boarding)) and the Thumb drawer stop picker (FR-PAS-050 to 053 and 058) on the real passenger layout, workspace, boarding view, route timeline, map logic and road drawing. Auth, routes, the live route catalog, settings and RTDB resume come from the shared synthetic fixture in `e2e/fixtures/` (see its [guide](../fixtures/README.md)); chat is a placeholder. The demo ride is the production simulator in `frontend/src/lib/demoRide.ts`, so nothing here contacts Firebase or the backend.

## 2. Run

From the repository root:

```powershell
npx playwright test --config playwright.demo-ride.config.ts
```

The configuration starts the Vite fixture on `http://127.0.0.1:3131` (`EKI_DEMO_PORT` changes it) and runs `demo-ride.spec.ts` in two projects: mobile (390 x 844 with touch) and desktop (1280 x 800). The spec installs the page clock and runs the scripted ride, about five minutes, in a few seconds. Screenshots go to `artifacts/demo-ride/`, which CI keeps for seven days.

For a manual check, start the fixture with `npx vite --config e2e/demo-ride/vite.config.mts` and open `/?scenario=empty` (no live bus, so Live routes shows only the demo ride) or `/?scenario=forward` (the QA route's bus first).

## 3. Maps

By default `maps.tsx` replaces the Google Maps SDK: a Web Mercator camera that the real `MapCenterer` drives, markers placed by projection and the real `DirectionsRoute` polylines drawn as SVG over a paper basemap that only suggests the streets around the route. It is not map data.

For screenshots on real tiles, set `EKI_DEMO_ENV_FILE` to a frontend environment file that holds `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAP_ID`. The fixture then uses the real SDK and serves on `http://localhost:3001`, an allowed referrer of the shared browser key ([configuration](../../docs/CONFIGURATION.md#4-frontend-variables)). Each page load is a billable Dynamic Maps load. Never commit a key or the file.

## 4. Route data

The demo route's road geometry was routed with OSRM on OpenStreetMap data (© OpenStreetMap contributors, ODbL) and is stored in `frontend/src/lib/demoRideRoute.ts` with each stop snapped onto the line: Thaltej Road, across SG Highway at Thaltej Char Rasta, along Drive-in Road and University Road to Ahmedabad University.
