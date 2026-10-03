# Normal versus failure testing — 3 October 2026

Scope: compare normal operation (A) against injected failure scenarios (B), using synthetic coordinates. This is functional fault testing, not a randomized conversion experiment. No application logic changed and no simulated coordinates were written to live Firebase or sent to real devices. Pre-existing instrumentation changes were left untouched.

Tested workspace: `feat/grafana-opentelemetry-observability` at `14d289513bbd1a8588163f04214aa6510aca5b93`, including its then-uncommitted instrumentation changes. These results describe that workspace, not a fresh test run against the latest `main`. This documentation-only PR publishes the report; the new audit test files remain local and are not included in this PR.

## Results

| Run | Result |
| --- | --- |
| Script tests | 33 passed |
| UI source contracts | Passed |
| Original backend suite | 451 passed, 23 failed, 7 skipped; 55 files |
| Original frontend suite | 219 passed; 35 files |
| New movement audit | 23 passed, 4 failed; 27 cases |
| Backend outage reproduction | 1 passed, confirming the freeze behavior |
| Browser smoke check | Sign-in rendered; 360px layout did not overflow; signed-out `/admin` returned to sign-in; no captured warning/error logs |

The root `npm test` stops after backend failures, so the frontend suite was run separately. The audit suites live outside `src` and do not add intentional failures to the normal `npm test` selection. Their four failed assertions reproduce three distinct issues below.

## Findings, ordered by practical impact

### 1. Plausible movement after a short outage freezes the accepted bus position

Observed: at `(23, 72)`, 30 km/h, a new fix at `(23, 72.009)` after 120 seconds is rejected despite travelling about 921m, below the roughly 1000m reachable at that speed. The guard caps elapsed travel allowance at 60 seconds. Subsequent continuing movement at 180, 240 and 300 seconds remains rejected against the retained original plausibility anchor. At 301 seconds the marker reacquires and jumps to the current position.

Verified through both `isPlausibleTelemetryTransition` and the real `nextTelemetryValue` function. Rejected updates preserve original accepted coordinates, set motion to `uncertain`, and keep fresh raw fixes separately. This can present a stationary, uncertain bus during a legitimate network interruption. It is a consequence of the deliberate bounded jump policy, but a functional failure for realistic outage recovery. No actual HTTP outage or rendered authenticated marker was exercised.

Sources: `backend/src/lib/telemetryMotion.ts`, `backend/src/services/deviceTelemetryService.ts`. Reproduction: `backend/audit/outageSimulation.test.ts` and the two-minute case in the frontend audit.

Suggested resolution: design a bounded reacquisition policy using outage duration and corroborating consecutive fixes, while retaining teleport protection. Test it before relaxing the guard.

### 2. Passenger normalization accepts out-of-range numeric speeds

Observed: a fresh active RTDB-shaped ride with speed `-1` or `201` survives `normalizePassengerLiveBus` and preserves that value. The device parser rejects these values, but the frontend boundary does not apply the same range validation. NaN and Infinity were rejected in the same test.

Impact: malformed or legacy RTDB data can expose physically invalid speed to passenger consumers. This audit does not establish an unauthorized database write path or a specific rendered ETA failure.

Sources: `frontend/src/lib/passengerLiveBus.ts`, `frontend/src/lib/activeBusEntries.ts`. Suggested resolution: enforce finite speed in `[0, 200]` at normalization; establish a reject-versus-default policy.

### 3. Explicit null accuracy overrides the HDOP error budget

Observed: `adaptiveGnssErrorMeters(4, 30, 30, 0)` returns 43m, but passing a fifth argument of `null` returns 15m. `Number(null)` becomes zero and overrides valid HDOP.

Impact: callers explicitly supplying missing accuracy could use an excessively strict error allowance. Current production call sites examined omit the fifth argument, so this is a latent helper defect, not a confirmed live failure.

Source: `backend/src/lib/telemetryMotion.ts`. Suggested resolution: only use accuracy when it is a finite non-negative number; let null use HDOP.

