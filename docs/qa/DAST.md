# Bounded DAST and OpenAPI Scans

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-014 | 1.1 | Current | 2026-11-24 |

## 1. Purpose

`npm run qa:dast` and `npm run qa:dast:staging` run OWASP ZAP active scans of the backend HTTP API. ZAP imports [`backend/openapi.json`](../../backend/openapi.json) with its OpenAPI add-on [2], sends every operation in scope once, then attacks the path, query and JSON body values of those requests. Each role (anonymous, passenger, administrator and, locally, device) runs as a separate ZAP process with its own credential.

| Profile | Command | Target |
|---|---|---|
| Local | `npm run qa:dast` | The compiled backend on `127.0.0.1:3116` against disposable Auth, Firestore and RTDB emulators (project `demo-eki-qa`) |
| Staging | `npm run qa:dast:staging` | The Cloud Run service `eki-backend-staging` at `https://eki-backend-staging-449313371438.asia-south2.run.app` ([staging runtime configuration](../operations/STAGING_RUNTIME_CONFIG.md)), with two dedicated test accounts |

The local profile scans every operation and may change any record, because the emulators are discarded afterwards. The staging profile sends only GET requests, within the bounds in Section 3, and ties its evidence to the serving Cloud Run revision. [`scripts/qa/dast-plan.mjs`](../../scripts/qa/dast-plan.mjs) holds every bound; [`scripts/qa/run-dast.mjs`](../../scripts/qa/run-dast.mjs) runs the scans.

## 2. Prerequisites

| Item | Local | Staging |
|---|---|---|
| Docker | Docker Desktop or Docker Engine, running | Same |
| ZAP image | `zaproxy/zap-stable:2.17.0`, pinned by digest in `scripts/qa/dast-plan.mjs` (about 1.2 GB compressed). Pull it once with `docker pull` and the full reference | Same |
| Node and Java | Node 24 and Java 21, as for [`npm run qa:api`](HTTP_AUTHORIZATION.md) | Node 24 |
| Checkout | Locked dependencies and no `.env`, `backend/.env` or `e2e/emulator/.env` file. The emulator fixture refuses to start otherwise | Clean: the runner refuses a dirty tree, so the evidence names the harness commit. It decides "dirty" through `scripts/qa/working-tree.mjs`, like every other QA runner, so the CSP hashes a build regenerates in `firebase.json` do not count |
| Identities | Synthetic emulator accounts `qa_passenger` and `qa_admin`, and the synthetic device `qa_device` | Two dedicated test accounts in `bustrack-be165`: one passenger, one administrator. Never a person's account |
| Approval | None | The staging owner agrees the window. No backend deploy may run during the scan |

## 3. Scope and bounds

### 3.1 Operations

| Profile | Roles | Operations |
|---|---|---|
| Local | anonymous, passenger, admin | All 68 browser operations in the contract, every method |
| Local | device | The 4 device operations, with the synthetic device secret of `qa_device` |
| Staging | anonymous, passenger, admin | The 22 GET operations, excluding device ingress and `GET /api/places/search`, which calls the billed Places API on every valid request |

Path parameters, query parameters and body properties that name a fixture record (`busId`, `routeId`, `sessionId` and others in `LOCAL_PATH_VALUES`) carry the fixture's identifiers, so payloads reach handlers with real records. On staging every identifier is the placeholder `dast-probe` unless `EKI_DAST_PATH_VALUES` names test records, for example `{"routeId":"<test-route-id>"}`. Values must match `^[A-Za-z0-9_-]{1,128}$`.

### 3.2 Active scan limits

| Setting | Local | Staging |
|---|---|---|
| Threads per host | 2 | 1 |
| Delay between requests | 0 ms | 400 ms |
| Rules | Every installed rule at strength medium, except those in `LOCAL_DISABLED_RULES` | Only the 18 rules in `STAGING_RULES`, at strength low |
| Alert threshold | Medium | Medium |
| Longest rule | 2 min | 2 min |
| Active scan cap per role | anonymous 4 min, passenger 10 min, admin 14 min, device 5 min | anonymous 3 min, passenger 12 min, admin 12 min |
| Alerts kept per rule | 10 | 10 |

On staging, one thread with a 400 ms delay sends at most 150 requests a minute per identity. The backend allows 200 reads a minute per verified user and 1,000 requests a minute per IP (requirement NFR-SEC-005), so the scan neither locks the test accounts out nor takes the budget that trackers and passengers share with it. The staging service runs at most one instance.

Every staging rule sends GET requests to URLs that the import produced. The rules that the staging profile leaves off include:

| Rule | Reason |
|---|---|
| 90028 Insecure HTTP Method | Sends PUT, DELETE and other methods to each scanned path |
| 20018 Remote Code Execution (CVE-2012-1823) | Sends POST requests |
| 40025 Proxy Disclosure | Sends TRACE and OPTIONS requests |
| Time-based SQL injection (40019 to 40022, 40027) and 90036 blind template injection | Hold requests open on the only instance |
| 40043 Log4Shell | Needs an out-of-band callback service |

