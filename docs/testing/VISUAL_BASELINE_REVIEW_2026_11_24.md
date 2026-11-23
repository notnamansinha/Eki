# Visual Baseline Review: 24 November 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-063 | 1.0 | Historical | 2026-11-24 |

## 1. Scope

This record covers the first reviewed set of visual and accessibility-tree baselines for issue #523, made with the suite described in [visual and accessibility-tree baselines](../../qa/VISUAL_BASELINES.md) (EKI-TST-015). It is browser evidence at level L3: emulated phone, tablet and desktop in Chromium, with synthetic data. It is not evidence from a real device or a screen reader; the other two items of issue #523 were not run (Section 6).

| Item | Value |
|---|---|
| Baselines and suite | Commit `b077d0355cc68d6b2e9a8622957ba10d1c0d7691` |
| Revision of the clean runs | Commit `d12646d2a3c64cba1b600ab5b2c7bbddd7548188` (adds a separate Vite cache for the surface fixture; no baseline changed) |
| Browser image | `mcr.microsoft.com/playwright@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f` (`v1.64.1-noble`), HeadlessChrome 156.0.8078.80 on Linux x86_64 |
| Test runner | `@playwright/test` 1.64.1, Node 26.13.1 |
| Host | Windows 11, Docker 29.9.2 (Linux containers) |
| States | 19 on phone and tablet, 18 on desktop: 56 screenshots and 56 accessibility trees |

## 2. Method

1. Generated the baselines with `npm run qa:visual:update`.
2. Reviewed every screenshot: one contact sheet per project, then each questionable area at full size. Read every accessibility tree.
3. Fixed what the review found in the suite itself (Section 3) and regenerated.
4. Ran the comparison repeatedly to measure stability (Section 4.1), and with deliberate source changes to confirm it fails (Section 4.2).
5. Checked two layout observations with the production font (Section 5, F1 and F2).

## 3. Suite defects found during review

| Defect | Cause | Correction before commit |
|---|---|---|
| The first passenger test captured a blank page | Vite bundled the fixture's dependencies on first load and reloaded the page | `e2e/visual/warm-up.ts` opens every surface before the tests |
| Every passenger screenshot was one flat box | A screenshot mask on the full-bleed artwork covers everything drawn above it | The artwork is hidden by a capture stylesheet instead; only the landing shows it |
| Admin Fleet, Routes and History, and passenger tracking, showed "Loading fixture view…" | The capture ran before the lazy panel or map loaded | `capture()` waits for the placeholder to disappear and for network idle |
| Admin Feedback stayed on "Loading feedback…" | The panel compares `auth.currentUser.uid` with the signed-in administrator; the stub had no `uid` | `e2e/visual/fixture/firebase-auth.ts` gives the stub the fixture identity |
| The comparison stopped at the screenshot and never compared the accessibility tree | The screenshot assertion was not soft | The screenshot assertion is soft, so one run reports both |
| `-g "not found"` selected no tests on Windows | The runner started `npx` through a shell, which split the argument | The runner starts Playwright's CLI with `node`, without a shell |

## 4. Results

### 4.1 Stability

| Run | Tree | Result |
|---|---|---|
| Two full comparisons | Working checkout, before the tolerance | 1 and 3 failures, all in `passenger-tracking` or `passenger-tracking-gnss-lost` on tablet or desktop |
| Tracking states, 4 repeats per project | Working checkout | 5 of 24 failed; 133 differing pixels, in the "Route timeline" label on the translucent sheet |
| Same, with the sheet's backdrop blur turned off during capture | Working checkout | 3 of 24 failed (139 and 543 pixels; the second at the location prompt's edges). The blur change was reverted |
| Three full comparisons with 600 tolerated pixels on the two tracking states only | Working checkout | 53 passed, 1 skipped, 0 failed, three times |
| Full comparison with an empty Vite cache | Working checkout | 53 passed, 1 skipped |
| Two full comparisons, 2026-11-23 20:37 and 20:39 UTC | Clean worktree at `d12646d2a3c64cba1b600ab5b2c7bbddd7548188` after a fresh `npm ci` (empty Vite caches), `dirty: false` in `artifacts/visual/run.json` | 53 passed, 1 skipped, 0 failed, both times; exit code 0 |

The skipped test is `passenger-live-routes` on desktop, which has no touch sheet.

### 4.2 The comparison fails on a change

| Change to `frontend/src/app/not-found.tsx` (reverted after each run) | Result |
|---|---|
| Link text "Go to Eki home" to "Go to the Eki home" | Fails at the test's own readiness check, before capture |
| Body text "The link may be old or mistyped" to "The link may be outdated or mistyped" | Fails twice in one run: 1,231 differing pixels in the screenshot, and the changed paragraph in the accessibility tree |

## 5. Observations from the baselines

These come from emulated renders and synthetic data. Each is listed in Section 7 of the [device and screen-reader acceptance procedure](../../qa/DEVICE_AND_SCREEN_READER_ACCEPTANCE.md#7-known-items-to-confirm) for confirmation; none was changed in the product by this work.

| ID | State | Observation |
|---|---|---|
| F1 | `admin-feedback`, phone (412 CSS px) | The "Unreviewed" summary label is wider than its card: it runs into the card's right padding and its icon is squeezed to nothing. Repeated with Roboto (the Latin subset from a local static export, injected for this check only): same result. |
| F2 | `admin-live-ops`, desktop (1280 CSS px) | The five summary labels ("In service" to "Offline / unknown") fill their cells with no side padding. Repeated with Roboto: same result. |
| F3 | `admin-fleet`, all projects | Four accessible names do not contain the visible label: "Add new vehicle" (visible "Add Vehicle"), "Add new operator" ("Add Operator"), "Collapse saved vehicles" ("Saved Vehicles 1"), "Collapse saved operators" ("Saved Operators 1 1 Live"). WCAG 2.2 success criterion 2.5.3 (Label in Name) requires the visible text in the name. |
| F4 | `passenger-tracking-gnss-lost` | "GPS signal lost" is in two status regions, the header notice and the map notice, so a screen reader may announce it twice. |
| F5 | `admin-feedback` | Each feedback entry is a button whose accessible name is the whole card: user, status, rating, type, date, bus, operator and comment. |
| F6 | `passenger-home`, `passenger-live-routes` | Each route card is a button that contains a level 3 heading. Some screen readers do not expose headings inside buttons to heading navigation. |
| F7 | `landing` | The description is two sentences without a full stop between them (by design), so a screen reader may read them without a pause. |
| F8 | `admin-settings` | The baseline shows "1 previously published route was deleted and will be removed when you save". This is fixture data: the synthetic passenger route configuration names the Campus Loop route, which exists only with `?schedule=demo`. It is not a product defect. |

## 6. Issue #523 status after this record

| Item of "Done when" | Status |
|---|---|
| A reviewed visual baseline set recorded against a named revision | Done: this record, revision `d12646d2`, baselines from `b077d035` |
| A real-device matrix with at least one iPhone and one Android phone | Not run: no device on this host. Procedure: [EKI-TST-016](../../qa/DEVICE_AND_SCREEN_READER_ACCEPTANCE.md#4-real-device-matrix) |
| Two screen-reader sessions | Not run: no screen reader installed on this host. Procedure: [EKI-TST-016](../../qa/DEVICE_AND_SCREEN_READER_ACCEPTANCE.md#5-screen-reader-sessions) |
| Installed-PWA launch and offline cold start | Not run; DEV-10 of the same procedure, with issue #430 |
