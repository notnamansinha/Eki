# R31 moderation and instrumentation profile

Measured 7 October 2026 on Windows x64 using checksum-verified Node **24.21.0**, against testing `41ffbc7`. Chat values are synthetic. No deployment, cloud load or Firebase data access was performed.

## Method and scope

Build with `npm run build --workspace=backend`, then run `node scripts/profile-r31.mjs`. `R31_DIST` selects another compiled snapshot. Eight chat shapes run in separate processes with five-second case deadlines: first-call wall time, 300 warm calls, p50/p95/max and total process CPU divided by calls. Startup uses seven fresh processes per mode, measuring **instrumentation import plus awaited SDK start**, CPU, RSS/heap deltas and loaded CommonJS modules. This is the part of backend startup changed here; application imports, database readiness, collector latency and production throughput are excluded. Windows CPU counters are coarse for short batches. Filesystem cache and concurrent local work affect wall time and RSS.

Baseline compiled modules were saved before edits, with the original lockfile dependencies installed. The same harness and Node executable measured both snapshots. Collector endpoints are loopback only. Raw results: [baseline](R31_baseline_node24.json), [final](R31_final_node24.json).

## Startup result (p50)

| Mode | Wall ms before → after | CPU ms before → after | RSS delta MiB before → after | Heap delta MiB before → after | Loaded modules before → after |
| --- | --- | --- | --- | --- | --- |
| Disabled | 910.33 → 54.09 | 1000 → 48 | 31.95 → 6.01 | 17.60 → 1.15 | 777 → 45 |
| Enabled | 979.62 → 694.11 | 1078 → 891 | 30.43 → 28.63 | 13.99 → 9.81 | 778 → 510 |

Disabled startup now loads only the API wrapper. Enabled startup retains HTTP, Express, gRPC (Firestore), Undici, Pino correlation and runtime metrics, instead of the entire auto-instrumentation bundle. The lockfile removes unused plugins and dependencies. Bootstrap awaits SDK initialization before logger/Express/Firebase application modules load. Exporters, batching and HTTP URL redaction are retained; `/health` and `/live` probes are excluded from incoming traces.

## Moderation result

| Synthetic shape | First call ms before → after | Warm p50 ms before → after | Warm p95 ms before → after |
| --- | --- | --- | --- |
| Ordinary message | 53.32 → 2.64 | 0.003 → 0.184 | 0.007 → 0.384 |
| Clean 500 characters | 52.09 → 4.03 | 0.018 → 0.654 | 0.025 → 1.516 |
| Obfuscated English/Hindi | 64.71 → 3.55 | 0.005 → 0.239 | 0.009 → 0.496 |
| Repeated prefix | 53.27 → 3.30 | 0.018 → 0.450 | 0.022 → 0.687 |
| Overlapping symbols | Baseline case exceeded 5,000 ms deadline → 3.03 | unavailable → 0.466 | unavailable → 0.808 |
| Emoji | 65.55 → 3.29 | 0.049 → 0.358 | 0.055 → 0.598 |
| 2,000 raw characters with formatting controls | 68.69 → 3.42 | 0.105 → 0.460 | 0.110 → 0.646 |
| Rejected 2,001 characters | 0.048 → 0.038 | 0.0003 → 0.0003 | 0.0005 → 0.0005 |

The adversarial input is 498 `$` characters followed by `x`, within the accepted 500-code-point limit. `$` overlaps repeated `s` variants and separator classes in the old backtracking expression. The replacement evaluates the fixed dictionary backwards using dynamic programming: O(input code points × total dictionary characters) time and O(input code points × dictionary size) retained state. The existing 2,000 raw code-unit / 500 normalized code-point caps and quota placement are unchanged.

**Tradeoff:** warm ordinary matching is slower than the warmed regex, although measured cases remain below one millisecond at p50. The change removes the backtracking stall and substantially reduces measured cold-call cost; this is not a universal warm-throughput improvement. Class-absence pruning uses the exact supported character classes, including every leetspeak/Unicode variant, so it cannot skip a valid obfuscated term. Greedy repetition/separators, dictionary precedence and Unicode letter/number boundaries are preserved. The frozen old matcher runs only on short differential test inputs.

## Sampling and runtime pin

Unconfigured root tracing now uses `parentbased_traceidratio` with ratio **0.1**. Explicit `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` configuration is respected; parent decisions are retained. Set `parentbased_always_on` for a bounded diagnostic session. Logs and metrics remain independent. Head sampling cannot guarantee retaining every error trace; error logs/counters remain necessary. See [OpenTelemetry sampling](https://opentelemetry.io/docs/languages/js/sampling/).

Both Docker stages pin `node:24.21.0-alpine3.23` to registry manifest-list digest `sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2`, retrieved directly from Docker Hub on the measurement date. Backend Node types are pinned to major 24 (`24.10.13`); their patch numbering is independent of runtime releases. TypeScript target/library moves to ES2022, supported by Node 24 and needed for existing `Array.at` calls after type alignment. The measured Windows executable was checked against [official release sums](https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt). Refresh image and types through reviewed dependency updates.

## Verification

- Dictionary examples, 1,360 term/boundary/separator combinations, uppercase/variant cases and 2,000 deterministic short random cases compare output with the frozen baseline. Long overlapping-symbol regressions complete with unchanged text.
- Fresh-process tests verify disabled SDK modules stay unloaded, concurrent starts share initialization, zero-ratio roots are unsampled and sampled/unsampled parent decisions are respected.
- An ephemeral loopback OTLP collector verifies actual HTTP/Express spans, sensitive HTTP URL redaction, metric and log export after lazy initialization. No external collector or credentials are used.
- Backend/frontend suites, script/OpenAPI/UI contracts, lint and strict production build are checked separately. GitHub CI validates the pinned container build/boot and firmware. Local Docker daemon was unavailable; no local container result is claimed.
- Runtime and full tooling audits report zero vulnerabilities after the narrow shell-quote 1.10.0 → 1.12.0 lockfile repair also carried by the R14 successor.

Production CPU/memory, sustained traffic and collector overhead remain deployment measurements; these local results do not certify them.
