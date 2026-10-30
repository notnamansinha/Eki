# Security issues #315-#317: testing-branch acceptance

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-052 | 1.0 | Historical | 2026-10-16 |

Baseline: `f1850b9be2f5fdd9dcc4a751fe305094b86b8fda` on `testing`.

## Confirmed follow-up defect and fix

Database rules denied a demoted admin's saved token, but HTTP admin middleware
only checked its signed `admin` claim. Firebase Admin compares `auth_time` with
`tokensValidAfterTime` at second resolution using a strict less-than comparison.
A token at the same-second cutoff can therefore remain provider-valid after
demotion and retain HTTP admin access.

The emulator regression deliberately sets the owned synthetic Auth account's
cutoff equal to the saved token's authentication time, verifies that the real
Firebase verifier accepts it, then requires the production HTTP handler to deny
it. That HTTP assertion failed before the fix; the database denials already
passed. This is a controlled reproduction of the provider boundary, not a claim
that a particular staging revocation happened within one second.

`requireAdmin` now requires `admin === true`, `role === "admin"`, a versioned
token and matching current authorization in **both** backend-owned database
records. It reuses the existing publication invariant without a positive cache.
A store read failure denies execution with a retryable 503; stale/incomplete
privilege receives 403. This adds two metadata reads to admin authorization.
The claims backfill must be complete before directing admin traffic to this
backend; unversioned legacy admin tokens are intentionally denied, matching the
existing database policy.

## Repeated service-restart CI failure

The PR-event run passed on `a4a28fb`, but its separate push-event run
`38813381130` failed the desktop service restart with Firestore gRPC code 3 and
the exact detail `Transaction is invalid or closed.` This is the same error
captured in the earlier testing-branch investigation; the new retained log
confirms the intermittent failure remains relevant. The SDK retries an expired
transaction response, but its retry classifier does not include this closed-ID
detail.

Ride creation and its projection/cleanup callbacks now restart one fresh
transaction for that exact code/detail pair. They preserve proposed session IDs
and idempotency keys and rerun the transaction's ownership/lifecycle checks. Other invalid
arguments and a second closed response still fail normally. Regression tests
inject rollback before commit at both lock and projection phases, check one
durable session and stable acknowledgements, bound attempts and verify that a
firmware lock acquired between attempts prevents a ride. No browser retries or
authentication/firmware safety conditions are relaxed.

The ten-run stress investigation also exposed a separate delay-control oracle
failure: RTDB already held the requested delay while the UI correctly kept the
request pending, but the five-second toast assertion expired before the HTTP
acknowledgement. The test now observes the actual PATCH response (using the same
15-second observation window as service creation), requires HTTP 200 and the
correct `saved`/delay fields, then applies the original UI and persistence
assertions. It does not accept a failed or timed-out application request.

Fresh backend stress batches then reproduced a cold RTDB cache defect: delay
transactions returned 409 before evaluating an existing server-side ride. The
callback returned `undefined` for the SDK's initial uncached `null`, which aborts
locally. It now returns `null` in that case so compare-and-set can obtain the
server value and rerun the existing session/ownership guards. An absent or
replacement ride still cannot produce a successful delay acknowledgement.
This initial-null behavior is documented by
[Firebase](https://firebase.google.com/docs/database/web/read-and-write#save_data_as_transactions).
Unit regressions cover a cold valid ride and rejection of a replacement during
refresh. The stress harness uses fresh disposable emulators and backend
processes for each viewport batch. Reusing only selected fixture documents
across fresh processes left conflicting durable synthetic lifecycle state; a
diagnostic correctly reported an active `qa_session` after interruption with no
owning lock, and the production guard refused the restart. No guard is bypassed
to make that inconsistent fixture pass. An earlier combined batch also correctly
hit the unchanged 30-write/minute quota and failed with 429.

Final isolated recovery stress: five mobile and five desktop journeys passed,
with zero failures/skips/flaky retries. Real closed-transaction responses were
observed and recovered during these runs. The complete backend unit suite passed
1,144 tests, including all 25 session-lifecycle tests. Earlier diagnostic failures
remain retained separately; they are not relabeled as passing evidence.

The owner explicitly selected the merged App Check removal policy on 2026-10-16:
preserve the removal, verify authentication and authorization, and document #316
as superseded. This review does not restore browser/API App Check or change any
live Firebase product enforcement setting. Deployment prerequisites remain in
`docs/operations/BROWSER_API_SECURITY.md`.

## Scope and permanent regressions

`npm run qa:api` exercises the actual production server with disposable demo
Auth, Firestore and RTDB, committed rules, real device-secret hashing, real
transactions and synthetic provider responses. The launcher rejects inherited
cloud/provider configuration and preloads the loopback transport guard. Fixture
accounts, credentials, messages and vehicles are synthetic. Saved ID tokens stay
in memory and are excluded from published evidence.

The suite retains its original 179 denied-operation observations and adds four
workflow tests:

| Issue | Executed software oracle | Separate acceptance |
| --- | --- | --- |
| #315 | A saved real driver token initially reads its session/message, then loses access after HTTP unassignment, restoration with a new version, UID replacement and deletion. The real claims-sync implementation demotes/restores an admin through Auth and both databases; the saved admin token stays denied in both databases and at HTTP admission, including the provider cutoff boundary. | A redacted staged old-token/offboarding check against the deployed Auth/Firestore/RTDB configuration is still required by the original issue. |
| #316 | Missing/forged identity and a real passenger token fail lowercase/mixed-case GET/HEAD Places requests without provider work; a real current admin succeeds without attestation. HEAD bodies are empty and successful variants share the real handler/cache. Existing admission tests cover identity quotas and mutation authorization. | Original App Check enforcement criteria are superseded by the owner's chosen removal policy. Source removal does not prove live product settings. |
| #317 | Real Device-only requests exercise ride-lock rejection, concurrent acquisition, owner-only release, malformed/invalid/rotated/disabled/unassigned credentials, browser-token rejection, re-enable recovery, idempotent release, exact ingress methods/paths and case-sensitive device IDs. | Signed installation/abort/reboot recovery on approved stopped secure hardware remains a predeployment gate in #245; no physical flash is claimed. |

Existing rules, authorization-publisher and fleet-operation suites additionally
cover missing/blocked versions, `admin` flag versus role boundaries, assignment
ownership, protected metadata writes, partial cross-database failures, failed Auth
revocation/claims publication, superseding publications, retry and mutex behavior.
Those failure injections deliberately mock Auth/dependency failures; they are
distinct from the new successful real-emulator Auth workflows.

Denied-operation snapshots now include authorization metadata in both databases,
so a rejected request cannot silently mutate that metadata without failing the
authorization sweep. The API runner retains incremental test progress as well as
JSON/JUnit results and requires all eight workflow/partition tests to pass.

## Evidence and limits

Local evidence is retained under `artifacts/qa/security-315-317/`, with standard
API, browser and emulator reports under `artifacts/qa/`. These ignored artifacts
are not credentials or live-cloud acceptance. CI uploads its own source-attributed
reports; the PR's checks identify the exact tested commit.

The confirmed HTTP authorization defect above is fixed alongside stronger
regression coverage and the accepted App Check removal policy.
Passing local/CI tests does not certify cloud IAM/WAF, real provider billing,
deployed enforcement settings, physical hardware or complete release readiness.
Issue #315 must retain its staging gate until that evidence exists; #317 must
retain or explicitly transfer its physical acceptance gate before being described
as fully accepted.