A rule that a later ZAP version adds stays off on staging until it is reviewed and added to `STAGING_RULES`. Every ID in `STAGING_RULES` and `LOCAL_DISABLED_RULES` is installed in the pinned image; ZAP ignores an unknown ID with a warning. Pointed at a loopback server that counted request methods, the staging plan sent 91 requests, all GET (2026-11-23). Locally only the time-based, callback and TLS rules are off.

### 3.3 Local fixture

[`scripts/qa/dast-backend.mjs`](../../scripts/qa/dast-backend.mjs) starts the browser acceptance fixture `e2e/emulator/backend.mjs` with the loopback network guard preloaded, `WORKER_ENABLED=false` and synthetic providers. An active scan sends thousands of requests with one identity, so at production budgets the limiter would answer almost every payload with 429. The wrapper therefore raises the per-user read and mutation budgets and the per-IP ingress budget by a factor of 1,000, and the runner sets `HTTPS_DEVICE_RATE_PER_MINUTE=100000`. Before the passenger scan the runner sends 201 reads in batches of 10 and records their statuses in `admissionCheck`; the run stops unless every read returns 200. The route-compute, place-search and chat limiters keep their production values, so some payloads to those routes return 429.

Each role gets a fresh backend process and fresh fixture data. After each role the runner reads the fixture's evidence and fails the run if the backend attempted a non-loopback connection or a real provider call.

### 3.4 Credential check

An administrator operation can revoke the token it was called with, and a scan that lost its credential would finish its remaining rules against 401 responses. After each authenticated role, in both profiles, the runner repeats one request with the role's credential (`GET /api/buses` for the passenger, `GET /api/health` for the administrator, `GET /api/devices/qa_device/firmware?sequence=1` for the device, which checks the device credential only after the query is valid) and records the status as `credentialStatusAfterScan`. The run stops with `BLOCKED` on 401 or 403. Fixture identifiers never name a scanning account in an operator assignment: `authUid` examples use `qa_other`.

## 4. Procedure

### 4.1 Local scan

Run from the repository root of a clean checkout.

1. Pull the image named in `ZAP_IMAGE` in `scripts/qa/dast-plan.mjs`, for example `docker pull zaproxy/zap-stable:2.17.0@sha256:<digest>`. Expected: Docker reports the digest.
2. Run `npm ci`. Expected: dependencies install from the lock file.
3. Run `npm run qa:dast`. It builds the backend, starts the emulators with a 60 min deadline and scans the four roles in turn. Expected: `artifacts/qa/dast-local-report.md` reports `verdict: NO_UNTRIAGED_ALERTS`. The caps in Section 3.2 bound the run at about 50 min. On 2026-11-23 it took 27 min: the anonymous scan stopped at its cap and the other roles finished every rule before theirs.

### 4.2 Staging scan

Run from a clean checkout of the commit whose harness you want to use. PowerShell is shown.

1. Read the serving revision: `gcloud run services describe eki-backend-staging --region asia-south2 --format="yaml(status.traffic)"`. Expected: one revision with `percent: 100`.
2. In a private browser window, sign in to `https://bustrack-be165.web.app` as the dedicated passenger test account. In the developer tools, open Application, IndexedDB, `firebaseLocalStorageDb`, `firebaseLocalStorage`, select the `firebase:authUser:` entry and copy `value.stsTokenManager.accessToken`. Then run `$env:EKI_DAST_PASSENGER_ID_TOKEN = Get-Clipboard`. Repeat in a second private window with the administrator test account and `EKI_DAST_ADMIN_ID_TOKEN`. Expected: both variables hold a token; the token never appears in the command history or a file. An ID token lasts one hour and the runner requires at least 40 min of it.
3. Name the target and revision: `$env:EKI_DAST_CONFIRM_TARGET = "https://eki-backend-staging-449313371438.asia-south2.run.app"` and `$env:EKI_DAST_EXPECTED_REVISION = "<revision from step 1>"`.
4. Run `npm run qa:dast:staging -- --dry-run`. Expected: `verdict: DRY_RUN`, no network request, and `artifacts/qa/dast-staging/<role>/openapi.json` and `plan.yaml` for each role. Review them: they list every request the import sends and every rule the scan runs.
5. Run `npm run qa:dast:staging`. The runner reads `GET /api/health` with the administrator token, stops unless `release.revision` equals `EKI_DAST_EXPECTED_REVISION`, scans the three roles and reads `/api/health` again. Expected: within about 40 min, `artifacts/qa/dast-staging-report.md` with the revision, its source commit and a verdict.
6. Run `Remove-Item Env:EKI_DAST_*` and close both private windows.
7. Attach `dast-staging-report.md` and `dast-staging-report.json` to the tracking issue and triage the alerts (Section 6).

