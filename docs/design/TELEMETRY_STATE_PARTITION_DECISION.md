# Telemetry state partition decision

Date: 2026-09-10  
Issues: #165, #166, #174

## Decision

Keep `activeBuses/{busId}_{routeId}` as the atomic live projection for now and
retain route geometry in the existing version-keyed `activeRouteGeometry`
sibling. Do not introduce separate telemetry, display and lifecycle nodes until
measured production contention demonstrates that the single-node transaction is
the bottleneck.

The immediate changes bound map matching to one in-flight plus one
latest-pending sample per bus, invalidate route snapshots on every replica,
reject obsolete in-flight work by cache generation, and expose both RTDB
transaction attempts and matcher queue/coalescing counters through the
admin-only health endpoint. This removes stale-work pressure without adding
client listeners, hot-path reads or schema joins.

## Measurement gate

Capture at least 1,000 accepted moving samples across normal, poor-network and
reconnect phases. Record deltas from `/api/health.telemetry` at the start and end
of each phase:

- `rtdbTransactionAttempts` p50/p95/p99;
- `rtdbWriteLatencyMs` p50/p95/p99;
- route `scheduled`, `processed`, `coalesced`, `failed`, `maxQueueAgeMs`;
- end-to-end listener/paint timing from the telemetry baseline runbook.

A split is reconsidered only when repeated runs show transaction retries or
write latency growing with route/lifecycle updates after bounded processing is
enabled. Coalescing by itself identifies matcher saturation, not RTDB
contention, and is addressed by matcher/routing cost before changing storage.

## Contract if a split becomes necessary

The migration must preserve one immutable correlation tuple across all nodes:

`{busId, routeId, sessionId, telemetry timestamp, telemetry seq,
directionEndpointVersion, routeVersion}`.

- `activeBusTelemetry` owns raw authenticated samples and timestamp/sequence
  ordering.
- `activeBusDisplay` owns the matched point, confidence and the exact telemetry
  sequence/session/route version used to derive it.
- `activeBusLifecycle` owns session, immutable direction, stop progress and
  terminal state.
- `activeRouteGeometry` remains immutable and keyed by route version.

Consumers may display matched data only when its session and route version
match lifecycle and its sample sequence is not newer than telemetry. Otherwise
they retain the last compatible projection or show the current raw fix with a
pending-match state. Server/Admin SDK code remains the only writer; authenticated
clients receive read access no broader than the current projection.

Migration would use an explicit schema version, server dual-writes, shadow
comparison, then client dual-reads preferring the new complete tuple. Rollback
keeps the old projection authoritative until comparison passes. Old display and
geometry versions are removed only after no active lifecycle references them;
terminal telemetry/lifecycle cleanup retains the current session-ID guards.
