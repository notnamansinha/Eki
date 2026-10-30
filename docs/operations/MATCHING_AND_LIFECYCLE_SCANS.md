# Matching and Stale Presence Scans

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-014 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This document describes how the backend bounds two recurring scans: the segment search that matches each accepted fix to the route, and the sweep that marks or removes live bus nodes whose telemetry has stopped.

## 2. Scope

The document covers search bounds, page sizes, retry timing, health counters and deployment order. The progress window, candidate scoring, ambiguity, the speed-plausibility penalty and the off-route rules are described in [tracking algorithms](../design/TRACKING_ALGORITHMS.md). Replay of lifecycle work after overload is described in [work admission](WORK_ADMISSION.md).

## 3. Behaviour

### 3.1 Bounded segment search

The matcher computes cumulative along-route distances once per geometry object and caches them, so the first match on a geometry costs O(N) in the number of vertices. When the caller supplies a previous match and a finite progress window (defined in Section 4.2 of [tracking algorithms](../design/TRACKING_ALGORITHMS.md)), the matcher binary-searches the cumulative distances for the segments whose along-route interval intersects the window, and projects the fix onto those segments only. A warm bounded search costs O(log N) plus the number of eligible segments, and returns the same answer as a full scan.

Every segment that intersects the window stays eligible, including long segments that cross it, parallel roads, loop legs and repeated vertices. Without a usable previous match (cold start, expired continuity, a session or geometry change, or an absent or non-finite bound) the matcher scans every segment.

### 3.2 Stale presence sweep

Devices cannot register an RTDB `onDisconnect` handler, so the worker sweeps the live records in `activeBuses` instead.

1. Every second the trip engine starts at most one page read. A cycle freezes its cutoff at `now - BUS_STALE_MS`.
2. A page holds at most 25 children ordered by `timestamp`, with numeric timestamps from 0 to the cutoff. The next page continues after the last `(timestamp, key)` pair, so ties are not skipped even when earlier records were deleted. Records without a numeric timestamp are never returned.
3. The sweep runs at most four transactions at a time. Each transaction compares `timestamp`, `seq`, `backendReceivedAt`, `busId`, `routeId`, `driverId`, `sessionId`, `status` and `tripState` with the page value and aborts if any differ, so a fresh fix, a new session or a lifecycle transition wins.
4. An active ride (`status: active` with `tripState` `pre_departure` or `in_service`) keeps its live record and checkpoint; the record is marked `deviceState: offline` and `signalState: lost`. An active ride that is already offline is skipped. Every other stale live record is deleted. A record whose timestamp equals the cutoff is not changed.
5. After a short final page the cycle ends and the next cycle waits `BUS_STALE_MS`.

An empty local SDK cache makes the transaction retry against the server value. The transactions run under the worker lease and generation checks described in [worker leadership](WORKER_LEADERSHIP.md).

### 3.3 Health counters

Admin health (`GET /api/health`) exposes:

- `telemetry.routeMatching`: `calls`, `boundedSearches`, `fullSearches`, `segmentProjections` and `skippedSegments`.
- `telemetry.workQueues.staleSweep`: page reads, records examined, records marked offline or removed, aborted and failed transactions, transaction attempts, completed cycles, the largest page and the most concurrent writes seen, and whether a cycle is still in progress.

Counters are process-local. Compare deltas per fix or per cycle on the current leader; do not sum them across replicas.

## 4. Configuration

| Item | Value | Source |
|---|---|---|
| Cumulative distance cache | One array per geometry object | `backend/src/services/routeMatching.ts:144` |
| Search bound | Binary search of cumulative distances | `backend/src/services/routeMatching.ts:202` |
| Sweep page size | 25 nodes | `backend/src/services/staleBusSweeper.ts:4` |
| Concurrent sweep transactions | 4 | `backend/src/services/staleBusSweeper.ts:5` |
| Retry after a failed page | 1 s, doubling to 30 s | `backend/src/services/staleBusSweeper.ts:18` |
| Sweep tick | 1 s | `backend/src/services/tripStateEngine.ts:1356` |
| `BUS_STALE_MS` | Default 300,000 ms; a value below 90,000 ms or not a number uses the default | `backend/src/services/tripStateEngine.ts:110` |
| RTDB index | `activeBuses` `.indexOn` includes `timestamp` | `database.rules.json:8` |

## 5. Failure modes and recovery

| Condition | Behaviour | Action |
|---|---|---|
| Backlog larger than one page | The sweep needs one tick per 25 nodes. Cleanup latency grows; work per tick stays bounded. | None. Watch `staleSweep.hasMore` and the cycle count. |
| Page read or transaction fails | The cursor is kept and the page is retried after the backoff. | Inspect `worker.staleSweep` background failures in admin health. |
| Wall clock steps backwards | A scheduled wait longer than its bound is discarded, so cleanup does not stall until wall time catches up. | None. |
| Leadership lost during a page | Fenced transactions abort; the next leader starts a new cycle. | None. |
| `timestamp` index missing on the RTDB instance | Ordered queries are not served from an index. | Deploy `database.rules.json` to the selected RTDB instance before the backend that uses these queries. Leaving the index installed after a backend rollback is safe. |

## 6. Verification

| Behaviour | Tests |
|---|---|
| Bounded search equals a full scan, including randomized differential cases and invalid-bound fallback | `backend/src/services/routeMatchingSearch.test.ts`, `backend/src/services/routeMatching.test.ts` |
| Progress rule after a GNSS gap and near a turnaround | `backend/src/services/routeMatchingGapBraking.integration.test.ts` |
| Sweep cursor, ties, partial-page failure and stale generations | `backend/src/services/staleBusSweeper.test.ts` |
| Sweep against a real RTDB emulator | `backend/src/staleBusSweeper.integration.test.ts`, run by `npm run test:rules` |

The search benchmark compares the optimized matcher with a frozen full-scan copy (`backend/src/test-support/routeMatchingBaseline.ts`), asserts equal answers, then times both. Run it from the repository root:

```powershell
npm run build --workspace=backend
node scripts/benchmark-route-matching.mjs
```

It runs each fixture in a separate process and records 300 fixes per fixture; set `R19_BENCH_SAMPLES` to change the count. Projection counts are the deterministic result; wall times depend on the machine. The run recorded on 2026-10-06 (Node 26.8.2) reduced the dense continuity fixture from 10,000 to 158 projected segments per fix; the full-scan cases did not change. The raw output is in [`evidence/r19-matching.json`](evidence/r19-matching.json). In the emulator run of the sweep, 1,057 seeded nodes produced 57 stale candidates in three pages instead of one 1,057-node snapshot. Neither result is a billing or network-traffic measurement.
