# Telemetry State Partition Decision

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-ADR-003 | 1.0 | Current | 2026-10-30 |

## 1. Context

Decision date: 2026-09-10. Issues: [#165](https://github.com/notnamansinha/Eki/issues/165), [#166](https://github.com/notnamansinha/Eki/issues/166), [#174](https://github.com/notnamansinha/Eki/issues/174).

The backend keeps one RTDB record per bus and route, `activeBuses/{busId}_{routeId}`. It holds the authenticated raw fix, the matched position and the ride lifecycle fields. Three writers update it in transactions: telemetry ingestion, the map matcher and the lifecycle worker. Contention between them, and matcher work for fixes that are already out of date, could slow the live path. One response would split the record into separate authoritative telemetry, matching and lifecycle nodes.

## 2. Decision

Keep `activeBuses/{busId}_{routeId}` as the single atomic backend authority, and keep route geometry in the version-keyed sibling `activeRouteGeometry`. Do not introduce separate authoritative telemetry, matching and lifecycle nodes until measured production contention shows that the single-node transaction is the bottleneck.

Reduce stale work instead:

1. Bound map matching to one in-flight and one latest-pending sample per bus.
2. Invalidate route snapshots on every replica when a route changes.
3. Reject obsolete in-flight work by route cache generation.
4. Expose RTDB transaction attempts and matcher queue and coalescing counters through the admin-only `/api/health` endpoint.

These changes add no client listeners, hot-path reads or schema joins.

Browsers read a compact per-route materialization (`publicRouteBuses`) and never read `activeBuses`. Server transactions publish committed state only, and the lifecycle worker skips events that change no lifecycle field (evidence in Section 6.2).

## 3. Status

Accepted on 2026-09-10 and in force. Reconsider it only when the measurement gate in Section 6.1 shows contention on a real moving trace.

## 4. Consequences

1. Transactions on one record serialize telemetry, matching and lifecycle updates for each bus. Each writer checks the fields it depends on (sample order, session or route version) inside its transaction and drops a stale update.
2. Under contention, transactions retry and write latency rises. `rtdbTransactionAttempts` and `rtdbWriteLatencyMs` in `/api/health` measure this.
3. Because browsers read a separate projection, a future split of the authority would not change the browser contract.
4. Committed-only transactions deliver only acknowledged state to the worker and projection listeners, at the cost of extra callback attempts when writes on the same connection overlap.

## 5. Alternatives considered

### 5.1 Split authoritative nodes

Deferred. If measurements make a split necessary, the migration shall preserve one immutable correlation tuple across all nodes:

`{busId, routeId, sessionId, telemetry timestamp, telemetry seq, directionEndpointVersion, routeVersion}`

| Node | Owns |
|---|---|
| `activeBusTelemetry` | Raw authenticated samples and timestamp and sequence ordering |
| `activeBusDisplay` | The matched point, its confidence, and the exact telemetry sequence, session and route version used to derive it |
| `activeBusLifecycle` | Session, immutable direction, stop progress and terminal state |
| `activeRouteGeometry` | Immutable geometry keyed by route version (unchanged) |

Consumers may display matched data only when its session and route version match the lifecycle node and its sample sequence is not newer than the telemetry node. Otherwise they keep the last compatible projection, or show the current raw fix with a pending-match state. Server code using the Admin SDK remains the only writer; authenticated clients receive read access no broader than the current projection.

The migration would use an explicit schema version, server dual-writes and shadow comparison, then client dual-reads that prefer the new complete tuple. Rollback keeps the old record authoritative until comparison passes. Old display and geometry versions are removed only after no active lifecycle references them; terminal cleanup keeps the current session-ID guards.

## 6. Evidence

### 6.1 Measurement gate

Capture at least 1,000 accepted moving samples across normal, poor-network and reconnect phases. Record deltas from `/api/health` `telemetry` at the start and end of each phase:

- `rtdbTransactionAttempts` p50, p95 and p99;
- `rtdbWriteLatencyMs` p50, p95 and p99;
- `routeProcessing` `scheduled`, `processed`, `coalesced`, `failed` and `maxQueueAgeMs`;
- end-to-end listener and paint timing from the [telemetry latency baseline](../operations/TELEMETRY_LATENCY_BASELINE.md) runbook.

Reconsider a split only when repeated runs show transaction retries or write latency growing with route and lifecycle updates after bounded processing is enabled. Coalescing by itself shows matcher saturation, not RTDB contention; address it through matcher and routing cost before changing storage.

### 6.2 Recorded results

| Evidence | Result | Limit |
|---|---|---|
| [R14 evidence](../testing/R14_LIVE_PROJECTION.md), loopback emulator experiment | 20 synthetic fixes with three concurrent SDK transactions per fix: speculative local events 3 callback attempts, 3 value events and 147.6 JSON bytes per fix; committed-only local events 5 callback attempts, 2 value events and 98.4 JSON bytes per fix | Shows fewer event bytes with committed-only events; does not demonstrate lower transaction contention |
| [#174 partition gate](https://github.com/notnamansinha/Eki/issues/174#issuecomment-5916470391) | Implementation merged; the 1,000-sample moving, poor-network and contention gate deferred | No evidence yet that a split is necessary |
