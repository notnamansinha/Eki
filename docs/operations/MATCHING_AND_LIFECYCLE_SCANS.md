# Matching and lifecycle scan work (issue #246 R19)

## Scope and correctness

This change is isolated from the broader, unmerged PR #272. That PR's cumulative
progress prefilter and timestamp query were reviewed; this implementation adds
binary search, bounded pages/writes, race guards, tests and measurements on the
latest `testing` base (`41ffbc7`). It does not incorporate the other remediation
items in that PR.

The matcher binary-searches cached cumulative distances for every segment whose
physical interval intersects the existing maximum-progress window. It preserves
the original projected-point progress rejection, scoring, headings, confidence,
ambiguity and candidate order. Long segments crossing the window, parallel roads,
loop legs and repeated vertices remain eligible. Missing/expired continuity or
an absent/non-finite bound performs the original full scan. The first use of a
geometry still builds cumulative distances in O(N); warm bounded search costs
O(log N + eligible segments). Route/session/version invalidation remains owned
by the existing matching pipeline.

The stale sweeper reads one `orderByChild("timestamp")` page per one-second tick,
with a limit of 25 and at most four in-flight transactions. It freezes the cutoff
for a cycle and continues after `(timestamp, key)`, including ties even when
previous terminal records were deleted. Numeric timestamps from zero through
the cutoff are queried; timestamps exactly at the freshness horizon are not
mutated. Missing/non-numeric timestamps retain the prior skip behavior. Completed
cycles pause for `BUS_STALE_MS`; failed pages retain their cursor with bounded
1?30 second backoff. Large backlogs take multiple ticks, deliberately trading
cleanup latency for bounded work.

Transactions recheck timestamp, sequence, server-received time, bus/route/driver,
session and lifecycle identity before applying the captured decision. Fresh fixes,
new sessions and terminal/active transitions win. Stale active rides retain their
presence and checkpoint and become device-offline/signal-lost; stale terminal
nodes are deleted. Empty SDK caches retry against server authority. Existing
worker leadership, generation rejection and shutdown fencing remain enforced.

Cold lifecycle replay starts explicitly after engine startup, rather than waiting
for a rejected event or error. It uses the existing 25-record RTDB/document-ID
pages and queue capacity gate; no unbounded startup Promise.all is introduced.
A queued live replay re-reads its single current node at serialized dispatch to
avoid writing the page's older session/lifecycle state. This adds at most one
point read per admitted live replay record; normal live events do not add reads.
Durable fleet replay continues to repair missed removals under its existing
session/lock/presence predicates.

## Reproduce measurements

```sh
npm ci
npm run build --workspace=backend
node scripts/benchmark-route-matching.mjs
npm test
npm run test:rules
npm run lint
```

The benchmark compares a frozen full-scan matcher from `41ffbc7` against the
optimized matcher with exact answer equality before timing. It alternates timing
order, runs each fixture in a separate process to avoid cross-case JIT
specialization, warms geometry/JIT, and records 300 fixes per fixture (override with
`R19_BENCH_SAMPLES`). The no-prior case deliberately retains full scanning; it
uses warm geometry and is not a claim about uncached startup latency. Wall times
are machine-dependent; projection counts are the deterministic acceptance gate.
The unit suite adds 1,500 seeded differential comparisons, dense/long/repeated
geometry cases and invalid-bound fallback checks. Existing route adherence,
parallel-road, loop, stop progression, version and session tests still run.

Before tuning, a 10,000-segment dense continuity fixture projected all 10,000
segments (p50 0.5732 ms, p95 0.9599 ms on local Node 26.8.2). Final paired measurements without competing build processes are stored in
[raw benchmark JSON](evidence/r19-matching.json):

| Warm fixture | Projections before / after | p50 ms before / after | p95 ms before / after |
| --- | ---: | ---: | ---: |
| Dense continuity | 10,000 / 158 | 0.5734 / 0.0145 | 0.7589 / 0.0252 |
| Sparse continuity | 1,000 / 16 | 0.0581 / 0.0037 | 0.1363 / 0.0060 |
| Loop continuity | 1,000 / 476 | 0.0736 / 0.0423 | 0.1720 / 0.0858 |
| No prior | 10,000 / 10,000 | 0.8940 / 0.9033 | 1.3518 / 1.4436 |
| Reacquisition without bound | 10,000 / 10,000 | 0.9820 / 0.9779 | 1.4387 / 1.4689 |
| One long segment | 1 / 1 | 0.0027 / 0.0034 | 0.0035 / 0.0040 |

The improvement is in bounded continuity; full-scan fallback and very small
routes do not have a measured speedup. Keep those fallbacks for correctness.

The actual loopback RTDB test seeds 1,000 fresh records, 52 stale terminal records
and five stale active rides, each with a four-sample history. A separate reader
connection receives only timestamp-filtered pages. It measures serialized
application snapshot JSON, not wire frames or Firebase billed bytes:

| Scan | Returned records | Snapshot JSON bytes | Pages |
| --- | ---: | ---: | ---: |
| Original full snapshot | 1,057 | 410,994 | 1 |
| Indexed stale pages | 57 | 22,216 | 3 |

The returned JSON is 94.6% smaller; all 52 terminal nodes were removed, all five
rides retained with device-offline state, maximum page size 25 and maximum active
writes four. SDK transaction callbacks ran twice per candidate on the cold
reader (114 attempts). Tests also cover timestamp ties, partial-page failures,
stale generations and same-timestamp replacement sessions. The retained backend
live fleet subscription still receives live fleet events, so this is not a
94.6% reduction in total backend network traffic or a billing guarantee.

## Visibility and deployment acceptance

Authenticated detailed health telemetry exposes `routeMatching` (calls,
bounded/full searches, segment projections, skipped segments) and
`workQueues.staleSweep` (page reads, candidates, transactions, effects, failures,
cycle progress and maximum observed bounds). Counters are process-local; sample
deltas per fix/cycle and watch the leader rather than summing gauges across
replicas. Cold replay retains `workQueues.recovery` and intake queue metrics.

Deploy the committed `database.rules.json` timestamp `.indexOn` to the explicitly
selected RTDB instance **before** rolling out backend indexed queries. This index
is an RTDB rules index, distinct from `firestore.indexes.json`. Emulator evidence
validates local rules/query behavior; it does not certify a deployed cloud index.
No cloud rules, backend or production data were deployed by this change.

On staging, record the deployed index and test a realistic long route, parallel
road/loop ambiguity and stop progression. Seed a stale backlog larger than one
page with timestamp ties and reused sessions; restart/revoke a leader while
paging, return a fresh fix during a page, and verify eventual cleanup without
terminal/session rollback. Observe page/write bounds, matching projection deltas,
queue age and dependency traffic. Confirm rules deployment completed before
backend activation and retain the prior backend image for rollback. Roll back
backend behavior if matching or cleanup correctness regresses; leaving the
additional timestamp index installed is safe.
