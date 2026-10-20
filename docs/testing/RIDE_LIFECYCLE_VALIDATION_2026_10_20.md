# Ride lifecycle and telemetry claim validation — 20 October 2026

Last updated: 2026-10-20 22:46 IST (UTC+05:30).

This extends PR #344 and the [production audit validation](PRODUCTION_AUDIT_VALIDATION_2026_10_20.md).
Claims supplied by the owner were checked against `testing` base
`c66fb6aa5a90059e31d10bbbd096efd81cada35c` and the PR's current code. Recommendations
were treated as proposals to evaluate, not instructions to assume a defect or
change safety policy.

| Claim | Finding and disposition |
|---|---|
| Manual stop should make the bus disappear | False as a requirement. `/api/shifts/stop` transactionally records `interrupted` with `manual_end_early`, deletes the matching active ride and bus lock, then retires the matching RTDB lifecycle. Device coordinates and device presence are deliberately retained. A still-online marker is not an active ride. No lifecycle policy change. |
| Manual end is displayed as an early ending, not automatic completion | Confirmed and intentional. The admin already acknowledges the early ending immediately. PR #344 also exposes the persisted reason in History. Do not relabel an interrupted trip Completed. |
| Automatic completion requires ordered stops and reliable final arrival | Confirmed. Raw accepted fixes must reach the expected final stop within 10 m, with departure evidence, stopped motion, HDOP at most 4 and speed at most 2.5 km/h. Increasing sample timestamps must establish the default 2,000 ms confirmation interval. `TERMINAL_ARRIVAL_CONFIRMATION_MS` is configurable; earlier confirmation evidence expires after a 60-second sample gap. This is not proof of continuously observed physical dwell. No threshold changed. |
| The field capture proves a broken completion algorithm | Not established. The report records `in_service` at owner end, but does not establish every required final-stop condition. Neither an owner message nor reaching a basement calls the manual-stop API. No new attribution to GNSS, network or operator error. |
| Passenger telemetry becomes delayed after 90 seconds | Confirmed for default production settings: bus presence expiry is 300 seconds, while the delay threshold is capped at 90 seconds. Default development expiry is 90 seconds and delay threshold 45 seconds. Environment overrides can shorten it. Both panels use the shared accepted server-receipt/sample-time fallback in `liveBusFreshness.ts`. |
| Admin and passenger can present inconsistent freshness | Confirmed display defect. The admin drawer could say Connected during a gap the passenger called delayed, while its card still showed prior motion. The admin card and drawer now use the same delay test and explicitly warn while retaining last-known location. Its age display uses the same freshness timestamp. Device inventory presence and ride lifecycle remain separate dimensions. |
| Uncertain motion establishes GPS failure | False. The admin's old No GPS label inferred a cause not established by `motionState=uncertain`. It now says Motion uncertain. |
| Passenger subscription/catalog/projection failures can differ from delayed telemetry | Confirmed. Subscription errors have a live-data alert with error details, connection resume has its own UI, and projection/catalog readiness gates subscriptions. These are not evidence that a GNSS receiver failed. No invented receiver/permission/backend status is published from missing information. |
| PRs #341/#343 already addressed passenger wording/layout | Confirmed on the inspected base. Current passenger source says Live location updates delayed and retains the warning visibility fixes. The actual served build was not attested; old deployed wording cannot be fixed by claiming this local revision is deployed. |

The proposed final-arrival diagnostic UI would be an additional feature. The
claims do not establish a faulty completion transition requiring it; no new
diagnostic fields, Firestore schema or public telemetry payload were introduced.
The existing reducer, authenticated ingestion and lifecycle tests remain the
authority for software transitions; physical arrival and deployed provider
recovery still need observed evidence.

## Regression evidence

Two added admin component regressions failed before the product patch and pass
afterwards: delayed-versus-connected presentation and unjustified No GPS wording.
The browser fixture now renders the actual admin dashboard as well as the actual
passenger components. Its explicit 300-second expiry matches production defaults.
It injects 90.001-, 120- and 200-second-old snapshots, verifies delayed labels in
both panels, then verifies fresh-delivery recovery without refresh at 360×800,
390×844 and 1280×800. A separate denied-subscription scenario must show the
live-data error instead of a telemetry-delay claim and recover on a new delivery.
These synthetic callbacks do not simulate a physical receiver or prove live
Firebase permission propagation.

The disposable Firebase-emulator journey extends the actual admin End ride
interaction with authenticated moving telemetry. It checks the interrupted
session and reason, absent active ride and lock, retained online device and
sessionless passenger projection before starting a distinct new service. It
therefore checks both durable lifecycle authority and public publication, rather
than accepting a disappearing button as proof of stop. Existing natural-completion
journeys and new reducer cases retain ordered progression, reliable GNSS,
confirmation and stale/future-timestamp constraints.

Expanded local results:

- `npm run verify` passed: lint, 146 script tests, 1,239 backend tests and 702
  frontend tests, contracts, TypeScript/static builds, SW/CSP generation and zero
  runtime dependency vulnerabilities. The normal unit command explicitly skipped
  58 emulator-only tests. Its unconfigured local build skipped the backend-origin
  contract; CI runs the configured production build and emulator rules separately.
- The focused browser suite passed all 27 checks at the three sizes, with no
  retries/skips. The admin access/resume browser suite passed all 24 checks.
- `npm run qa:browser:service` passed both extended mobile/desktop stop-and-restart
  journeys, with no retries, skips or flaky results. This includes the authenticated
  moving fix, interrupted Firestore record, absent active ride/lock, retained
  online device and sessionless public RTDB projection.
- The full local emulator attempt reached its unchanged five-minute runner cap
  after 34 passing observations and no assertion failures. This is partial
  evidence, not a green 40-test run. Both the partial report and the succeeding
  bounded two-case report were retained separately. CI still runs all 40 cases;
  its result must be checked on the pushed revision.
- Before the successful full verification, one run timed out waiting for an
  existing lazy-loaded recovery-test component. It passed unchanged on the
  isolated rerun. An additional run caught a duplicate test-map entry introduced
  during this expansion; that entry was consolidated before the clean pass.
  The initial denied-subscription browser assertion expected the inner map's
  wording; it was corrected to assert the workspace's actual owning alert.

No failed or interrupted attempt is counted as a completed passing suite. The
broader source-state ledger has 27 focused browser passes, 175 NOT_RUN candidates
and two original-evidence blockers, with zero malformed or unreconciled entries.
No live ride, production account, provider billing, deployment or physical tracker
was changed. These results establish the executed software scope, not production
or physical acceptance.
