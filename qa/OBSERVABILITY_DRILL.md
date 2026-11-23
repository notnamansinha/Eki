# Observability Drill

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-016 | 1.0 | Current | 2026-11-24 |

## 1. Purpose

The backend exports OpenTelemetry traces, metrics and logs over OTLP/HTTP with JSON encoding when an OTLP endpoint is set ([configuration](../docs/CONFIGURATION.md#37-opentelemetry)). This drill checks that pipeline end to end against requests whose outcome it knows, and checks that no credential, account identifier or location leaves the process in any signal.

| Command | What it does | Needs | Runs in CI |
|---|---|---|---|
| `npm run qa:observability` | Runs the compiled backend on the disposable emulator stack with OTLP pointed at a receiver inside the harness, sends real requests and checks every export | Java, the emulator ports | No |
| `npm run qa:observability:relay` | The same drill, also forwarding each export to one confirmed remote collector; `-- --dry-run` validates and sends nothing | A throwaway collector and its credentials | No |
| `npm run qa:observability:collector` | Replays the last local drill's exports through [`observability/otel-collector.yaml`](../observability/otel-collector.yaml) and Jaeger in Docker | Docker | No |
| `node --test scripts/qa-observability.test.mjs` | Harness logic, the relay guard, and the check that every metric the dashboard queries is produced by a backend instrument | Node | Yes, in `npm test` |

[`scripts/qa/observability-drill.mjs`](../scripts/qa/observability-drill.mjs) holds the receiver, the parsers and every check; [`scripts/qa/run-observability-drill.mjs`](../scripts/qa/run-observability-drill.mjs) runs the drill.

## 2. Prerequisites

| Item | Local drill | Relay | Collector replay |
|---|---|---|---|
| Node and Java | Node 24 and Java 21, as for [`npm run qa:api`](HTTP_AUTHORIZATION.md) | Same | Node 24 |
| Checkout | Locked dependencies and no `.env`, `backend/.env` or `e2e/emulator/.env` file; the emulator fixture refuses to start otherwise | Clean: the runner refuses a dirty tree | A finished local drill in `artifacts/qa/observability/` |
| Ports | The emulator ports, `127.0.0.1:3116` and `3117`, and the receiver on `127.0.0.1:19318` (`EKI_OBS_RECEIVER_PORT` changes it) | Same | `127.0.0.1:19328`, `19889` and `19686` |
| Docker | Not used | Not used | Images `otel/opentelemetry-collector:0.161.0` and `jaegertracing/jaeger:2.21.0`, pinned by digest in [`scripts/qa/replay-otel-collector.mjs`](../scripts/qa/replay-otel-collector.mjs) |
| Remote collector | None | An OTLP/HTTP endpoint over HTTPS that the operator owns, with credentials in a secret store; never an Eki, Firebase or Google service | None |

## 3. What the drill does

### 3.1 Backend start

[`scripts/qa/observability-backend.mjs`](../scripts/qa/observability-backend.mjs) runs with the loopback network guard preloaded. It calls `startTelemetry()` from `backend/dist/instrumentation.js`, then `installConsoleBridge()` from `backend/dist/lib/logger.js`, then loads the emulator fixture [`e2e/emulator/backend.mjs`](../e2e/emulator/backend.mjs), which seeds synthetic data and loads `backend/dist/server.js`. This is the order `backend/src/bootstrap.ts` uses; the wrapper reads `backend/dist/bootstrap.js` and stops if that order changes. The fixture adds no route to the application.

The runner removes every inherited `OTEL_*` variable and sets:

| Variable | Value |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://127.0.0.1:19318`, the receiver in the runner process |
| `OTEL_SERVICE_NAME` | `eki-backend` |
| `OTEL_BSP_SCHEDULE_DELAY` | `500`, so spans leave every 500 ms instead of 5 s. Metrics keep the SDK's fixed 30 s interval and logs their 2 s delay ([`backend/src/telemetrySdk.ts`](../backend/src/telemetrySdk.ts)) |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | Phase `always`: `parentbased_traceidratio` and `1`. Phase `default`: unset, so the backend applies its own default, `parentbased_traceidratio` with `0.1` |
| `WORKER_ENABLED` | `false` |

The backend sets no request-ID header. The drill uses the trace ID of the W3C `traceparent` header [3] it sends as the request ID, and looks for it in spans, OTLP log records and the `trace_id` field of stdout lines.

### 3.2 Phases

| Phase | Requests |
|---|---|
| `always` | 25, each with a sampled `traceparent`: 10 `GET /api/buses` and 5 `GET /api/routes-list` with the canary account, 1 `POST /api/users/bootstrap`, 3 accepted device telemetry samples carrying the canary coordinates, 1 request with a tampered token (401), 1 place search (200), 3 place searches during a provider quota outage (503) and 1 during a provider timeout (504) |
| `default` | 438 without a parent (150 authenticated reads, 250 unauthenticated reads answered 401, 18 place searches during the quota outage), then 10 reads with a sampled parent and 10 with an unsampled parent |

The 5xx responses come from the real Places handler ([`backend/src/routes/places.ts`](../backend/src/routes/places.ts)): the fixture's synthetic provider switches to its `rate-limit` or `timeout` mode through the control listener on `127.0.0.1:3117`, as in the browser acceptance suite. The handler answers 503 `PLACES_UPSTREAM_RATE_LIMITED` to an upstream 429 and 504 `PLACES_TIMEOUT` after its 5 s deadline. The place-search limiter allows 20 searches a minute per user, which bounds the `default` phase at 18.

After the last request the runner waits for one periodic metric export (at most 40 s), so the counts do not rest on the shutdown flush alone. It then stops the backend through the fixture's IPC shutdown, which runs the production `SIGTERM` path and its final telemetry flush.

### 3.3 Canaries

Each phase plants these values in real requests and searches every OTLP payload, as received, and the backend's stdout and stderr for them:

| Canary | Where it is planted |
|---|---|
| Bearer token | The ID token of a fresh emulator account, in `Authorization`. Each dot-separated part of 16 characters or more is also searched |
| UID and e-mail | The same account; both are also inside the token |
| Device secret | `Authorization: Device <secret>` on accepted telemetry |
| Provider key | The synthetic Places key the handler sends upstream |
| Coordinates | `lat` 23.0000432 and `lng` 72.0000812 in accepted telemetry; the five-decimal prefixes are searched, so rounded copies are found too |
| Search text | A random string in the place-search query |

The `canary-scanner` check runs the scanner on a text holding every canary, so a scanner that finds nothing cannot pass. `canary-delivery` confirms that the canary requests reached their handlers.

### 3.4 Checks

Every check below must pass in each phase for the verdict `PASS`.

| Check | Passes when |
|---|---|
| `trace-per-request` | Every request with a sampled `traceparent` has a server span with `service.name=eki-backend` and that trace ID |
| `error-span` | Each sampled 5xx request has a server span with status `ERROR` and `http.response.status_code` equal to the response |
| `error-log` | Each 5xx request has an OTLP log record of severity WARN or higher, and each traced one a stdout line with its `trace_id` |
| `metric-counts`, `metric-histogram-counts` | `http.server.request.count` and `http.server.request.duration` from the `eki-backend` meter, summed by `http.response.status_code`, equal the responses the drill received |
| `periodic-metric-export` | A metric export arrived after the last request and before shutdown |
| `structured-stdout` | Every stdout line is a JSON object with `level`, `time` and `message`, except the start-up banner that `startTelemetry()` prints before the console bridge exists |
| `otlp-logs` | OTLP log records with `service.name=eki-backend` arrived |
| `canary-scanner`, `canary-delivery`, `redaction` | Section 3.3; `redaction` fails on any canary in any export, stdout or stderr |
| `loopback-only` | The fixture recorded no non-loopback connection and no real provider call |
| `backend-exit` | The backend exited 0 after its shutdown flush |
| `default-ratio` | Phase `default`: the share of exported root traces lies in the 99.9 % binomial band around 0.1 |
| `parent-sampled`, `parent-unsampled` | Phase `default`: sampled parents are always exported and unsampled parents never |
| `relay` | Relay only: every payload was forwarded and the collector answered 2xx |

Server spans of the fixture's control listener carry a different `User-Agent` and are not counted. The `@opentelemetry/instrumentation-http` histogram also counts them, so the metric checks use the `eki-backend` meter.

### 3.5 Findings

The report also lists findings that describe the product, not a harness failure:

| Finding | Recorded when |
|---|---|
| `ERROR_TRACES_DROPPED` | The default sampler exported fewer 5xx root traces than were sent. Head sampling decides when a request starts, before its outcome is known, and the Collector configuration has no tail sampling [4] |
| `NO_EXCEPTION_EVENT_ON_HANDLED_5XX` | Sampled 5xx traces have no `exception` span event. For requests, only the last-resort error handler in [`backend/src/lib/requestErrors.ts`](../backend/src/lib/requestErrors.ts) records one; a handler that answers 5xx itself does not |
| `SECONDS_HISTOGRAM_DEFAULT_BUCKETS` | A histogram in seconds uses the SDK's default bounds (0 to 10,000), which suit milliseconds |
| `PROMETHEUS_FAMILY_COLLISION` | Two exported instruments translate to one Prometheus metric family |

The [evidence record](../docs/testing/OBSERVABILITY_DRILL_LOCAL_2026_11_24.md) states the findings of the first runs and the proposed fixes.

### 3.6 Dashboard and alert-rule check

A renamed metric or a changed unit silently empties a dashboard panel or an alert. `scripts/qa-observability.test.mjs` reads every instrument that `backend/src` declares with `create<Instrument>("name", { unit })`, translates each name the way the Prometheus compatibility specification [2] and the Collector's Prometheus exporter do (`.` to `_`, a unit word such as `seconds`, `milliseconds` or `bytes`, `_total` on monotonic sums, units in braces dropped), and fails when:

- a selector in [`observability/grafana/eki-backend-dashboard.json`](../observability/grafana/eki-backend-dashboard.json), or in any Prometheus rule file with `groups:` under `observability/`, names a metric no instrument produces;
- a declaration exists that the parser cannot read;
- two instruments translate to one family, other than the known pair below.

`eki.background.failures` (a counter labelled by `source`) and `eki.background.failures.total` (an observable counter without labels) both become `eki_background_failures_total`. The dashboard therefore selects `source!=""`, and the test requires that matcher on every selector of that family.

The repository has no alert rule files. Its dashboard queries filter on `service_name`, which the OTLP translation puts in `job` and `target_info` unless the metrics backend promotes resource attributes to labels [2]. The collector replay enables that promotion to match the dashboard.

## 4. Procedure

### 4.1 Local drill

Run from the repository root of a clean checkout.

1. Run `npm ci`. Expected: dependencies install from the lock file.
2. Run `npm run qa:observability`. It builds the backend, starts the emulators and runs both phases. Expected: within 4 min, `artifacts/qa/observability-report.md` reports `verdict: PASS`.

### 4.2 Collector replay

1. Pull both images named in `scripts/qa/replay-otel-collector.mjs` with `docker pull` and the full reference. Expected: Docker reports the digests.
2. After a local drill, run `npm run qa:observability:collector`. Expected: within 1 min, `artifacts/qa/observability-collector-report.md` reports `verdict: PASS`. The runner creates a Docker network, Jaeger, and the Collector with the repository configuration plus an overlay that adds the Prometheus exporter to the metrics pipeline, replays every payload, and removes the containers and network.

| Check | Passes when |
|---|---|
| `collector-accepts` | The Collector answers 200 to every payload |
| `collector-forwards-traces` | Jaeger returns each `always` request trace ID with service `eki-backend` |
| `collector-forwards-logs`, `collector-forwards-metrics` | The debug exporter printed every log record and every metric data point |
| `translator-matches` | The harness's Prometheus name for each exported instrument is a family the Collector exposes |
| `dashboard-resolves` | Every dashboard metric selector names a series and labels the Collector exposes; the per-source background failure counter, which a drill without background failures does not export, is excepted |

The report also computes the p95 panel's value from the exposed buckets with the `histogram_quantile` algorithm [5].

### 4.3 Relay to a deployed collector

Use a throwaway collector, for example a Grafana Cloud OTLP gateway stack created for the drill. The backend still exports only to the loopback receiver; the runner forwards each payload after scanning it, and never forwards a payload that holds a canary. In relay mode the backend reports only `service.name`, `deployment.environment=drill` and `service.version=<commit>` as resource attributes (`OTEL_NODE_RESOURCE_DETECTORS=env`), so no workstation host or user name leaves the machine. PowerShell is shown.

1. Copy the collector's OTLP header value from its console, then run `$env:EKI_OBS_OTLP_HEADERS = "Authorization=Basic%20" + (Get-Clipboard)`. Expected: the value is in no file or command history.
2. Run `$env:EKI_OBS_OTLP_ENDPOINT = "https://<collector-host>/<path>"` and `$env:EKI_OBS_CONFIRM_ENDPOINT = $env:EKI_OBS_OTLP_ENDPOINT`. The runner appends `/v1/traces`, `/v1/metrics` and `/v1/logs`.
3. Run `npm run qa:observability:relay -- --dry-run`. Expected: `artifacts/qa/observability-relay-plan.md` reports `verdict: DRY_RUN`, the collector origin and the header names, and nothing is sent. The runner refuses HTTP, credentials, a query or fragment in the URL, loopback and private hosts, Eki, Firebase and Google hosts, a confirmation that differs by any character, and any set `OTEL_EXPORTER_OTLP_*ENDPOINT` or `*HEADERS` variable.
4. Run `npm run qa:observability:relay`. It runs only the `always` phase. Expected: `artifacts/qa/observability-relay-report.md` reports `verdict: PASS` and the `relay` check lists every payload as accepted. This mode has not been run against a real collector yet.
5. In the collector's UI, search for the trace IDs in `artifacts/qa/observability-relay-report.json` (`phases[0].requests[].traceId`) and fill in the deployed checklist of the evidence record.
6. Run `Remove-Item Env:EKI_OBS_*`, then delete the throwaway stack or rotate its token.

### 4.4 Deployed Cloud Run revision

The staging manifest sets `OTEL_SDK_DISABLED=true` and no endpoint ([staging runtime configuration](../docs/operations/STAGING_RUNTIME_CONFIG.md)), so the deployed service exports nothing. Enabling it is a deployment change outside this drill: an `OTEL_EXPORTER_OTLP_ENDPOINT`, the `otlp-exporter-headers` secret with a version, and `OTEL_SDK_DISABLED=false`. After that change, record the items of the Cloud Run checklist in the evidence record for the named revision. On Cloud Run, requests reach the container through Google's front end, which can add a `traceparent` header; with the parent-based sampler the backend follows that decision instead of its own 10 % ratio, so record the `traceparent` flags that the backend receives.

### 4.5 Alert delivery

No alert rules or contact points exist in the repository; risk OPS-01 in the [architecture risk register](../docs/operations/ARCHITECTURE_RISK_REGISTER.md) records the gap. When rules are added as Prometheus rule files under `observability/`, the hermetic check covers their metric names. To verify delivery, fire each rule against the throwaway stack (for the 5xx rule, repeat step 4 of Section 4.3 until the rule's window holds enough 503 responses), and record the notification's arrival time and channel against the rule's target time.

## 5. Evidence

| File | Content |
|---|---|
| `artifacts/qa/observability-report.json`, `.md` | Commit and dirty flag, versions, per-phase requests, checks, observations (statuses, metric totals, histogram bounds, resource attribute keys, exported instruments, collisions), the live dashboard check and findings |
| `artifacts/qa/observability/<phase>-otlp.json` | Every payload the receiver accepted, as JSON; local only, it names the workstation in resource attributes |
| `artifacts/qa/observability/<phase>-backend.log` | Backend stdout and stderr with tokens and secrets replaced by `[REDACTED]` |
| `artifacts/qa/observability-collector-report.json`, `.md` | Collector replay checks, debug exporter counts, translator comparison, dashboard resolution and p95 values |
| `artifacts/qa/observability-relay-plan.*`, `observability-relay-report.*` | Relay dry run and relay run |

Reports carry tokens, secrets and canary values only as `[REDACTED]` or `[JWT]`; the relay report names the collector origin and header names, never header values.

| Verdict | Exit code | Meaning |
|---|---|---|
| `PASS` | 0 | Every check passed; findings may still be listed |
| `FAIL` | 1 | At least one check failed |
| `BLOCKED` | 1 | Setup failed; `setupError` names the step |
| `DRY_RUN` | 0 | Relay plan written; nothing was sent |

## 6. Troubleshooting

| Symptom | Action |
|---|---|
| `Firestore Emulator has exited with code: 1` with `Unable to establish loopback connection` on Windows | Set `$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=C:\Users\Public\eki-jtmp"` (an ASCII folder) before the run |
| `Emulator port(s) already in use` | Stop the process the message names, then retry |
| `The <phase> backend did not start` | Read `artifacts/qa/observability/<phase>-backend.log` |
| `backend/dist/bootstrap.js no longer starts telemetry, then the console bridge, then the server` | `bootstrap.ts` changed its start order; update the wrapper to match before trusting the drill |
| `redaction` fails | The report names the canary kind and the signal; the backend log holds the line with the value replaced |
| `default-ratio` fails | A failure probability of 0.1 % per run is expected; repeat once. Two failures mean the sampler configuration changed |
| `periodic-metric-export` fails | The 30 s metric interval did not elapse within 40 s; check for a stalled backend |

## 7. Limits

- The drill observes the compiled backend on a workstation with emulators and synthetic providers. It does not show the deployed configuration, Cloud Run's front end or a real metrics, log or trace backend.
- The forced 5xx responses come from a provider outage. Firestore, RTDB or Auth outages take other paths; an Auth outage, for example, is answered 401 by `requireAuth`.
- The hermetic dashboard check reads instrument declarations, not labels; the live drill and the collector replay check labels for the instruments they export.
- Alert firing and delivery to on-call are not tested.

## 8. References

[1] OpenTelemetry, "OTLP Specification," opentelemetry.io/docs/specs/otlp/. Accessed: 2026-11-24.

[2] OpenTelemetry, "Prometheus and OpenMetrics Compatibility," opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/. Accessed: 2026-11-24.

[3] W3C, "Trace Context," w3.org/TR/trace-context/. Accessed: 2026-11-24.

[4] OpenTelemetry, "Sampling," opentelemetry.io/docs/concepts/sampling/. Accessed: 2026-11-24.

[5] Prometheus, "Query functions: histogram_quantile()," prometheus.io/docs/prometheus/latest/querying/functions/. Accessed: 2026-11-24.
