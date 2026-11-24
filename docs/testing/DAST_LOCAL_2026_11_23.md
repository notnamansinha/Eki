# DAST local scan: 23 November 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-062 | 1.0 | Historical | 2026-11-23 |

First OWASP ZAP active scans of the backend HTTP API ([issue #503](https://github.com/notnamansinha/Eki/issues/503)), run with the local profile of the [bounded DAST and OpenAPI scans](../../qa/DAST.md) against the compiled backend and disposable emulators. No request left the machine: every scan targeted the loopback backend, and the fixture recorded no non-loopback connection and no provider call. The staging profile was not run; Section 5 explains why.

## 1. Setup

| Item | Value |
|---|---|
| Checkout | Detached, clean Git worktree of branch `feat/503-dast-scans`, without `.env` files; `dirty: false` in every report |
| Host | Windows 11 Home 10.0.26200, Docker Desktop engine 29.9.2 |
| Node | v26.13.1 (CI uses Node 24) |
| Java | 27.0.1.1, with `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Users\Public\eki-jtmp` ([troubleshooting](../../qa/DAST.md#7-troubleshooting)) |
| Firebase CLI | 15.14.0 |
| ZAP | 2.17.0, `zaproxy/zap-stable:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af` |
| Command | `npm run qa:dast` |

## 2. Runs

Three complete runs were made while the harness was finished. Each changed the harness, not the backend.

| Run | Harness commit | Change from the previous run | Started (UTC) |
|---|---|---|---|
| A | `03ee8a2` | First complete run; 4 local threads | Not recorded; run B overwrote its report |
| B | `4192078` | 2 local threads; fixture identifiers in request bodies; credential check after each role | 2026-11-23 16:57 |
| C | `0d699c5` | Only rule IDs installed in the image; device credential probe with a valid query | 2026-11-23 17:20 |

| Run | Role | Operations | ZAP exit | Duration (s) | Credential status after scan | Alerts |
|---|---|---|---|---|---|---|
| A | anonymous | 68 | 2 | 163 | Not checked | 0 |
| A | passenger | 68 | 2 | 162 | Not checked | 40045 (1), 10104 |
| A | admin | 68 | 2 | 266 | Not checked | 40018 (4), 10104 |
| A | device | 4 | 2 | 83 | Not checked | 10104 |
| B | anonymous | 68 | 2 | 253 | None | 0 |
| B | passenger | 68 | 2 | 261 | 200 | 10104 |
| B | admin | 68 | 2 | 530 | 200 | 10104 |
| B | device | 4 | 2 | 63 | 400 (probe rejected before the credential check) | 10104 |
| C | anonymous | 68 | 0 | 260 | None | 0 |
| C | passenger | 68 | 0 | 287 | 200 | 10104 |
| C | admin | 68 | 0 | 834 | 200 | 40018 (3), 10104 |
| C | device | 4 | 0 | 179 | 204 | 0 |

In every run the admission check returned 200 for all 201 reads, and the fixture recorded 0 denied connections, 0 denied provider requests and `externalNetworkExecuted: false` for every role. ZAP exit code 2 in runs A and B was a warning for rule IDs that the image does not install (40024, 40046, 40047 locally); run C removed them. Run C took 27 min from emulator start to report. Its anonymous active scan stopped at the 4 min cap; the other roles finished every rule first, the admin scan in 13 min 33 s of its 14 min, longer than in run B because valid fixture identifiers let more mutation payloads past validation.

Run B's device probe, `GET /api/devices/qa_device/firmware` without `sequence`, was answered 400 before the device credential was read, so it did not test the credential. Run C's probe adds `sequence=1` and returned 204.

## 3. Alerts and triage

| Alert | Risk | Runs | Instances | Disposition |
|---|---|---|---|---|
| 40018 SQL Injection | High, confidence Medium | A, C | `POST /api/plan` (`routeId`); `PUT /api/fleet/buses/{id}` (`id`, `name`); `PUT /api/fleet/drivers/{id}` (`id`, `name`) | False positive |
| 40045 Spring4Shell | High, confidence Medium | A | `GET /api/v2/routes/qa_route/segments` with the extra key `class.module.classLoader.DefaultAssertionStatus` | False positive |
| 10104 User Agent Fuzzer | Informational | A, B, C | Responses that did not vary with the `User-Agent` header | Informational; no entry needed |

Both High alerts compare two responses and infer a flaw from the difference. Each instance was replayed against the same disposable fixture with a fresh administrator or passenger sign-in, one request at a time from a reset fixture, and the driver `name` case also back to back without a reset:

| Instance | Original | True condition | False condition |
|---|---|---|---|
| `POST /api/plan`, `routeId` `qa_route AND 1=1 -- ` | 400, invalid IDs | 400, same body | 400, same body |
| `PUT /api/fleet/buses/{id}`, `name` `ZAP AND 1=1 -- ` (run A body) | 400, `Invalid vehicle data.` | 400, same body | 400, same body |
| `PUT /api/fleet/buses/{id}`, `id` `qa_bus' AND '1'='1' -- ` | 200, `{"saved":true}` | 400, `Invalid vehicle data.` | 400, same body |
| `PUT /api/fleet/drivers/qa_driver`, `name` `ZAP AND 1=1 -- ` | 200, `{"saved":true}` | 200, same body | 200, same body |
| Same, back to back without reset | 200 | 200, same body | 200, same body |
| `PUT /api/fleet/drivers/{id}`, `id` `qa_driver' AND '1'='1' -- ` | 200 | 400, `Invalid operator data.` | 400, same body |
| `GET .../segments` with `class.module.classLoader...` | 404, stop `from` not found | 400, invalid query parameter | A plain unknown key `zz=1`: 400, same body |

No payload changed a response that its counterpart did not. The fleet handlers reject an identifier outside `^[A-Za-z0-9_-]{1,128}$` before any database access, and the backend has no SQL database or driver. The differences the scanner saw came from shared state: the admin scan also sends `POST /api/fleet/reconcile` and reconciliation-job requests, which hold the fleet lock, and the run C backend log records 156 fleet mutations answered 409 with `FleetReconciliationBusy`. The segments route answers 400 to any query key other than `from`, `to` and `via` (`backend/src/routes/plan.ts`), which the Spring4Shell rule reads as its signature; the backend runs on Node.js, not a Java Spring runtime.

[`qa/dast-triage.mjs`](../../qa/dast-triage.mjs) records both as `false-positive` for the local profile. Applying the register to run C's sanitized alerts gives 0 untriaged alerts and the verdict `NO_UNTRIAGED_ALERTS`.

## 4. Harness behaviour found during the runs

| Observation | Effect on the harness |
|---|---|
| ZAP 2.17.0 sent no credential when `ZAP_AUTH_HEADER_SITE` included a port | The runner passes the host name only |
| 201 parallel reads against the emulators returned 64 responses of 200 and no 429; the other statuses were not recorded | The admission check sends batches of 10 and records each status |
| Resetting the fixture republishes the administrator's authorization and revokes earlier tokens | Each local role signs in after its backend starts; the replay signed in after each reset |
| ZAP 2.17.0 does not install rule 90025 | Removed from `STAGING_RULES`, which now has 18 rules |
| The staging plan, pointed at a loopback server that counted methods, sent 91 requests, all GET | Supports the GET-only claim for the staging rule set |

## 5. Limits

- The staging profile did not run. The staging service runs one instance that also serves the web app and the trackers, and the run needs two dedicated test accounts and a window agreed with the staging owner ([procedure](../../qa/DAST.md#42-staging-scan)). Issue #503 stays open until that run is attached.
- Local results describe the compiled backend with raised per-user and per-IP budgets, synthetic providers and emulators. They do not show Cloud Run's front end, the deployed configuration or the production limiters.
- ZAP's rules test known flaw classes in single requests. The absence of other alerts does not show that the API is free of authorization or business-logic flaws.
