# Load and Fault Drills, Local: 24 November 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-063 | 1.0 | Historical | 2026-11-24 |

First runs of the local mode of the [load and fault drills](../../qa/LOAD_DRILLS.md) ([issue #518](https://github.com/notnamansinha/Eki/issues/518)): the five k6 profiles and three Toxiproxy drills against one compiled backend process in front of disposable Auth, Firestore and RTDB emulators, on one Windows workstation. No request left the machine. k6 reached only the loopback backend, the runner and the backend preloaded the loopback network guard, and Toxiproxy forwarded only to the loopback backend and the Firestore emulator. These are bounded local runs: they are not a capacity measurement, and the 6 min soak is not a duration soak. The deployed run was not made (Section 7).

## 1. Setup

| Item | Value |
|---|---|
| Checkout | Git worktree of branch `feat/518-load-fault-drills`, without `.env` files; `dirty: false` in every report |
| Host | Windows 11 Home 10.0.26200, 24 GB RAM, Docker Desktop engine 29.9.2. Other development sessions were running on the same machine |
| Node | v26.13.1 (CI uses Node 24) |
| Java | 27.0.1.1, with `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Users\Public\eki-jtmp` ([troubleshooting](../../qa/LOAD_DRILLS.md#8-troubleshooting)) |
| Firebase CLI | 15.14.0 |
| k6 | v2.4.0, `grafana/k6:2.4.0@sha256:d41bb79cd8de5a7ad619b53570e3712633e8bff0937010a5c6c57a4747e7a276` |
| Toxiproxy | 2.13.0, `ghcr.io/shopify/toxiproxy:2.13.0@sha256:5d3dae09bc185dcc5ff6cf43abf6062a4a720aff0c4306a471e773acdcd107aa` |
| Command | `npm run qa:load` with the default settings of `scripts/qa/load-plan.mjs` |

## 2. Runs

Four complete runs were made. Runs A and B each led to a harness change; runs C and D used the final harness.

| Run | Harness commit | Started (UTC) | Duration | Verdict | Change after the run |
|---|---|---|---|---|---|
| A | `8143b1e` | 2026-11-23 20:29 | 21 min | `THRESHOLDS_FAILED` | Recovery is judged on the first 15 s of clean windows after the fault, not the last; prober connections are replaced every 10 requests instead of 20 |
| B | `ae01d19` | 2026-11-23 20:54 | 21 min | `THRESHOLDS_FAILED` | Resource samples are written asynchronously; timer stalls are reported |
| C | `60e2def` | 2026-11-23 21:18 | 20 min | `WITHIN_THRESHOLDS` | None |
| D | `60e2def` | 2026-11-23 21:52 | 20 min | `WITHIN_THRESHOLDS` | None |

Runs C and D met every threshold, recovered from every drill and kept the lease across the soak. Run D started as a full test suite was finishing on the same machine; its p95 values are higher than run C's and within budget. Run A failed only on the partition drill: two probes through the client path timed out in the last 2 s of its observation, so the old rule, which required clean final windows, did not count the recovery. Run B failed on the soak and on two drills (Section 6.1).

## 3. Load profiles

Every profile used `/health` and `/live` as public paths and authenticated reads of `/api/routes-list`, `/api/buses` and `/api/routes/qa_route/geometry` with 20 synthetic accounts, 2 s think time. Latencies are those of expected responses (k6 `http_req_duration{expected_response:true}`).

| Run | Profile | Peak VUs | Requests | p50 (ms) | p95 (ms) | p99 (ms) | Failed | Checks | 503 with Retry-After | 429 | Thresholds |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | smoke | 2 | 120 | 17.49 | 61.02 | 82.07 | 0 % | 100 % | 0 | 0 | passed |
| A | load | 20 | 2,674 | 10.94 | 33.35 | 50.79 | 0 % | 100 % | 0 | 0 | passed |
| A | soak | 10 | 3,530 | 17.43 | 48.09 | 83.09 | 0 % | 100 % | 0 | 0 | passed |
| A | stress | 60 | 6,548 | 12.69 | 40.71 | 63.54 | 0 % | 100 % | 0 | 433 (6.61 %) | passed |
| A | spike | 100 | 4,012 | 16.51 | 37.93 | 54.34 | 0 % | 100 % | 0 | 648 (16.15 %) | passed |
| B | smoke | 2 | 120 | 7.83 | 48.6 | 77.4 | 0 % | 100 % | 0 | 0 | passed |
| B | load | 20 | 2,688 | 6.47 | 24.89 | 40.29 | 0 % | 100 % | 0 | 0 | passed |
| B | soak | 10 | 2,146 | 3.58 | 40.24 | 3,303.93 | 6.1 % | 93.9 % | 0 | 0 | **failed** |
| B | stress | 60 | 6,614 | 2.79 | 9.34 | 29.48 | 0 % | 100 % | 0 | 722 (10.92 %) | passed |
| B | spike | 100 | 4,094 | 2.62 | 7.66 | 19.75 | 0 % | 100 % | 0 | 916 (22.37 %) | passed |
| C | smoke | 2 | 120 | 4.23 | 26.27 | 48.85 | 0 % | 100 % | 0 | 0 | passed |
| C | load | 20 | 2,714 | 3.41 | 10.48 | 22.19 | 0 % | 100 % | 0 | 0 | passed |
| C | soak | 10 | 3,588 | 3.42 | 13.12 | 30.82 | 0 % | 100 % | 0 | 0 | passed |
| C | stress | 60 | 6,612 | 3.06 | 9.9 | 18.91 | 0 % | 100 % | 0 | 465 (7.03 %) | passed |
| C | spike | 100 | 4,084 | 3.33 | 13.2 | 28.67 | 0 % | 100 % | 0 | 257 (6.29 %) | passed |
| D | smoke | 2 | 120 | 5.44 | 28.38 | 47.61 | 0 % | 100 % | 0 | 0 | passed |
| D | load | 20 | 2,700 | 5.21 | 17.24 | 31.22 | 0 % | 100 % | 0 | 0 | passed |
| D | soak | 10 | 3,528 | 9.77 | 85.06 | 134 | 0 % | 100 % | 0 | 0 | passed |
| D | stress | 60 | 6,512 | 7.17 | 90.12 | 146.51 | 0 % | 100 % | 0 | 433 (6.65 %) | passed |
| D | spike | 100 | 3,964 | 10.42 | 138.91 | 268.06 | 0 % | 100 % | 0 | 397 (10.02 %) | passed |

No profile in any run received a 503 with `Retry-After`. The 429 responses in stress and spike are the per-IP budget of 1,000 requests a minute: every VU shares the runner's address, and at 60 and 100 VUs the API paths alone send about 30 and 50 requests a second. `/health` and `/live` never received 429. At 20 VUs (load) and 10 VUs (soak) no request was rate limited.

## 4. Fault drills

### 4.1 Client-side drills

Toxiproxy sat between the runner and the backend. A fourth loop probed `/health` directly, without the proxy, as a control.

| Run | Drill | Client probes in the fault | Client p50 / p95 in the fault (ms) | Recovered | Recovery time | Bad probes after recovery | Direct `/health` good |
|---|---|---|---|---|---|---|---|
| A | latency | 84, 3 within 800 ms | 830.9 / 871.0 | yes | 0 ms | 0 | 148/148 |
| A | partition | 251, 7 `ECONNRESET` after 3 s | 22.4 / 58.7 | no (old rule) | - | - | 148/148 |
| B | latency | 84, 1 within 800 ms | 811.6 / 870.7 | no | - | - | 148/148 |
| B | partition | 34, 15 `TIMEOUT` and 3 `ECONNRESET` | 9.6 / 767.9 | fault not observed | - | - | 148/148 |
| C | latency | 84, none within 800 ms | 811.6 / 831.4 | yes | 0 ms | 7 (4 timeouts) | 148/148 |
| C | partition | 212, 11 `ECONNRESET` after 3 s | 7.4 / 20.6 | yes | 0 ms | 0 | 148/148 |
| D | latency | 82, 1 within 800 ms | 827 / 958.3 | yes | 0 ms | 0 | 147/147 |
| D | partition | 212, 12 `ECONNRESET` after 3 s | 6.6 / 17.8 | yes | 0 ms | 0 | 149/149 |

The backend behaved the same in every client-side drill: `/health` answered 200 to every direct probe and to every client probe that reached it. The latency toxic added its 800 ms to each response, and the client returned to its baseline as soon as the toxic was removed. The partition toxic held about 30 % of new connections and closed them after 3 s (run C: 11 probes ended with `ECONNRESET` after 3.0 s); each cost one probe, and the next request opened a new connection.

### 4.2 Dependency drill

The second backend process sent its Firestore traffic through Toxiproxy, which was disabled for 45 s.

| Run | `/health` 503 from | `/health` 200 again after removal | Catalog reads (`/api/routes-list`) | Route geometry reads | `/api/buses`, `/live` | Client recovery | Worker lease |
|---|---|---|---|---|---|---|---|
| A | 14.4 s into the outage | 24.2 s | 503 with `Retry-After` | 503 with `Retry-After` once the 60 s cache entry expired | 200 throughout | 22.8 s | Lost and taken again (generation 2 to 3) |
| B | 14.9 s | 24.1 s | 503 with `Retry-After` from 0.8 s, until 23.3 s after removal | Same, from 41.9 s into the outage | 200 throughout | 23.3 s | Same |
| C | 14.9 s | 25.4 s | 503 with `Retry-After` from 0.8 s, until 6.3 s after removal | Same, from 41.8 s into the outage | 200 throughout | 24.1 s | Same |
| D | 14.9 s | 25.5 s | 503 with `Retry-After` from 0.8 s, until 11.6 s after removal | Same, from 40.6 s into the outage | 200 throughout | 24.2 s | Same |

Read from the code, these follow the documented design: the catalog read cache answers 503 with `Retry-After: 1` when a fill misses its 3 s deadline (`backend/src/services/apiReadCache.ts`); route geometry is cached for 60 s (`routeGeometryReads.ts`); `/api/buses` reads the RTDB projection; `/health` reports the store probes that run every 30 s with a 5 s timeout, so it degrades on the first probe after the outage starts and recovers on the first successful probe after it ends. No request received a 500, and no response took longer than about 3 s.

## 5. Process, lease and resources

| Run | Soak lease | Timer stalls over 10 s | Soak RSS (MiB) | Soak heap used (MiB) | Process changes seen through `/api/health` |
|---|---|---|---|---|---|
| A | Continuous: 23 reads, one owner, generation 1 | 0 (read from its resource log afterwards) | 121.7 to 122.1 | 43.8 to 44.2 | 1 in 72 reads, the planned restart |
| B | **Broken**: generations 1, 2 and 3 | 3, of 50 to 60 s, all in the soak | 113.7 to 117.2 | 50.0 to 46.3 | 1 in 64 reads, the planned restart |
| C | Continuous: 23 reads, one owner, generation 1 | 0 | 113.8 to 115.9 | 50.0 to 45.0 | 1 in 75 reads, the planned restart |
| D | Continuous: 23 reads, one owner, generation 1 | 0 | 118.4 to 120.5 | 50 to 44.6 | 1 in 72 reads, the planned restart |

In every run the runner started two backend processes (the second for the dependency drill) and neither exited unexpectedly. The process check found exactly the planned restart each time, through counters such as the catalog cache's hits and fills going back to zero. Once k6's connections were open, each soak held 16 socket handles from start to end (run A's first soak sample, taken before they opened, read 6), and 19 to 21 active libuv resources; Windows exposes no file descriptor count.

## 6. Observations

### 6.1 Run B

During run B's soak the backend's 5 s resource timer did not fire for 59.6 s, 49.9 s and 52.3 s (ending 21:00:19, 21:03:14 and 21:04:46 UTC). In each gap all ten k6 VUs timed out after 10 s, and the worker lease expired and was taken again by the same process, so the soak failed its thresholds and its lease check. The runner, the emulators and k6 kept working during the gaps: the runner read the lease from the Firestore emulator and saw it expire. Only the backend process stopped. At that time the wrapper wrote each resource sample with `appendFileSync`, which blocks the event loop while the write is pending; the cause of the stall was not established. From commit `60e2def` the sample is written asynchronously and the report counts stalls; runs C and D had none.

Later in run B the client path through Toxiproxy stopped answering for about 70 s, from 50 s into the latency drill to 42 s into the partition drill, and again for about 13 s, while the direct control probes were all good. The latency drill's recovery and the partition drill's baseline and fault fell in the first stall, so the latency drill did not recover and the partition fault was not distinguishable from the stall.

### 6.2 Docker Desktop forwarding

Every run saw short stalls of the client path through Docker Desktop's port forwarding, with the backend healthy: 2 probe timeouts in run A, 45 in run B, 4 in run C and none in run D. A separate 60 s check with a plain loopback server found that 11 of 454 requests from a container to `host.docker.internal`, each on a new connection, failed. The k6 profiles keep connections alive and saw no such failure outside run B's stalls. The harness therefore keeps prober connections alive, judges recovery on the first stable 15 s and reports later bad probes separately. A Linux host or a deployed target does not use this path.

### 6.3 Comparison with other measurements

- Issue #518 recorded a 20 VU, 2 min k6 run of `/health`, `/live` and unauthenticated `/api/health`: 612 requests, p95 2.59 ms. The load profile here sends authenticated reads that reach Firestore and RTDB emulators, about 4.4 times as many requests, with p95 between 10.5 and 33.4 ms.
- The thresholds (800 and 900 ms) are written for a deployed service. Authenticated Admin reads from India to the `us-central1` RTDB took 270 to 285 ms at the median ([RTDB region decision](../design/RTDB_REGION_LATENCY_DECISION.md)), and the Cloud Run backend leg is recorded in [Cloud Run latency, 2 November](CLOUD_RUN_LATENCY_2026_11_02.md). Loopback and emulator latencies say nothing about either.
- `docs/context-docs/PERFORMANCE.md`, which the issue cites, is not in the repository.

### 6.4 Product note

During the dependency drill the backend logged each failed geometry and catalog read as `SingleFlightDeadlineError: Credential verification response deadline exceeded.` The error classes in `backend/src/lib/boundedSingleFlight.ts` carry credential-specific messages but also serve route geometry and API read caches, so an operator reading the log during a Firestore outage is pointed at authentication. The responses to clients were correct. This was not changed.

## 7. Limits

- The deployed run was not made. It needs a window agreed with the staging owner, or a separate `eki-backend-*` service with at most one instance, and a dedicated administrator test account ([procedure](../../qa/LOAD_DRILLS.md#62-deployed-run)). Issue #518 stays open until a report against a named revision is attached.
- Local results describe one workstation, loopback, emulators and synthetic data. They are not a capacity measurement. The expected peak is not defined in the repository, so the load profile's 20 VUs is a default, not the peak the issue asks for.
- Every VU shared one IP; the per-IP budget, not the backend's capacity, capped API traffic in stress and spike.
- The soak lasted 6 min. It shows no growth in that window and cannot show a slow leak.
- Per-device quotas with several trackers behind one NAT need the physical tracker ([issue #430](https://github.com/notnamansinha/Eki/issues/430)).