### 4. Repository verification fails on 23 missing documentation mirrors

`backend/src/docsMirror.test.ts` encounters ENOENT for three `docs/.claude/skills/integration-javascript_node/references/` files and twenty `docs/audit-main-issues/` files. These are repository failures rather than bus runtime failures. They stop the root test command before frontend tests run. Review `npm run docs:sync` output before applying synchronization because it may create many files.

## Edge cases exercised

| Area | Cases and result |
| --- | --- |
| Continuous movement | 600 forward and 600 reverse fixes, one per simulated second: parsing, plausible motion, route matching, marker selection and passenger visibility passed |
| Coordinate validation | Latitude 91, longitude -181, NaN, Infinity and string latitude rejected; exact poles, longitude endpoints and `(0,0)` accepted by parser |
| Telemetry contract | Negative and excessive speed, heading 360, HDOP 100, sequence zero, additional fields, >60s-old and >10s-future samples rejected |
| GPS teleport | Kilometre-scale jump between fresh samples rejected |
| Stopped service | Existing tests passed 3600 updates each for pre-departure and in-service stationary rides |
| Signal expiry | Active ride intentionally stays visible with signal lost; completion removes it. Retention was checked against the existing lifecycle contract and is not reported as a defect |
| Delayed map matching | Existing tests passed bounded hold, timeout fallback, newer raw samples without deadline extension, and late/older snapshot rejection |
| Route changes | Existing tests passed direction-pending handling, reverse direction, route-version and session changes, off-route/rerouting fallback and reconnect behavior |
| Rerouting races | Existing integration tests passed newer GPS during a pending route computation, geometry publication ordering, obsolete outbound reroute rejection and endpoint direction reinference |
| Stop progression | Existing tests passed origin departure, crossed intermediate stops, downstream stop protection, terminal completion, uncertain GNSS and 100 stops in both travel orders |
| Transport/security | Existing mocked route tests passed bad device credentials, duplicate response contract, Retry-After and two buses behind shared NAT |
| Browser | Public sign-in, mobile width and unauthenticated admin redirect checked |

The first movement simulation connects pure parsing, plausibility, route matching and frontend selection functions. It is not the full ingestion/trip-state/Firebase/browser pipeline. Existing suites exercise additional stages with mocks.

## Coverage gaps

- Authenticated passenger map, boarding and admin operations: no authenticated test session supplied.
- Actual bus movement rendered in a browser, passenger geolocation permission denial/timeout, and walking ETA: not exercised through browser coordinates. Browser geolocation moves the passenger, not the ESP32-owned bus.
- Real Firebase rules: seven emulator integration tests skipped in the baseline run. No isolated emulator environment was started.
- Existing Playwright admin suite: not run; local `@playwright/test` is absent, and its tests require `EKI_E2E_STORAGE_STATE`.
- Real Google Maps quota/errors, Firebase reconnect/permissions, device HTTP ingestion and network packet delay/loss: simulated or mocked in existing tests, not tested against live services.
- Multiple-tab PWA updates, prolonged browser suspension, real mobile GPS quality and fleet load: not exercised in this audit.

These gaps prevent a claim that every edge case or the authenticated webapp has been tested end to end. Next.js also reported selecting a parent directory as its Turbopack workspace root due to multiple lockfiles; the app still served successfully.

## Reproduce

From the repository root:

The original suite commands are available in the repository. The two `audit/` commands require the locally created simulation files, which are referenced as evidence but are not shipped in this documentation-only PR.

```powershell
npm test
npm run test --workspace=frontend
Push-Location frontend
../node_modules/.bin/vitest.cmd run audit/movementSimulation.test.ts --reporter=verbose
Pop-Location
Push-Location backend
../node_modules/.bin/vitest.cmd run audit/outageSimulation.test.ts
Pop-Location
```

The movement audit deliberately exits nonzero until the three exposed issues are addressed. The backend outage reproduction passes by asserting the observed freeze and later recovery.
