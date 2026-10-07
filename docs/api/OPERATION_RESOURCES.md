# Operation resources (#194)

Last updated: 2026-10-06 IST (UTC+05:30).

Current implemented contract on `testing`. The original design baseline was `9a7f109`; deployed availability must still be checked per environment.

All endpoints below require an admin Firebase token and return `no-store`.
Existing HTTP clients remain supported. No second streaming transport is added.

| Operation | Submission | Status resource | Budget |
| --- | --- | --- | --- |
| Route save | PUT /api/v2/routes/:routeId, existing saveId/body/version | GET /api/v2/routes/:routeId/save-operations/:saveId | At most 8 Google requests (4 chunks per direction), 10 seconds per upstream call, existing 30-second lease. Metadata-only saves reuse geometry and make zero calls. |
| Geometry preview | POST /api/v2/route-geometry-previews, Idempotency-Key + waypoints | GET /api/v2/route-geometry-previews/:operationId | At most 4 parallel Google requests for 100 stops, 10 seconds per call. No automatic upstream retries. |
| Fleet reconciliation | POST /api/v2/fleet-reconciliation-jobs, Idempotency-Key + optional cursor | GET /api/v2/fleet-reconciliation-jobs/:operationId | One page of 100 drivers, 10 concurrently; stop launching batches after 30 seconds and return nextCursor. Await outstanding SDK calls before releasing ownership. |
| Live reroute | Existing telemetry worker | Existing operational telemetry/traces | At most 4 chunks for the current position plus 100 remaining stops, 3.5 seconds per upstream call. Preserve #167; no new reroute endpoint or extra Google calls. |

Preview/fleet admission is process-bounded: at most 16 unsettled durable admission
fills, 32 callers per identical fill, and a 3-second caller response budget.
Execution has 2 active slots and 8 waiting slots, with a 2-second monotonic queue
age. A queued request has no durable claim and can fail with retryable 503
with `Retry-After: 1`;
retry the same key to establish whether a late claim committed. An expired
admission never dispatches external work after its acknowledgement arrives.
`queued` remains reserved; `processing` is claimed only when execution starts.
Dispatched SDK work retains its permits until true settlement, including caller
timeout and disconnect. Status/discovery/recovery use a separate 16-fill,
32-waiter, 3-second response pool. A held acknowledgement does not free it.
`succeeded` holds the replayable result. `failed` holds a fixed, redacted error
and any partial per-record results. Errors never contain upstream response
bodies, credentials, stack traces or Auth UIDs. Fleet records expose driver ID,
outcome and fixed error code to admins.

Preview/fleet submission returns 202 with Location and Retry-After: 1 while
processing, including concurrent retries. A terminal retry returns 200 with
the same stored result/error; changed normalized payload returns 409. Status
reads return 200 snapshots; polling never launches work. Accepted operations
continue if the caller disconnects and are drained on graceful shutdown.

There is no automatic takeover of a preview/fleet operation after a timeout:
an SDK write or billable upstream request can have succeeded without a durable
acknowledgment. A processing snapshot past its execution budget reports
outcomeUnknown and an opaque recovery identity (`executorId`, `generation`).
A selected status read persists `phase:recovery_required` for an expired
nonlocal claim. Known last progress (`claimed`, `executing`, `locking`,
`authorizing`) includes bounded batch driver IDs and completed-record counts and last-settled cursor;
it never asserts an in-flight Auth/Google effect failed. Terminal outcomes are
written conditionally on the original executor and generation. The fleet
singleton lock also covers legacy reconciliation, admin fleet mutations and the periodic worker.
After a crash, operators must verify the previous executor is stopped before
clearing the internal lock and deliberately submitting a new job. A timeout
alone is insufficient proof that external side effects stopped.

Route-save v2 wraps #172's existing claim/version/active-ride transactions.
Legacy response bodies remain unchanged; 202 responses gain Location and a
retry hint. The v2 status resource exposes normalized operation state and
the stored outcome. Existing route-save lease recovery is retained, so retries
after an ambiguous expired lease can recompute geometry; this contract does
not claim exactly-once billing for such recovery.

The admin route editor still uses the legacy `/api/routes/:routeId` PUT and
`/api/routes/:routeId/save-operations/:saveId` GET. That GET returns a stored
failure as a non-2xx response with its original structured code. Its status
read can instead fail temporarily with 503 `ROUTE_RECONCILIATION_FAILED`;
admin authentication capacity can reject the read before the handler with
503 `AUTH_BUSY` and `Retry-After: 1`. The editor retries these read failures,
network failures, generic gateway 5xx and read-quota 429 inside one 35-second
reconciliation window, honoring Retry-After with a 250–2000 ms poll interval.
Every poll keeps the same `saveId` and issues no new PUT. A 401/403 or stored
save failure stops immediately; expiry reports an unknown outcome rather than
claiming the save failed. A missing operation (404) retains the existing single
same-ID PUT recovery only after an unknown initial write outcome.

