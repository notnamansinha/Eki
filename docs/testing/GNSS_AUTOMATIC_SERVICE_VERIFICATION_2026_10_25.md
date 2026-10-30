# GNSS automatic service verification: 2026-10-25

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-013 | 1.0 | Historical | 2026-10-25 |

## Source and scope

Branch: `codex/gnss-auto-service`, based on `main` at `5e089cc773bcc7287def26e73ab28cfddd763ebf` (merged PR #364). Initial verification ran against the changed application tree before committing; its raw reports correctly record the base SHA and `dirty: true`. Follow-up review verification records initial implementation commit `6416e3f657bf124c9d1364bad0bffddf1bb2422d` and its uncommitted review fixes. The first commit also passed all GitHub CI checks before the follow-up changes. This report does not upgrade those observations into clean-commit or deployed acceptance. The original laptop checkout was preserved without tracked changes.

Windows, Node 24.19.0, Java 21 and Chromium/Playwright were used. Firebase Tools 15.14.0 targeted disposable `demo-eki-qa` Auth/Firestore/RTDB emulators on loopback. Native tests used PlatformIO 6.2.0. Provider browser replays used real Google Maps tiles/SDK with simulated buses and cached public route geometry. Credentials, raw physical coordinates, videos and location histories are excluded from the change.

## Resulting behavior

- A qualified authenticated receiver establishes one canonical operator/bus/route service without an admin page or manual start request. Bounded background admission preserves the telemetry acknowledgement path; durable idempotency and ownership checks prevent duplicates.
- An interrupted projection is repaired using the existing session. A stationary midpoint remains direction-pending without invented stop passage. Disabled, ambiguous, poor-quality and paused assignments do not start a ride.
- Deliberate stop records a persistent automatic-start pause. Explicit authorized resume creates a distinct pre-departure session. A retry of an old stop cannot pause its replacement. Failed consumed returns and terminal automatic intents require explicit recovery; ordinary turnaround dwell remains intact.
- Connection notices reserve space above passenger controls. Route overview and recenter are separate, map fitting accounts for the bottom sheet, ordinary stop labels appear on selection, and the bus glyph remains upright with a separate heading cue.
- Frontend default expiry is five minutes in development and production, matching the backend default. The 90-second threshold indicates delayed signal; it is not the default expiry. Environment overrides remain supported.

## Observed verification

All commands below finished successfully in the final run. Counts are executed assertions/test cases, not unique product requirements or complete control coverage.

| Check | Observed result | Private local evidence under `artifacts/qa/auto-service/` |
|---|---|---|
| Root `npm test` | 159 script + 1,267 backend + 787 frontend tests passed | `review-full-tests-verified.log` |
| Script suite after QA mapping changes | 159 passed | `review-full-tests-verified.log` |
| Passenger map follow-up suite | 39 passed, including manual drag with/without a bus | `review-overview-green.log` |
| Firebase integration/rules | 73 passed on actual emulators | `review-integration.log` |
| Authenticated emulator browser journeys | 42 passed, zero skipped/flaky/retries | `review-browser-verified.log` |
| Protected HTTP authorization | 8 passed on actual Auth/Firestore/RTDB emulators | `review-api-verified.log` |
| Passenger warning/header layout | 9 passed at 360/390/1280 widths | `review-layout-green.log` |
| Passenger ETA/stop progression | 8 passed, forward/reverse and silence recovery | `review-progress-green.log` |
| Admin access/reverification | 32 passed | `browser-admin-verified.log` |
| Marker uncertainty/revision replay | 2 passed | `browser-routing-final.log` |
| Neighboring audit regressions | 27 passed, including isolated CPU throttling | `browser-production-audit-final.log` |
| Actual Google Maps SDK replay | 2 passed, desktop and 360px phone | `review-live-maps-green.log` |
| Native firmware policies | 85 passed; no board flashing | `native-verified.log` |
| Bounded work-admission benchmark | Passed synthetic stalled-dependency checks | `admission-benchmark-final.log` |
| Lint | Both workspaces passed | `review-lint.log` |
| Strict production build | Backend, Next compile/typecheck/export, SW and backend/CSP contract passed | `review-production-build.log` |
| Dependency audits | Zero vulnerabilities, runtime and all dependencies | `audit-production.log`, `audit-all.log` |
| QA catalog/configuration | Passed; catalog still explicitly reports NOT_RELEASE_READY | `review-qa-check.log` |

The root unit run intentionally skips the 73 emulator-only tests; those ran separately and passed. Browser executions total 122 across the named suites. Synthetic SDK checks and real-provider replay are separate evidence tiers.

## Test-driven regressions

Assertions were observed failing before implementation, with preserved red/green logs for:

- Manual startup dependency, route-preview camera and passenger banner overlap (`tdd-unit-red.log`, `tdd-layout-red-oracle.log`).
- Incomplete setup/configuration repair and retaining the latest midpoint fix (`tdd-repaired-clean-red.log`, `tdd-midpoint-recovery-green.log`).
- Terminal automatic intent/consumed return recovery (`tdd-terminal-intent-red.log`, `tdd-terminal-intent-green.log`).
- Paused service presentation and explicit resume (`tdd-paused-presentation-red.log`, `tdd-terminal-ui-green.log`).
- Origin passage not being fabricated on resume and replacement-session protection (`tdd-origin-and-fleet-green-final.log`, `tdd-stop-replay-red.log`, final backend suite).

Harness-only problems were corrected separately: dependency junctions violated the Next build root; the root strict contract needed its backend environment variable; preview test arrangements needed a valid directional helper literal; a creation test had to await the asynchronous durable commit; expiry tests needed the five-minute policy; visual overlap probes must account for deliberately non-interactive notices. The first full browser run exceeded its finite six-minute budget under concurrent verification load; the isolated final rerun completed 42/42. These are not recorded as application defects or silent retries.

On this Windows host, Java's AF_UNIX selector initialization failed. A process-local `jdk.net.unixdomain.tmpdir` fallback allowed the emulator runtime to use TCP; no production Java configuration or repository emulator guard was weakened. The native runner needed its already-installed pinned PlatformIO directory on the process PATH.

## Review follow-up

Three automated review findings were verified against source and reproduced with failing assertions before fixes. Two scheduler tests exposed synchronous capacity exceptions on initial admission and retained-fix rescheduling; both now report failure and apply bounded retry delay without escaping the background scheduler. Two map tests exposed cached framing after manual drag, with and without an available bus; manual interaction now invalidates the cached fit. The reconnect fixture exposed its incorrect initial connection generation and now explicitly asserts the reconnect label.

Red evidence: `review-capacity-red.log`, `review-overview-red.log`, `review-reconnect-red.log`. Green evidence: `review-capacity-green.log` (2), `review-overview-green.log` (39), `review-layout-green.log` (9), `review-progress-green.log` (8), and `review-live-maps-green.log` (2). The real SDK phone replay now performs an actual pointer drag, verifies that the camera changes, and verifies that overview restores route framing.

The follow-up full root test rerun passed all 2,213 script/backend/frontend tests. All 73 emulator integration tests and 42 authenticated browser executions passed again. Build/lint and mapped QA checks were rerun. One preliminary unit run overlapped the production build's temporary CSP rewrite and failed the exact-header check; the generated configuration was restored and the complete root command then passed without overlapping builds. This environmental collision is retained in `review-full-tests.log` and is not an application regression.

## Coverage and remaining gates

The current JSX census found four Next pages and 173 source candidates. The local focused ledger at `artifacts/qa/interaction-audit/2026-10-25-gnss-auto-service-review/` reconciles every source candidate and records five selected action-level browser witnesses. The broader source expansion remains NOT_RUN. Its strict gate returns incomplete (exit 1), with zero schema/evidence errors and zero missing source entries; there is no whole-app or 100% coverage claim. The repository QA catalog's different static control census is a separate parser/scope.

Physical moving-receiver accuracy, real 2.5 m arrivals under GNSS noise, moving ETA accuracy, real OAuth/Places edits, deployed multi-device behavior and full application-wide control combinations remain field/provider gates. The real Maps replay confirms SDK rendering and camera/control behavior with simulated movement, not physical GNSS.

A final read-only probe of the existing deployment returned HTTP 200 for the hosted passenger page, but the original laptop backend was unreachable and its saved ngrok health URL returned HTTP 404. The new branch was not executed against cloud lifecycle data or deployed. A running backend, valid public tunnel and aligned deployed configuration are prerequisites for a fresh hosted live-GNSS check.

The pre-existing fleet authorization lock was not deleted or expired. Its improved error points to the protected lock endpoint and stopped-executor recovery procedure. Verify the old executor has stopped and inspect uncertain Auth effects before guarded recovery; restarting npm alone does not authorize taking ownership.

See [automatic service operations](../operations/AUTOMATIC_GNSS_SERVICE.md) for assignment, pause/resume and recovery behavior. Generated local CSP hashes/backend origins, environment files and raw test artifacts are not committed; the deployment build regenerates its own CSP from its configured backend.
