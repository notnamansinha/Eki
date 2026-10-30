# Production Audit Browser Fixture

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-010 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This fixture keeps regression tests for defects confirmed in the [production audit claim validation](../../docs/testing/PRODUCTION_AUDIT_VALIDATION_2026_10_20.md) and for hostile browser conditions. It renders the real admin dashboard, passenger workspace, map, carousel, route editor and history components against synthetic Auth, collection, RTDB, HTTP and Maps boundaries. It uses no Firebase service account, provider key, real route change or GNSS hardware. The fixture controls exist only in this test entry point; the product has no geofence or authorization bypass.

## 2. Run

From the repository root:

```powershell
npx playwright test --config playwright.production-audit.config.ts
```

The configuration starts the Vite fixture on `http://127.0.0.1:3123` and runs `e2e/production-audit/audit.spec.ts` and `resilience.spec.ts` in three projects: narrow (360 x 800), mobile (390 x 844) and desktop (1280 x 800), with one worker. Screenshots, measurements and `results.json` go to `artifacts/production-audit/`, which CI keeps for seven days.

## 3. Checks

`audit.spec.ts`:

- Telemetry 90 to 200 s old, well past the 30 s threshold in `frontend/src/lib/liveBusFreshness.ts`, shows **Live location updates delayed** to the admin and **Live tracking lost** to the passenger; a fresh delivery clears both without reload.
- A denied passenger detail subscription shows a live-data error distinct from a telemetry delay, and clears after a new delivery.
- Long route and endpoint labels render in full and stay selectable; the tracking header keeps the full route name while waiting for data.
- History shows recorded interruption reasons and labelled fallbacks for legacy records.
- The empty-search notice contrast is measured from the rendered foreground and the composed ancestor backgrounds. The result applies to this dark fixture only.
- Map movement stays inspectable under four-times Chromium CPU throttling. This measures accessibility-tree serialisation and screenshot time, not Google Maps performance, battery use or display latency.

`resilience.spec.ts` intercepts place search and route save and delete requests:

- Place search: a 500 response, a non-JSON gateway error, a malformed success body, a stale slow response, offline search, rate limiting and hostile place names rendered as text.
- Route save: a 500 response with a successful retry, a dropped save reconciled with the same `saveId`, and a double-activated Update that sends one request.
- Route delete: a failed deletion reports its reason and leaves the route listed.
- Passenger: offline toggles and window resizes, two tabs, reload, and browser back and forward.

## 4. Limits

Intercepted responses do not certify real Firebase reconnects, permissions, provider behaviour or GNSS quality.