Operation records follow OPERATION_LOG_RETENTION_DAYS (default 90 days).
Preview/fleet retention starts at terminal completion; existing route-save
and legacy audit retention starts at creation.
After retention, status returns 404 and replay is no longer guaranteed; clients
must not reuse old keys. Processing preview/fleet records are retained until
terminal; an unresolved fleet lock is never cleared by retention.

Budgets above are limits, not measured latency improvements. Validate preview
Google span count (<=4), geometry-changing save count (<=8), metadata-only
count (0), per-call duration and p50/p95/p99 end-to-end duration in staging;
correlate trace IDs with Google Routes request/usage data. Real traces and
Google usage are required for production acceptance and cannot be replaced by
mocked tests. No live staging or billed Google requests are issued by tests.

The `http.operation.execute` span covers preview/fleet execution through outcome
persistence. `eki.http.operation.duration` records execution latency and
`eki.http.operation.executions` counts actual claims, with bounded kind/outcome
labels. Status polling and replays do not count as executions. Auto-instrumented
Google HTTP spans provide upstream counts and durations.

Staging acceptance targets (to measure, not achieved claims): preview p95 <=12s,
geometry-changing route save p95 <=15s, metadata-only save p95 <=2s, and each
live-reroute Google phase <=3.5s. Record fleet completion p95/p99 and partial
batch outcomes separately; the 30s fleet budget limits new batch launches and
cannot cancel an in-flight Firebase SDK RPC.

Crash recovery runbook (admin token, `Cache-Control: no-store` throughout):

1. Discover processing claims with `GET /api/v2/route-geometry-previews/recovery`
   or `GET /api/v2/fleet-reconciliation-jobs/recovery`. Each page contains at
   most 25 operations and `nextCursor`; pass it as `?cursor=...` until null.
   Healthy processing claims are included; only `recovery.required:true` is
   eligible for abandonment. This is an explicit discovery path after restart,
   not an automatic replay worker.
2. Inspect the status resource and `GET /api/v2/fleet-reconciliation-jobs/lock`
   (404 means no lock). Verify termination of the actual previous executor
   through the runtime supervisor. Correlate its startup
   `[Operations] Executor identity` log with the stored UUID. Expiry alone is insufficient. `executorId`
   is a unique process UUID, not a PID or host label. Legacy records report
   `legacy`/generation 0; verify all potential previous executors stopped.
3. Audit Google usage/result availability and each recorded Auth batch's
   current claims, token revocation and RTDB assignments. Firebase cannot
   prove that a timed-out revocation failed; resolve that uncertainty explicitly
   after stopping the previous executor. Audit authoritative driver/bus state
   before choosing whether another reconciliation is needed.
4. `POST .../:operationId/recovery` with the exact status identity:
   `{ "expectedExecutorId": "...", "expectedGeneration": 1,
   "executorStopped": true }`. This attests a verified stop, atomically bumps
   generation and records a fixed failed outcome with `outcomeUnknown:true`
   and internal admin audit fields. It never launches billable or Auth work.
   A changed identity, active local executor, unexpired or terminal claim is
   refused with 409. Read status after a 503/unknown acknowledgement.
5. A fleet lock with a linked processing operation can be released only after
   that operation is terminal. A missing linked record (for example after
   terminal retention) is explicitly recorded as `missing` in the recovery audit. `POST /api/v2/fleet-reconciliation-jobs/lock/recovery`
   with `{ "expectedOwner": "...", "executorStopped": true }` atomically
   creates `_fleet_lock_recoveries` audit evidence and deletes only that owner.
   It also supports crashed legacy/periodic locks without an operation ID.
   Local unsettled Auth work is refused; no automatic expiry takeover exists.
6. If the audit requires new work, submit a deliberate new key. The original
   key replays its failed unknown outcome, never executes again. If there was
   no claim and admission expired, retry the same original key.

These APIs cannot independently establish that another replica was stopped.
A false stop attestation is unsafe for already-dispatched Auth/Google calls;
Firestore generation checks protect durable progress/outcomes, not external
side effects. Keep supervisor evidence with the incident record. Lock recovery
logs follow the existing 90-day operational retention setting, from `recoveredAt`.
Processing claims remain retained until terminal; retention never releases a lock.
Recovery/timeout caller limits are process-local; staging must measure replica
load, actual Google/Auth outcomes and supervisor termination. No production
recovery actions or live billed requests are authorized by these tests.

The [#167 acceptance record](https://github.com/notnamansinha/Eki/issues/167#issuecomment-5916467888) confirms real-drive latency measurements remain deferred. This change preserves that implementation and does not promote its timeout into a measured latency claim.

Follow [bounded reconciliation](../operations/RECONCILIATION.md) for page continuation, durable worker checkpoints, bounded per-bus repair and legacy/admin audit-lock recovery. Each new cursor uses a new deliberate key after settled effects; uncertain effects require the stopped-executor procedure above.

A fleet lock may link `privacyRequestId`; recover its expired processing privacy claim before releasing the exact stopped-owner lock. Privacy and fleet Auth mutation share the mutex, held through real dependency settlement. See [privacy recovery](../operations/PRIVACY_DELETION.md).
