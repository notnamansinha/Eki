# Passenger UI Fixture

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-008 | 2.3 | Current | 2026-11-11 |

## 1. Purpose

This Vite fixture renders the real passenger layout and theme, transit artwork, passenger workspace with its Live routes panel, route carousel, passenger map logic, timeline, route schedule tab, profile, feedback modal and application CSS with synthetic data held in memory. It serves the static files in `frontend/public`, so the artwork images are the published ones. It has no Firebase connection, credentials or backend writes. It serves manual layout checks and the automated passenger layout suite.

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

2. Choose a scenario in the **QA scenario** list, or open `/?scenario=<name>`. The scenarios are `pending`, `reconnecting`, `stale`, `offline`, `forward`, `reverse`, `multiple`, `multiple-stale`, `gnss-lost`, `mixed`, `two-routes`, `many-routes`, `projection-unready`, `catalog-denied`, `detail-denied`, `device`, `empty` and `completed`. Choosing a scenario refreshes the synthetic timestamps; quiet device data then expires as it would in the application.

3. Open a route card and check Back and the **Live**, **Routes** and **Profile** tabs. With `multiple`, select the second bus. The synthetic `settings/passengerRoutes` approves the Campus Loop and then QA route; add `?schedule=demo` to add the five-stop Campus Loop route, which has no live service and appears only in the **Routes** tab, with one stop deliberately left without a time. Without that parameter the Routes tab shows QA route alone. `many-routes` adds seven more QA routes, each with one bus, so the desktop Live Routes list overflows and scrolls. `device` opens the route with a stationary tracker position and no ride. `empty` and `completed` offer no selectable service.

4. Check at desktop size and at 390 x 844. Inactive panels must be absent from the accessibility tree and must not intercept pointer clicks. With touch emulation the Live routes panel rests as a peek above the tab bar; select **Show live routes** to raise it before opening a route card. With a mouse or other fine pointer the panel stays centred and has no toggle.

5. Add `?qaLabel=<text>` to give QA route, both of its stops (`<text> 1` and `<text> 2`) and the signed-in user that name, for example in another script. Add `?role=admin` to sign the synthetic user in as an administrator, which adds the **Admin panel** link to Profile. `?view=admin&role=admin` mounts the real admin page with the placeholder panels of Section 2. The **QA view** list also offers `settings`, which mounts the real settings panel.

## 4. Automated layout suite

```powershell
npx playwright test --config playwright.passenger-layout.config.ts
```

The configuration starts this fixture and runs every spec in `e2e/passenger-layout/` (`warnings`, `video-audit`, `routes-schedule`, `transit-artwork`, `desktop-live-routes`, `home-sheet` and `non-latin-reflow`) in five projects, one worker at a time: touch-enabled narrow 360 x 800, mobile 390 x 844 and reported-phone 440 x 956, short-desktop 1280 x 585 and desktop 1280 x 800. The tests check, among other things, that location-delay, reconnecting and GNSS-loss warnings sit below the variable-height ride header without overlap and clear on recovery; that offline and stale buses leave the picker; that the footer, navigation, chat overlay and feedback modal keep their positions on short and landscape screens; that on landscape touch phones (844 x 390 and 568 x 320) a route card shows inside the Live Routes panel and the open route timeline header is not covered by the ride controls; that the collapsed route timeline takes pointer input only on its header; and that the passenger frame cannot scroll under the viewport. `routes-schedule.spec.ts` opens `/?schedule=demo` and checks the compact published-route rows, local search, one-sided scheduled timeline, keyboard focus, navigation at phone and desktop widths, browser history and the return to live routes.

`home-sheet.spec.ts` checks the touch-screen Live routes sheet with `many-routes`: at rest only its heading shows above the tab bar and the route list is inert; a tap on **Show live routes** or **Hide live routes**, or Enter and Space from the keyboard, raises and lowers it; and in portrait the artwork slides up while it is raised. Pointer devices get no toggle. `desktop-live-routes.spec.ts` checks that phones show the raised sheet at full width and desktops a centred, scrolling list of eight routes with a "Scroll for more routes" hint, and that keyboard focus returns to the chosen route card after Back. `transit-artwork.spec.ts` checks that the artwork fills the viewport from one WebP composition sharp enough for the device pixel ratio, keeps the same image after a tab switch, and changes between the portrait and landscape compositions on rotation. `non-latin-reflow.spec.ts` runs in the `narrow` project only, at 320 x 640 with touch. For each sample in `nonLatinText.ts` (Arabic, Hebrew, Hindi, Thai, Japanese, and German and Turkish with long words) it opens `/?qaLabel=<name>` and checks that the Live routes card, the destination list, the tracking header after switching to `empty` and the Profile name neither scroll the page sideways nor push or clip the name outside the viewport ([EKI-ADR-005](../../docs/design/LOCALE_SCOPE_DECISION.md)). Specs that open or measure a route card first raise the sheet through the shared helper `liveRoutes.ts`. Screenshots and traces go to `artifacts/passenger-layout/`, which CI keeps for seven days.

## 5. Limits

Boarding and chat are placeholders here; their real components have separate tests, including `npm run qa:browser`. The fixture does not measure real GPS, Google Maps paint or network-to-map latency, and does not replace emulator or hardware acceptance.
