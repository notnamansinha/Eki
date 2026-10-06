# R14 live projection: evidence and rollout

Date: 6 October 2026. Base: testing b358dd2. Software evidence only; moving and cloud rollout acceptance remain in #245/#246.

## Decision and measured scope

Keep `activeBuses/{busId}_{routeId}` authoritative for telemetry, lifecycle and matching. Splitting these owners requires moving traces showing retries/write latency after bounded processing, not an emulator concurrency fixture alone. R14 instead filters irrelevant engine events before queue admission and gives browsers a separate compact route materialization.

The loopback experiment in `backend/src/liveBusProjection.integration.test.ts` uses 20 synthetic fixes, with three concurrent SDK transactions per fix against the same node (telemetry identity plus two metadata changes). Warm results on Windows, Node 26.8.2, RTDB emulator 4.11.2:

| Mode | Callback attempts/fix | Value events/fix | JSON bytes/fix | Relevant lifecycle intakes/fix |
|---|---:|---:|---:|---:|
| Speculative local events | 3 | 3 | 147.6 | 1 |
| Committed-only local events | 5 | 2 | 98.4 | 1 |

Committed-only transactions suppress proposed local state before acknowledgement. This reduces event bytes here, but adds callback retries when same-connection writes overlap. It does **not** demonstrate lower transaction contention. Adopt it for authoritative telemetry/matcher writes so engine and public-view listeners consume acknowledged state; preserve the independent rate-limit reservation behavior. Moving acceptance must measure this retry/latency tradeoff. Existing lifecycle worker transactions already use committed-only callbacks.

A separate bounded payload fixture uses 100 buses across 10 routes, raw/matched positions, four trajectory points, a plausibility anchor and worker/context metadata:

| Payload | UTF-8 JSON bytes |
|---|---:|
| Raw fleet, 100 buses | 86,571 |
| Public selected route, 10 buses | 4,268 |
| Counts-only route catalog | 521 |

Route plus catalog is 4,789 bytes (94.5% smaller in this fixture). These are serialized application values, excluding protocol frames, geometry/configuration, listener initialization overlap and billing overhead. They are not production usage or end-to-end latency measurements. Passengers intentionally tracking a joined ride on another route subscribe to that second route too.

Run `npm run test:rules` with Java 21 and loopback Firebase emulators. The measurement prints `R14_TRANSACTION_MEASUREMENT` and `R14_PAYLOAD_MEASUREMENT`. Never redirect these fault/load fixtures at a cloud project. The local focused rules/measurement run passed 10 cases. Unit tests additionally cover projection whitelist, metadata filtering before admission, completion-write retry, current-source rereads, missed deletions, bounded replay and worker takeover.

## Ordering, ownership and recovery

- Durable lifecycle input remains FIFO per bus. Only fields unused by lifecycle are excluded from the admission fingerprint; same-fix session, direction, completion, presence and turnaround changes remain eligible. Errors clear admission fingerprints, and replay bypasses deduplication.
- The elected worker owns public views. Positions use bounded latest-pending scheduling (2 active, 64 pending, 5-second queue age); publications also serialize per route. Dispatch reads current source authority rather than an old queued/replayed session. Rejected/failed publications request bounded reconciliation.
- Public route parent transactions retain private worker generation and revision outside the readable `buses` subtree. Catalog transactions reject older route revisions. Registration precedes publication, making crash-created views discoverable during recovery.
- Startup/periodic reconciliation uses source/view pages of 25 and one catalog route at a time; it repairs absent publications and missed removals. Terminal and removed source records do not become active catalog rides. Sessionless previews expire; active rides remain discoverable during signal loss.
- Passenger listeners read `publicRouteBuses/{routeId}/buses`; only trusted admins read the public fleet root. `liveRouteCatalog/values` carries counts/freshness, never locations. Raw authority and private projection metadata have no client read access. Existing HTTP bus snapshots apply the same explicit whitelist.
- Frontend route stores share listeners, release idle scopes, and reject callbacks after detach or an auth-verification generation change. Reconnect/retry and joined-ride observation survive route switching.

The materializer adds one source read per dispatched bus publication, a route-parent transaction and occasional catalog updates. Replay adds bounded reads. This is an explicit privacy/egress versus backend work tradeoff. Within-route serialization avoids competing public writers on the same elected worker; it does not establish capacity for an arbitrarily large route.

## Protected rollout and moving measurement

1. Deploy the backend worker first while existing browser rules/client remain available. Confirm leadership, bounded replay completion and public-view coverage against current authority through trusted admin tooling. Confirm stale views are removed and route counts are correct. An empty fleet legitimately has no active projection.
2. Release the new browser bundle and the restrictive RTDB rules together after coverage is verified. Old cached tabs requesting raw authority receive permission denied and need to refresh to the new release. Do not claim a seamless rolling client migration.
3. For rollback, restore the previous browser/rules release together; retain authoritative source data. The materialized view can remain unused. Do not grant passenger fleet-root access as a fallback.
4. Capture at least 1,000 accepted moving fixes across normal, weak-network and reconnect windows. Compare telemetry `rtdbTransactionAttempts`/write latency, `workQueues.filteredLifecycleEvents`, `workQueues.publicProjection` events/skips/source reads/attempts/commits/public-value bytes, and existing frontend payload/listener traces. Use deltas from the same window and count raw and matched publications separately. `publicBytes` counts committed projected bus JSON values, not total network bytes or catalog transactions.
5. Revisit separate telemetry/lifecycle/match ownership only with those measurements and the correlation/session/route-version contract in `TELEMETRY_STATE_PARTITION_DECISION.md`. Deploying or certifying live production is outside this PR's verification evidence.
