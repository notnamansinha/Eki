# Isolated browser QA

Last updated: 2026-10-20 19:28 IST (UTC+05:30).

From the repository root, run `npx vite --config e2e/fixtures/vite.config.mts`, then open `http://127.0.0.1:3100/`.

The fixture renders the actual passenger workspace, route carousel, settings panel and application CSS. Hook inputs and settings persistence are synthetic and exist only in memory. It has no Firebase connection, credentials or backend writes. Settings changes disappear on a server restart.

Choose pending, forward, reverse, multiple or mixed services and click the route card. Verify Back, Routes and Profile; select the second bus for multiple services. Device opens the configured route and stationary hardware position without pretending a ride has started. Empty and completed expose no selectable service. Inactive panels must be absent from the accessibility tree and must not intercept pointer clicks. Check at desktop size and a 390 × 844 CSS mobile viewport. Set `EKI_QA_PORT` to use another port. Scenario selection refreshes synthetic timestamps; quiet device data intentionally expires.

The passenger map and timeline use their actual application logic with a synthetic Google Maps SDK adapter (labelled on screen). The adapter draws configured stops and positions without requesting Google tiles or road geometry. Boarding, profile, feedback and chat children remain placeholders; their actual components have separate interaction tests. This fixture does not measure real GPS, Google compositor paint or network-to-map latency and does not replace Firebase emulator or hardware acceptance tests.

Run the automated warning layout regression from the repository root:

```powershell
npx playwright test --config playwright.passenger-layout.config.ts
```

It starts this isolated fixture, opens a multiple-service tracking view, advances
the clock through telemetry silence, and checks that the location-delay warning
is below the complete variable-height ride header and unobscured at its center.
It also verifies recovery on fresh delivery and horizontal fit at 360, 390 and
1280 CSS pixels. Screenshots are saved under `artifacts/passenger-layout/` and
retained by CI. The tracking header occupies document flow above the map, so
bus-selection, boarding and chat controls cannot cover its warnings. Boarding
content is still a placeholder in this fixture; genuine role/provider acceptance
and every real boarding-card state remain separate tests.
