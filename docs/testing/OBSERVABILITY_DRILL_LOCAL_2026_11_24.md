# Observability Drill, Local: 24 November 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-064 | 1.0 | Historical | 2026-11-24 |

First runs of the [observability drill](../../qa/OBSERVABILITY_DRILL.md) ([issue #519](https://github.com/notnamansinha/Eki/issues/519)) against the compiled backend and disposable emulators, and a replay of the exported telemetry through the repository's Collector configuration. No telemetry left the machine: the backend exported only to the loopback receiver, and the fixture recorded no non-loopback connection and no provider call. The relay to a deployed collector, the Cloud Run revision checks and alert delivery were not run; Section 6 holds their checklist.

## 1. Setup

| Item | Value |
|---|---|
| Checkout | Clean Git worktree of branch `feat/519-observability-drill`, without `.env` files; `dirty: false` in both evidence runs |
| Host | Windows 11 Home 10.0.26200, Docker Desktop engine 29.9.2 |
| Node | v26.13.1 (CI uses Node 24) |
| Java | 27.0.1.1, with `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Users\Public\eki-jtmp` ([troubleshooting](../../qa/OBSERVABILITY_DRILL.md#6-troubleshooting)) |
| Firebase CLI | 15.14.0 |
| OpenTelemetry | `@opentelemetry/sdk-node` 0.300.0, `sdk-metrics` 3.0.0, `instrumentation-http` 0.300.0, `instrumentation-express` 0.72.0, `exporter-trace-otlp-http` 0.300.0 |
| Collector replay | `otel/opentelemetry-collector:0.161.0@sha256:b6d2b9a85b1029d05b5ad913150c1f014eed4ae99be81a1813ca5ade4a191913`, `jaegertracing/jaeger:2.21.0@sha256:3d0ac795ff98aa04d1be04311d2dac6c25b4bfc8322dc02e53bc5b170c5018c3` |
| Commands | `npm run qa:observability`, then `npm run qa:observability:collector` |

## 2. Runs

Both evidence runs started from a clean tree at harness commit `b09407fe` with `artifacts/qa/observability*`, `backend/dist` and the TypeScript build cache deleted. A development run before the harness was committed (2026-11-23 19:34 UTC, `dirty: true`) found the start-up banner (F7); it is not counted.

| Run | Commit | Dirty | Drill started (UTC) | Drill finished (UTC) | Command wall time | Verdict |
|---|---|---|---|---|---|---|
| A | `b09407fe` | false | 2026-11-23 21:40:08 | 2026-11-23 21:41:43 | 153 s | PASS |
| B | `b09407fe` | false | 2026-11-23 21:44:49 | 2026-11-23 21:45:53 | 117 s | PASS |

| Run | Phase | Requests | Statuses | Payloads (traces, metrics, logs) | Drill server spans | OTLP log records | Backend exit |
|---|---|---|---|---|---|---|---|
| A | `always` | 25 | 200: 16, 201: 1, 202: 3, 401: 1, 503: 3, 504: 1 | 15, 3, 4 | 25 | 8 | 0 |
| A | `default` | 438 | 200: 170, 401: 250, 503: 18 | 9, 2, 3 | 54 | 22 | 0 |
| B | `always` | 25 | 200: 16, 201: 1, 202: 3, 401: 1, 503: 3, 504: 1 | 13, 2, 4 | 25 | 8 | 0 |
| B | `default` | 438 | 200: 170, 401: 250, 503: 18 | 8, 2, 3 | 41 | 22 | 0 |

The command wall time includes the backend build and the emulator start.

## 3. Results

Every check passed in both phases of both runs.

| Check | Phase | Run A | Run B |
|---|---|---|---|
| `trace-per-request` | `always` | 25/25 trace IDs found with `service.name=eki-backend` | 25/25 |
| `trace-per-request` | `default` | 10/10 sampled parents | 10/10 |
| `error-span` | `always` | 4/4 5xx server spans with status `ERROR` and the response code; 0 exception events | Same |
| `error-log` | `always` | 4/4 WARN records with the request's trace ID; 4/4 in stdout `trace_id` | Same |
| `error-log` | `default` | 18/18 WARN records, each with a trace ID | Same |
| `metric-counts`, `metric-histogram-counts` | `always` | Counter and histogram both 200: 16, 201: 1, 202: 3, 401: 1, 503: 3, 504: 1, equal to the responses | Same |
| `metric-counts`, `metric-histogram-counts` | `default` | 200: 170, 401: 250, 503: 18, equal to the responses | Same |
| `periodic-metric-export` | Both | A 30 s export after the last request | Same |
| `structured-stdout` | `always`, `default` | 8 of 9 and 22 of 23 lines JSON; the other line is the start-up banner; 4 and 18 lines carry `trace_id` | Same |
| `canary-scanner`, `canary-delivery` | Both | All 8 kinds found in the control text; canary requests answered 200, 202 and 503 by their handlers | Same |
| `redaction` | Both | No canary in any payload, stdout or stderr | Same |
| `loopback-only` | Both | 0 denied connections, 0 denied provider requests, `externalNetworkExecuted: false` | Same |
| `backend-exit` | Both | 0 | 0 |
| `default-ratio` | `default` | 44 of 418 root traces kept (10.5 %); band 21 to 62 | 31 of 418 (7.4 %) |
| `parent-sampled`, `parent-unsampled` | `default` | 10/10 kept, 0/10 kept | Same |

The `@opentelemetry/instrumentation-http` server histogram counted 24 responses of 200 in phase `always` against 16 sent, and 174 against 170 in phase `default`: the extra requests are the drill's calls to the fixture's control listener, which the instrumentation also traces. The `eki-backend` metrics exclude them.

Against the exported metrics, all 13 dashboard selectors resolved. Four declared instruments were not exercised and were checked by name only: `eki.background.failures`, `eki.worker.runs`, `eki.http.operation.duration` and `eki.http.operation.executions`.

The relay path was run once from the same clean tree with `EKI_OBS_OTLP_ENDPOINT=https://otlp.example.invalid/otlp`, a reserved name that never resolves: all 18 payloads were scanned, none held a canary, every forward failed with a network error, the other 13 checks passed, and the verdict was `FAIL` as expected. The report named only the header, and the exported resource attributes were limited to `service.name`, `service.version`, `deployment.environment` and `telemetry.sdk.*`. The relay dry run refused a missing endpoint, a confirmation differing by a trailing slash, HTTP, the staging backend origin and an inherited `OTEL_EXPORTER_OTLP_HEADERS`, and wrote the plan for an exact confirmation without opening a connection.

## 4. Findings

| ID | Finding | Evidence | Proposed change |
|---|---|---|---|
| F1 | Error traces are not retained. With the default sampler (`parentbased_traceidratio`, 0.1) the backend decides when a request starts, before its status is known, and nothing downstream keeps errors: the Collector configuration has no tail sampling, and the pinned core Collector image has no `tail_sampling` processor | Root 5xx traces exported: 3 of 18 (run A) and 1 of 18 (run B). Metrics counted 18 of 18 and the Places handler logged 18 of 18 in both runs; 15 and 17 of those log records carry a trace ID whose trace was never exported | Alert on metrics, which count every request, and treat the trace as a sample. If every error trace is needed, export spans at `parentbased_always_on` to a Collector built with the contrib `tail_sampling` processor that keeps every trace with an `ERROR` span and 10 % of the rest. That sends every span to the Collector, about ten times today's span export |
| F2 | A 5xx answered by a handler carries no exception event. The server span has status `ERROR` and the status code, but only the last-resort request error handler calls `recordActiveSpanException()`; the Places handler, `apiReadFailure()` and the other handlers that answer 5xx themselves do not | 0 exception events in the 4 sampled 5xx traces of each run | Record a bounded exception (type and code, not the message, which can hold document paths with UIDs) on the active span where handlers answer 5xx |
| F3 | The p95 latency panel is wrong. The `eki-backend` meter's `http.server.request.duration` is in seconds but has no bucket advice, so it uses the SDK default bounds 0, 5, 10, ... 10,000, which suit milliseconds; every request under 5 s falls in one bucket. `@opentelemetry/instrumentation-http` 0.300.0 emits a histogram with the same name and second-scale bounds, so both become `http_server_request_duration_seconds` and the panel sums them | Exported bounds: `eki-backend` 0, 5, 10, 25 ... 10,000; instrumentation 0.005, 0.01, 0.025 ... 10. From run B's replayed buckets the panel query gives a p95 of 4.757 s, the `eki-backend` histogram alone 4.760 s and the instrumentation histogram alone 0.200 s (mean 0.039 s) | Remove the custom histogram and use the instrumentation's, or give it second-scale `explicitBucketBoundaries` and a distinct name; then point panel 3 at one of them |
| F4 | Two dashboard panels did not match the exported names. Panel 6 read `eki_device_telemetry_latency`, but the gauge's unit `ms` makes it `eki_device_telemetry_latency_milliseconds`. Panel 7 summed `eki.background.failures` and `eki.background.failures.total`, which both become `eki_background_failures_total` | The hermetic check on the `origin/main` dashboard reports panel 6; the Collector replay exposes both names | Fixed in this change: panel 6 uses the `_milliseconds` name and panel 7 selects `source!=""`. Renaming the observable counter would remove the collision itself |
| F5 | The Collector configuration uses a deprecated exporter name. Collector 0.161.0 logs `"otlp" alias is deprecated; use "otlp_grpc" instead` for `otlp/jaeger`; a later version may refuse the configuration | Collector replay log | Rename the exporter to `otlp_grpc/jaeger` in `observability/otel-collector.yaml` |
| F6 | The dashboard depends on a label the OTLP translation does not create. Every panel filters on `service_name`; the Prometheus compatibility rules put `service.name` in `job` and other resource attributes in `target_info` | The replay needed `resource_to_telemetry_conversion` for any panel to resolve | Promote `service.name` to a label in the metrics backend, or filter on `job` |
| F7 | One stdout line is plain text. `startTelemetry()` prints `[OpenTelemetry] Traces, metrics, and logs enabled.` before `bootstrap.ts` installs the console bridge, so the line reaches the log sink without severity | `structured-stdout` in each run | Log the line after the bridge is installed, or accept it |

The SDK's default resource detectors export `host.name`, `host.id`, `process.owner`, `process.command_args` and `process.executable.path`. On Cloud Run these describe the container, not a person; the relay mode sends only `service.name`, `deployment.environment` and `service.version`.

## 5. Collector replay

`npm run qa:observability:collector` replayed run B's exports from the same clean tree (`dirty: false`, verdict `PASS`, 10 s). The Collector ran `observability/otel-collector.yaml` unchanged plus an overlay that adds the Prometheus exporter, with `resource_to_telemetry_conversion`, to the metrics pipeline.

| Check | Result |
|---|---|
| `collector-accepts` | 200 for all 21 trace, 4 metric and 7 log payloads |
| `collector-forwards-traces` | Jaeger returned 25 of 25 phase `always` trace IDs with service `eki-backend` |
| `collector-forwards-logs` | The debug exporter printed 30 of 30 log records |
| `collector-forwards-metrics` | The debug exporter printed 496 of 496 data points |
| `translator-matches` | The harness's Prometheus name matched an exposed family for all 34 exported instruments (33 families: two instruments share one, F3) |
| `dashboard-resolves` | Every selector resolved except `source` on panel 7, because no background failure occurred and the per-source counter was not exported |

The Collector logged two warnings and no errors: the deprecated `otlp` alias (F5), and `resource_to_telemetry_conversion is deprecated; use resource_constant_labels instead`, which comes from the overlay, not the repository configuration. An earlier replay of the development run gave the same results.

## 6. Not run: deployed collector, Cloud Run revision and alerts

Issue #519 asks for a named deployed revision with a trace, a metric series, a log line and a delivered alert. None could be produced here: the staging manifest sets `OTEL_SDK_DISABLED=true` and no endpoint, no collector or metrics backend exists for the project, no alert rules or contact points exist, and this run sent no traffic to any deployed service. The relay dry run was checked with a placeholder endpoint and sent nothing. The issue also lists a Sentry-compatible error tracker; the repository has no error-tracker client, so exceptions reach only spans and log records.

Steps, once a throwaway collector exists: [relay](../../qa/OBSERVABILITY_DRILL.md#43-relay-to-a-deployed-collector), then the [Cloud Run revision](../../qa/OBSERVABILITY_DRILL.md#44-deployed-cloud-run-revision) and [alert delivery](../../qa/OBSERVABILITY_DRILL.md#45-alert-delivery). Record the results in a new evidence record with this checklist:

| Item | Record |
|---|---|
| Collector | Vendor, region, stack name; created and deleted (UTC) |
| Relay run | Harness commit, `dirty: false`, report verdict, payloads forwarded and accepted |
| Revision | Cloud Run service and revision, image digest, `release.sourceSha` from the admin `/api/health` |
| Configuration | `OTEL_SDK_DISABLED`, the endpoint host, the secret name and version holding the headers, and the sampler |
| Trace | Link or screenshot of one request trace with `service.name=eki-backend`, its trace ID and timestamp; the `traceparent` flags Cloud Run passed in |
| Error trace | Link to one 5xx trace with its status, or the reason none was sampled (F1) |
| Metric series | Query and screenshot of `http_server_request_count_total` for the revision, with the count expected from the requests sent |
| Log line | Link to one structured log line carrying `trace_id`, and to its trace |
| Redaction | The canary values searched in the log, trace and metric stores, and the result |
| Alert | Rule name, threshold and window; time fired; channel; time delivered; time acknowledged by on-call |
| Rollback | Whether the alert gate stopped or rolled back the release, and the run link |

## 7. Limits

- The results describe the compiled backend with emulators, synthetic providers and one Places outage path. They do not show Cloud Run's front end, the deployed configuration, or a real trace, metric or log backend.
- The sampling result is the SDK's head-sampling behaviour; a deployment that adds tail sampling or always samples would differ.
- The p95 values come from cumulative buckets of the replayed exports, not from the panel's 5 min `rate()`; both use the same buckets.