## 5. Evidence

| File | Content |
|---|---|
| `artifacts/qa/dast-<profile>-report.json` | Source commit, dirty flag and `ignoredChanges` (generated changes that did not count as dirty), image and ZAP version, target, release identity (staging), bounds, per-role results, fixture evidence (local), `admissionCheck` (local), merged and triaged alerts, counts by risk, verdict |
| `artifacts/qa/dast-<profile>-report.md` | The same in tables |
| `artifacts/qa/dast-<profile>/<role>/openapi.json`, `plan.yaml` | The scoped contract and the ZAP Automation Framework plan [1] that ran |
| `artifacts/qa/dast-<profile>/<role>/alerts.json`, `zap.log` | The role's sanitized alerts and ZAP's progress log |

Credentials reach ZAP only through the `ZAP_AUTH_HEADER_VALUE` environment variable [3], which the runner passes to `docker run` by name, so the value is in no command line and no file. `ZAP_AUTH_HEADER_SITE` limits the header to the target. The runner sets it to the host name without a port: with ZAP 2.17.0, a value that includes the port matched no request, and ZAP then sent every request without the header.

The runner deletes ZAP's raw report after reading it. For each alert it keeps the plugin, alert reference, name, risk, confidence, CWE and WASC identifiers, count, solution and at most five instances (method, URI, parameter, attack, evidence and other information, each truncated). It replaces the target origin with `<local-backend>` or `<staging>`, and every JWT, bearer credential, test token, device secret and e-mail address with a marker. Staging evidence records the revision name and source commit from `/api/health` before and after the scan.

| Verdict | Exit code | Meaning |
|---|---|---|
| `NO_UNTRIAGED_ALERTS` | 0 | Every alert of Low risk or above has a disposition |
| `UNTRIAGED_ALERTS` | 1 | At least one alert of Low risk or above has none, or an alert recorded as fixed appeared again |
| `REVISION_CHANGED` | 1 | Staging served a different revision or source commit after the scan; repeat the run |
| `BLOCKED` | 1 | Setup failed; `setupError` names the step |
| `DRY_RUN` | 0 | Plans written; nothing was sent |

## 6. Triage

[`qa/dast-triage.mjs`](../../qa/dast-triage.mjs) records a disposition for each alert reference and profile: `fixed`, `false-positive`, `accepted-risk` or `not-applicable`, with a rationale a reviewer can check against the code. An alert of Low risk or above needs an entry for the profile that raised it. An entry for `local` does not cover `staging`, because the staging service adds Cloud Run's front end. Informational alerts are listed and need no entry. A `fixed` entry keeps guarding the fix: the run fails if that alert appears again.

The first local run and its triage are recorded in [DAST local scan, 23 November](../testing/DAST_LOCAL_2026_11_23.md).

## 7. Troubleshooting

| Symptom | Action |
|---|---|
| `Firestore Emulator has exited with code: 1` and `Unable to establish loopback connection` in `firestore-debug.log` on Windows | Java cannot create its AF_UNIX pipe under a temporary folder whose path contains characters such as an apostrophe. Create an ASCII folder and run `$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=C:\Users\Public\eki-jtmp"` before `npm run qa:dast`. Observed with JDK 25 and 27 |
| `Emulator port(s) already in use` | Stop the process the message names, then retry |
| `The disposable backend for <role> did not start` | Read `artifacts/qa/dast-local/backend-<role>.log` |
| `ZAP <role> scan did not finish` | Read `artifacts/qa/dast-<profile>/<role>/zap.log`. ZAP exit code 1 means a plan error |
| Staging run stops at a token check | Sign in again and copy fresh tokens; check that the passenger account has no administrator or operator claims |

## 8. Limits

- The scans cover the HTTP API only. The web app on Hosting, its Content-Security-Policy and the Firebase SDK channels to Firestore and RTDB are out of scope.
- The staging profile sends no mutation and no device request, so injection in request bodies and device ingress is tested only against the local backend.
- ZAP's rules find classes of known flaws in single requests. A scan without alerts does not show that the API is free of authorization or business-logic flaws; [`npm run qa:api`](HTTP_AUTHORIZATION.md) covers negative authorization for every operation.
- Rules that need an out-of-band callback service do not run: Log4Shell is off, and the pinned image installs no server-side request forgery (40046) or Text4shell (40047) rule.

## 9. References

[1] ZAP, "Automation Framework," zaproxy.org/docs/automate/automation-framework/. Accessed: 2026-11-23.

[2] ZAP, "OpenAPI Support," zaproxy.org/docs/desktop/addons/openapi-support/. Accessed: 2026-11-23.

[3] ZAP, "Authentication," zaproxy.org/docs/desktop/start/features/authentication/. Accessed: 2026-11-23.
