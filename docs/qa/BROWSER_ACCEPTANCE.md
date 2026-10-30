# Disposable Browser Acceptance

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-004 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

`npm run qa:browser` is the L3 suite of the [QA programme](README.md). It runs the real passenger workspace (with its boarding, profile, chat and feedback children), the real admin page with all six panels, the real `AuthProvider` and Firebase SDKs, and the compiled backend with its middleware and workers. Data lives in disposable Auth, Firestore and RTDB emulators. Tests check the rendered UI and HTTP outcomes, then read the persisted records independently through a fixture control listener. No application route is replaced with a success stub.

## 2. Prerequisites

- A clean disposable checkout. The backend fixture (`e2e/emulator/backend.mjs`) refuses to start when `.env`, `backend/.env` or `e2e/emulator/.env` exists.
- Node 24, Java 21 and locked dependencies.
- Chromium: `npx playwright install --with-deps chromium`.
- Free ports: frontend 3115, backend 3116, fixture control 3117, Firestore 8085, RTDB 9005, Auth 9095, hub 4405, logging 4505. Do not run another emulator suite at the same time.

## 3. Procedure

1. Install dependencies and check the configuration:

   ```powershell
   npm ci
   npm run qa:check
   ```

2. Run the suite:

   ```powershell
   npm run qa:browser
   ```

   The script builds the backend, then `scripts/run-rules-emulator.mjs --browser` starts the emulators for project `demo-eki-qa` and runs `scripts/qa/run-browser-tests.mjs`, which runs Playwright with `playwright.emulator.config.ts`.

3. Read the verdict in `artifacts/qa/browser-report.md`.

For a narrow reproduction, `npm run qa:browser:providers` runs only the tests whose titles match `provider quota`, and `npm run qa:browser:service` only those matching `admin live service controls`. Their reports record scope `providers` or `service`. A narrow run cannot satisfy the full L3 scope in the [execution ledger](EXECUTION_EVIDENCE.md).

## 4. What the suite exercises

Every test runs once in each project: mobile (390 x 844) and desktop (1280 x 800), with one worker and no retries. The browser grants geolocation at a fixed synthetic position.

| Area | Checks |
|---|---|
| Passenger boarding | Boarding through the real API with one durable membership restored on reload; boarding without a code; a distant position rejected without a manifest change or optimistic success |
| Chat and feedback | A lost chat acknowledgement reconciles into one durable message; feedback persists and the cooldown holds after the modal reopens |
| Account | Profile sign-out cancellation and confirmation; accepted account deletion preserves ride feedback and messages; a failed deletion shows its error and allows a retry |
| Admin | Settings persist and a passenger cannot open the panel; all six panels mount by pointer and roving keyboard; vehicle create, edit, cancel and delete; operator create, edit and delete with real Auth claim changes |
| Routes and providers | Route creation recovers from provider quota and a lost acknowledgement, then reuses stored geometry and deletes safely; Places quota and the real abort deadline show recoverable errors; route identity stays immutable; stop rename Escape discards the draft |
| Live service | Authenticated device telemetry admits a qualified receiver without a manual start request; stop arrival appears in the passenger timeline only inside the 15 m arrival corridor; an off-route fix publishes a versioned detour without skipping a stop; telemetry completes the joined ride and arms a separate return ride; bounded delay, interruption and a distinct restart |

The fixture sets `AUTOMATIC_TURNAROUND_DWELL_MS=0` so that the return ride arms without waiting. Device fixes use accelerated timestamps that satisfy the travel envelope. They exercise lifecycle rules, not driving latency or a wall-clock soak.

## 5. Isolation

- The backend fixture runs the safety preflight in emulator mode, initialises the Admin SDK against the emulators, creates synthetic password accounts with role claims, and listens on literal loopback. Metadata discovery is off and the Node network guard is preloaded.
- The browser context allows HTTP only to ports 3115, 3116, 8085, 9005 and 9095 on `127.0.0.1`, and WebSockets only to 3115 and 9005. Every other request is aborted and counted; each test requires zero denied requests.
- `e2e/emulator/providers.mjs` intercepts only the Routes `computeRoutes` and Places `searchText` URLs and answers them in memory with synthetic responses. Any other outbound fetch throws. The fixture installs a constant synthetic Maps key so the configured-provider code paths run; it is not a usable credential.
- Maps rendering and Next.js dynamic loading use fixture adapters.
- Playwright tracing is off so that Auth tokens and storage state never enter an artifact. All identities and coordinates are synthetic.
- Tests share one disposable database and run serially. Each test resets only its own demo records through `POST http://127.0.0.1:3117/reset`.

These are scoped transport guards, not an operating-system sandbox.

## 6. Evidence

The run writes these files under the ignored `artifacts/qa/` directory: `browser-playwright.json`, `browser-junit.xml`, `browser-report.json`, `browser-report.md`, `browser-run.log`, `browser-progress.json` and failure screenshots in `browser-results/`. Reports record the source commit, the dirty flag, the observed results, the running emulator targets and the browser version. Each test also attaches a census of visible controls; the census is an inventory, not evidence that each control was exercised.

The progress reporter records each finished test, so a killed run keeps its partial observations. The verdict stays BLOCKED without a final report. Empty, skipped, flaky, timed-out or incomplete results also leave it BLOCKED. The ledger requires the exact test file and title and one first-attempt pass in each viewport.

Deadlines: the Playwright child stops after 6 minutes and the emulator launcher after 8 minutes. The nightly campaign allows 480 s. CI uploads the evidence with seven-day retention, including failed runs.

Passing tests give `PARTIAL` status to the limited case links in `qa/browser-test-map.mjs`. They never complete a case.

## 7. Limits

The suite does not verify Google roads or map paint performance, production static-export deep links, OAuth redirects, real provider configuration, PWA failure modes, or browsers other than Chromium. Cross-store Firebase and Auth updates are not atomic, and multi-replica race recovery is not covered. Physical and live-motion requirements are tracked in [issue #351](https://github.com/notnamansinha/Eki/issues/351).
