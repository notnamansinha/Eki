# Load and Fault Drills

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-015 | 1.0 | Current | 2026-11-24 |

## 1. Purpose

`npm run qa:load` and `npm run qa:load:staging` run five k6 load profiles (smoke, load, stress, spike and soak) and Toxiproxy fault drills against one backend process, then write one sanitized report. They answer [issue #518](https://github.com/notnamansinha/Eki/issues/518).

| Mode | Command | Target |
|---|---|---|
| Local | `npm run qa:load` | The compiled backend (`backend/dist`, started through `e2e/emulator/backend.mjs`) on `127.0.0.1:3116`, in front of disposable Auth, Firestore and RTDB emulators (project `demo-eki-qa`) |
| Deployed | `npm run qa:load:staging` | One `eki-backend-*` Cloud Run service whose origin and serving revision the operator confirms, for example the staging service of the [staging runtime configuration](../docs/operations/STAGING_RUNTIME_CONFIG.md) |

The HTTP limiters are in-process: each process allows 1,000 requests a minute per IP and 200 reads and 30 mutations a minute per verified user (NFR-SEC-005, `backend/src/lib/browserAdmission.ts`). A restart resets them and a second instance multiplies them. The harness therefore measures one process, and it reports any sign that a restart or a second instance served the run (Section 5.1). [`qa/k6/profiles.mjs`](k6/profiles.mjs) and [`scripts/qa/load-plan.mjs`](../scripts/qa/load-plan.mjs) hold every bound; [`scripts/qa/run-load.mjs`](../scripts/qa/run-load.mjs) runs the containers and requests.

## 2. Prerequisites

| Item | Local | Deployed |
|---|---|---|
| Docker | Docker Desktop or Docker Engine, running | Same |
| Images | `grafana/k6:2.4.0` and `ghcr.io/shopify/toxiproxy:2.13.0`, pinned by digest in `scripts/qa/load-plan.mjs` (`K6_IMAGE`, `TOXIPROXY_IMAGE`). Pull each once with `docker pull` and the full reference; the runner does not pull | Same |
| Node and Java | Node 24 and Java 21, as for [`npm run qa:api`](HTTP_AUTHORIZATION.md) | Node 24 |
| Checkout | Locked dependencies and no `.env`, `backend/.env` or `e2e/emulator/.env` file; the emulator fixture refuses to start otherwise | Clean: the runner refuses a dirty tree, except for `--dry-run` |
| Ports | The fixed emulator and fixture ports, plus `127.0.0.1:18474` (Toxiproxy API), `18666` (client proxy) and `18685` (Firestore proxy) | `127.0.0.1:18474` and `18666` |
| Identity | 20 synthetic emulator accounts that the runner signs up, and the fixture administrator `qa_admin` | An ID token of a dedicated administrator test account in `bustrack-be165`. Never a person's account |
| Approval | None | The staging owner agrees the window. No deploy may run during it |

## 3. Profiles and thresholds

### 3.1 Profiles

Each virtual user (VU) repeats one iteration: a GET of the next public path (`PATHS`), a GET of the next API path (`API_PATHS`), then `THINK_S` seconds of think time with up to 10 % jitter either way.

| Profile | Shape | Local default | Deployed default |
|---|---|---|---|
| `smoke` | `SMOKE_VUS` constant users for `SMOKE_DURATION` | 2 VUs, 1 min | Same |
| `load` | Ramp over `RAMP` to `VUS`, hold for `DURATION`, ramp down; the expected peak | 20 VUs, 15 s ramps, 2 min hold | 20 VUs, 5 min hold |
| `stress` | Three steps to one third, two thirds and all of `STRESS_VUS`, each reached over `RAMP` and held for `STEP` | 20, 40 and 60 VUs, 40 s steps | 1 min steps |
| `spike` | From 0 to `SPIKE_VUS` in 10 s, held for `SPIKE_HOLD`, down in 10 s | 100 VUs, 30 s hold | 1 min hold |
| `soak` | `SOAK_VUS` constant users for `SOAK_DURATION` | 10 VUs, 6 min | 10 VUs, 20 min |

| Setting | Local | Deployed |
|---|---|---|
| `PATHS` | `/health,/live` | Same; no other public path is accepted |
| `API_PATHS` | `/api/routes-list,/api/buses,/api/routes/qa_route/geometry`, each with a synthetic account's ID token: VU n uses account n modulo 20 | `/api/health` without a token, so each request expects 401 and spends no test account's read budget |
| `THINK_S` | 2 s | 2 s |

At 20 VUs the local `load` profile sends about 10 API reads a second, under the 1,000 a minute per-IP budget, and each account about 30 reads a minute. `stress` and `spike` pass the per-IP budget on purpose, because every VU shares the runner's IP.

The runner executes the profiles in the order smoke, load, soak, stress, spike and waits 65 s after stress and after spike, so that the 60 s limiter windows are empty before the next step. Select profiles with `EKI_LOAD_PROFILES` (for example `smoke,load`) and drills with `EKI_LOAD_DRILLS`. Override any setting above with `EKI_LOAD_K6_<NAME>`, for example `EKI_LOAD_K6_SPIKE_VUS=150`; the report records the values used. The profile files also run without the runner, for example `k6 run --no-usage-report -e BASE_URL=http://127.0.0.1:3116 qa/k6/smoke.js`.

### 3.2 Response classes and thresholds

| Class | Response | Counted in |
|---|---|---|
| ok | 200 on a public path; on an API path, 200 with a token and 401 without | Latency |
| shed | 503 with `Retry-After` on an API path: `Authentication service is busy` from `requireAuth`, a read cache at capacity, or a read the backend reports as temporarily unavailable, such as stored route geometry during a Firestore outage | `eki_shed` |
| rate limited | 429 on an API path, from the in-process limiters | `eki_rate_limited` |
| error | Anything else, including a transport failure, a 503 without `Retry-After`, and any non-200 answer from `/health` or `/live`, which are exempt from the limiter (`isPublicProbe` in `browserAdmission.ts`) | `http_req_failed`, failed checks |

The backend has no `SERVER_BUSY` error code; it answers both deliberate load shedding and a briefly unavailable dependency with 503 and `Retry-After`. With healthy dependencies, as in the profiles, such a response is shedding. Every threshold below comes from issue #518.

| Threshold | smoke, load, soak | stress, spike |
|---|---|---|
| `http_req_failed` | below 1 % | below 1 % |
| p95 of `http_req_duration` for expected responses | below 800 ms | below 900 ms |
| `checks` (response is ok, shed or rate limited) | above 99 % | above 99 % |
| `eki_shed` and `eki_rate_limited` | each below 1 % | Recorded, no threshold |

The issue's "900 ms at peak" is read as the budget for the two profiles that go beyond the expected peak. A profile passes when k6 reports every threshold as met.

## 4. Fault drills

### 4.1 Drills

| Drill | Where | Fault | Baseline, fault, recovery window |
|---|---|---|---|
| `latency` | Client to API | Toxiproxy `latency` toxic, 800 ms added to every response | 15 s, 30 s, 30 s |
| `partition` | Client to API | Toxiproxy `timeout` toxic on 30 % of connections: they carry no data and close after 3 s (a partial partition) | 15 s, 30 s, 30 s |
| `dependency` (local only) | API to the Firestore emulator | The Toxiproxy proxy is disabled, so Firestore is unreachable | 20 s, 45 s, up to 180 s |

During a drill the runner itself is the client. Three loops each send about four GET requests a second with a 5 s timeout, cycling through `PATHS` and `API_PATHS`. Each loop keeps one keep-alive connection, as a browser does, and replaces it after every tenth request (about every 2.5 s). Toxiproxy applies a toxic with a toxicity below 100 % per connection, so about 36 connections draw it during a 30 s fault. A fourth loop sends `GET /health` straight to the backend every 500 ms, without the proxy, as a control for the client-side drills. A probe is good when its class is ok and it finished within 800 ms. For each drill the report gives:

- per phase (baseline, fault, recovery): probes, good probes, errors, 503 responses with `Retry-After`, p50 and p95 latency, and the status counts;
- whether the fault was observed: the share of bad probes during the fault exceeded the tolerance below, or `/health` degraded. A drill whose fault changed nothing fails the run;
- `/health`: how many probes the backend answered with something other than 200, how long after the fault started the first one was, and how long after the fault was removed `/health` answered 200 again. A transport failure of the probe itself is not counted as degradation;
- whether and when the client recovered. The observation after the fault is cut into 5 s windows from the removal of the fault. A window is clean when it holds probes and its share of bad probes is at most the baseline's share, or 2 % if that is larger, so that one dropped connection does not hide a recovery. The client recovered at the start of the first three consecutive clean windows (15 s); the recovery time runs from the removal of the fault to the end of the last bad probe before that point. Bad probes after it are reported separately, so a later relapse stays visible. The dependency drill ends early once it has recovered and `/health` answers 200 again.

The tolerance and the keep-alive connections exist because Docker Desktop's forwarding between containers and the host's loopback is not reliable for new connections: in a 60 s check on 2026-11-24, 11 of 454 requests from a container to `host.docker.internal`, each on a new connection, failed, against none with keep-alive in the k6 profiles. A stall of the whole client path, with the control probes still healthy, belongs to that path and not to the backend; the report shows both.

The fault 45 s is longer than the 30 s health probe interval of `backend/src/server.ts`, so at least one store probe runs while Firestore is unreachable.

### 4.2 Dependency fault

The dependency drill starts a second backend process, because the Firestore client chooses its address when the fixture configures it. [`scripts/qa/load-backend.mjs`](../scripts/qa/load-backend.mjs) points that client at `127.0.0.1:18685`, which Toxiproxy forwards to the Firestore emulator. It sets `FIRESTORE_EMULATOR_HOST` to the proxy only for the fixture's one `settings()` call, so the emulator preflight still sees the reserved port, and it fails the start if the call did not happen. No product code changes; RTDB and Auth stay direct. The restart is planned, so the process check expects exactly one change (Section 5.1).

### 4.3 Topology

| Host | k6 reaches the backend through | Toxiproxy |
|---|---|---|
| Docker Desktop (Windows, macOS) | `http://host.docker.internal:3116` | Container ports published on `127.0.0.1:18474`, `18666` and `18685`; upstreams `host.docker.internal:3116` and `:8085` |
| Linux Docker Engine | `--network host` and `http://127.0.0.1:3116` | `--network host`, listening on `127.0.0.1` only |
| Deployed target, either host | The target origin | The client proxy forwards `127.0.0.1:18666` to the target's port 443; the runner sends TLS with the target's name, so the certificate check is unchanged |

k6 runs with `--no-usage-report`, so it sends no usage statistics. Locally the runner preloads [`scripts/qa/network-guard.mjs`](../scripts/qa/network-guard.mjs), so its own requests can reach only literal loopback addresses, and the backend runs with the same guard.

## 5. Process, lease and resource checks

### 5.1 One process

Locally the runner starts the backend and counts any exit it did not request. In both modes it reads `GET /api/health` with an administrator token (every 15 s locally with `qa_admin`, every 30 s on a deployed target). That response holds counters that only grow within one process: telemetry accepted and rejected, read cache hits and fills, compatibility traffic and background failures, plus the time of the last store probe. When any of them goes backwards between two reads, a different process answered: a restart or a second instance. The run then ends with `PROCESS_CHANGED`, unless the change is the planned restart before the dependency drill. The check can miss a second instance that happens to report larger counters, so it records the revisions seen as well; the deployed procedure adds the Cloud Run instance count (Section 6.2).

### 5.2 Worker lease

The backend runs its background workers under one Firestore lease, `_worker_leases/trip-state-worker`, which lasts 45 s and is renewed every 15 s (`backend/src/services/workerCoordinator.ts`, NFR-AVL-002). Locally the runner reads the lease document from the Firestore emulator before each probe of the process check. The lease is continuous across the soak when every read in the soak window names the same owner and generation and is unexpired. A broken lease makes the verdict `THRESHOLDS_FAILED`. The report also gives the lease over the whole first process and during the dependency drill, where losing it is expected. A deployed target's lease is not readable from the runner; read it in the Firestore console before and after the run.

### 5.3 Resources

Every 5 s `scripts/qa/load-backend.mjs` appends the process's RSS, heap use, active libuv resources and socket handles to `backend-main-resources.jsonl`, and on Linux the number of open file descriptors. The report gives the first, last and largest value in the soak window and a least-squares slope per minute. There is no threshold: a 6 min window cannot show a slow leak. On a deployed target use the Cloud Run memory and instance metrics for the run window.

## 6. Procedure

### 6.1 Local run

Run from the repository root of a clean checkout.

1. Pull the images named in `K6_IMAGE` and `TOXIPROXY_IMAGE`, for example `docker pull grafana/k6:2.4.0@sha256:<digest>`. Expected: Docker reports the digest.
2. Run `npm ci`. Expected: dependencies install from the lock file.
3. Run `npm run qa:load`. It builds the backend, starts the emulators with a 45 min deadline, signs up the synthetic accounts, starts Toxiproxy and the backend, and runs every profile and drill. Expected: after about 30 min, `artifacts/qa/load-local-report.md` with `verdict: WITHIN_THRESHOLDS`.

### 6.2 Deployed run

The staging service serves the pilot web app and the bus trackers. Run against it only in a window agreed with its owner, or deploy a separate `eki-backend-*` service with at most one instance. PowerShell is shown.

1. Read the serving revision and scaling: `gcloud run services describe <service> --region asia-south2 --format="yaml(status.traffic,spec.template.metadata.annotations)"`. Expected: one revision with `percent: 100` and `autoscaling.knative.dev/maxScale: '1'`.
2. Read `_worker_leases/trip-state-worker` in the Firestore console of `bustrack-be165` and note `ownerId`, `generation` and `expiresAt`.
3. In a private browser window, sign in to the web app as the dedicated administrator test account. In the developer tools, open Application, IndexedDB, `firebaseLocalStorageDb`, `firebaseLocalStorage`, select the `firebase:authUser:` entry, copy `value.stsTokenManager.accessToken`, then run `$env:EKI_LOAD_ADMIN_ID_TOKEN = Get-Clipboard`. Expected: the variable holds a token that never appears in the command history or a file. A token lasts 1 h; the runner refuses one that will not outlive the planned campaign by 10 min (about 47 min for the defaults).
4. Name the target twice and the revision: `$env:EKI_LOAD_TARGET = "<origin>"`, `$env:EKI_LOAD_CONFIRM_TARGET = "<origin>"` and `$env:EKI_LOAD_EXPECTED_REVISION = "<revision from step 1>"`. The origin must be the `https://eki-backend-<name>-<project-number>.<region>.run.app` URL; the runner refuses loopback, private and Hosting hosts and any service whose name contains `prod`.
5. Run `npm run qa:load:staging -- --dry-run`. Expected: `verdict: DRY_RUN`, no request, and `artifacts/qa/load-staging/plan.json`, which lists every `docker` command, the Toxiproxy proxies and the toxics. Review it.
6. Run `npm run qa:load:staging`. The runner reads `/api/health`, stops unless `release.revision` equals `EKI_LOAD_EXPECTED_REVISION`, runs the profiles and the `latency` and `partition` drills, and reads the release again. Expected: `artifacts/qa/load-staging-report.md` with the revision before and after and a verdict.
7. Repeat step 2 and compare. In Cloud Monitoring, read the service's instance count, container restarts and memory use for the run window.
8. Run `Remove-Item Env:EKI_LOAD_*` and close the private window.
9. Attach `load-staging-report.md` and `.json`, the lease readings and the Cloud Run readings to the tracking issue.

A soak longer than one token runs as several invocations, for example `$env:EKI_LOAD_PROFILES = "soak"` and `$env:EKI_LOAD_K6_SOAK_DURATION = "40m"`, each with a fresh token; each run checks the revision before and after.

## 7. Evidence

| File | Content |
|---|---|
| `artifacts/qa/load-<mode>-report.json` | Commit and dirty flag, Docker, k6 and Toxiproxy versions and images, target, settings, bounds, per-profile summary, per-drill analysis, soak resources, lease continuity, process check, release identity (deployed) and verdict |
| `artifacts/qa/load-<mode>-report.md` | The same in tables |
| `artifacts/qa/load-<mode>/<profile>-summary.json`, `k6-<profile>.log` | The k6 end-of-test summary and its log |
| `artifacts/qa/load-local/drill-<drill>-samples.json` | Every drill probe: time, path, status or error code, duration and class |
| `artifacts/qa/load-local/backend-<process>.log`, `backend-<process>-resources.jsonl` | The backend log and resource samples |
| `artifacts/qa/load-staging/plan.json` | The deployed plan (also written by a dry run) |

The synthetic ID tokens travel to k6 in `tokens.json`, which the runner deletes after the run, never on a command line. The administrator token stays in memory. Logs are redacted of every token, JWT and bearer value. k6 discards response bodies, and values read from a server reach the report only after they are rebuilt from fixed character sets.

| Verdict | Exit code | Meaning |
|---|---|---|
| `WITHIN_THRESHOLDS` | 0 | Every profile met its thresholds, every drill recovered, the backend did not exit unexpectedly and the lease held across the soak |
| `THRESHOLDS_FAILED` | 1 | At least one of those did not hold; the tables name it |
| `PROCESS_CHANGED` | 1 | More process changes than planned restarts; the run did not measure one process |
| `REVISION_CHANGED` | 1 | The deployed revision or source commit changed during the run; repeat it |
| `BLOCKED` | 1 | Setup failed; `setupError` names the step |
| `DRY_RUN` | 0 | Plans written; nothing was sent |

## 8. Troubleshooting

| Symptom | Action |
|---|---|
| `Firestore Emulator has exited with code: 1` and `Unable to establish loopback connection` in `firestore-debug.log` on Windows | Java cannot create its AF_UNIX socket under a temporary folder whose path contains a character such as an apostrophe. Create an ASCII folder and set `$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=C:\Users\Public\eki-jtmp"` before `npm run qa:load` |
| `Docker image missing; pull it first` | Run the `docker pull` command the message names |
| `Emulator port(s) already in use` | Stop the process the message names, then retry |
| Toxiproxy does not start, or port `18474`, `18666` or `18685` is in use | The runner removes containers named `eki-load-*` left by an interrupted run. Otherwise find the owner with `netstat -ano` and stop it |
| `The main backend did not start` | Read `artifacts/qa/load-local/backend-main.log` |
| A profile row shows `not run` | Read `artifacts/qa/load-<mode>/k6-<profile>.log`. k6 exit code 99 means a threshold failed and the summary is still present |

## 9. Limits

- A local run measures a workstation, loopback and emulators. Its latencies are not comparable with a deployed service or with the authenticated RTDB reads from India to `us-central1` (270 to 285 ms at the median) in the [RTDB region decision](../docs/design/RTDB_REGION_LATENCY_DECISION.md). It is not a capacity measurement and the 6 min soak is not a duration soak.
- Every VU shares one source IP, so the per-IP budget caps API traffic at 1,000 requests a minute per process. Many passengers behind one NAT behave the same way; the per-device quota with several trackers behind one NAT needs the physical tracker ([issue #430](https://github.com/notnamansinha/Eki/issues/430)).
- The profiles send browser GET requests only. Device telemetry ingress has its own load test ([telemetry ingestion load test](../docs/operations/TELEMETRY_INGESTION_LOAD_TEST.md)).
- The deployed profiles send unauthenticated API requests, which the backend answers before any database read. Database latency under load on a deployed target needs many test accounts, which this harness does not provision.
- The dependency drill runs only locally: a deployed backend's Firestore traffic cannot be routed through the runner.
- The issue cites `docs/context-docs/PERFORMANCE.md`, which is not in the repository. The thresholds come from the issue text.

## 10. References

[1] Grafana Labs, "k6 documentation: thresholds, scenarios and end-of-test summary," grafana.com/docs/k6/latest/. Accessed: 2026-11-24.

[2] Shopify, "Toxiproxy: a TCP proxy to simulate network and system conditions," github.com/Shopify/toxiproxy. Accessed: 2026-11-24.
