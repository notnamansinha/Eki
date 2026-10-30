# Passenger UI Fixture

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-008 | 2.0 | Current | 2026-10-30 |

## 1. Purpose

This Vite fixture renders the real passenger workspace, route carousel, passenger map logic, timeline, route schedule tab, profile, feedback modal and application CSS with synthetic data held in memory. It has no Firebase connection, credentials or backend writes. It serves manual layout checks and the automated passenger layout suite.

## 2. What is real and what is replaced

`e2e/fixtures/vite.config.mts` swaps these modules:

| Replaced with synthetic data | Replaced with a placeholder panel |
|---|---|
| Auth, routes, passenger route schedules (`usePassengerRouteConfig`), live route catalog, settings, RTDB resume, route geometry, live bus store and joined-ride hooks; `firebaseAuth`, `feedbackStore` and `apiClient` | Chat (`MessagingPanel`), the boarding view, and the admin dashboard, route, fleet, history and feedback panels |

`RoleGuard` and `WorkspacePrefetch` pass through. The Google Maps SDK is replaced by a synthetic adapter, labelled on screen, that draws configured stops and positions without tiles or road geometry. Settings changes exist only in memory and disappear on restart.

## 3. Manual check

1. From the repository root, start the fixture:

   ```powershell
   npx vite --config e2e/fixtures/vite.config.mts
   ```

   It listens on `http://127.0.0.1:3100/`. Set `EKI_QA_PORT` to use another port.

2. Choose a scenario in the **QA scenario** list, or open `/?scenario=<name>`. The scenarios are `pending`, `reconnecting`, `stale`, `offline`, `forward`, `reverse`, `multiple`, `multiple-stale`, `gnss-lost`, `mixed`, `two-routes`, `projection-unready`, `catalog-denied`, `detail-denied`, `device`, `empty` and `completed`. Choosing a scenario refreshes the synthetic timestamps; quiet device data then expires as it would in the application.

3. Open a route card and check Back and the **Map**, **Routes** and **Profile** tabs. With `multiple`, select the second bus. The synthetic `settings/passengerRoutes` approves the Campus Loop and then QA route; add `?schedule=demo` to add the five-stop Campus Loop route, which has no live service and appears only in the **Routes** tab, with one stop deliberately left without a time. Without that parameter the Routes tab shows QA route alone. `device` opens the route with a stationary tracker position and no ride. `empty` and `completed` offer no selectable service.

4. Check at desktop size and at 390 x 844. Inactive panels must be absent from the accessibility tree and must not intercept pointer clicks.

## 4. Automated layout suite

```powershell
npx playwright test --config playwright.passenger-layout.config.ts
```

The configuration starts this fixture and runs `e2e/passenger-layout/warnings.spec.ts`, `video-audit.spec.ts` and `routes-schedule.spec.ts` in five projects: narrow 360 x 800, mobile 390 x 844, reported-phone 440 x 956, short-desktop 1280 x 585 and desktop 1280 x 800. The tests check, among other things, that location-delay, reconnecting and GNSS-loss warnings sit below the variable-height ride header without overlap and clear on recovery; that offline and stale buses leave the picker; that the footer, navigation, chat overlay and feedback modal keep their positions on short and landscape screens; and that the passenger frame cannot scroll under the viewport. `routes-schedule.spec.ts` opens `/?schedule=demo` and checks that the Routes tab lists the approved schedules on an alternating timeline, that the three navigation tabs fit narrow phones with the schedule scrolling clear of them, and that **Map** returns to the live routes while the hidden schedule cannot intercept taps. Screenshots and traces go to `artifacts/passenger-layout/`, which CI keeps for seven days.

## 5. Limits

Boarding and chat are placeholders here; their real components have separate tests, including `npm run qa:browser`. The fixture does not measure real GPS, Google Maps paint or network-to-map latency, and does not replace emulator or hardware acceptance.
