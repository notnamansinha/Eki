# Bounded Reconciliation

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-017 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

Reconciliation repairs state that drifted between Firestore, RTDB and Firebase Auth: abandoned ride sessions, driver Auth claims, and driver assignments during bus edits. This document describes how each reconciler pages through its candidates with bounded memory and concurrency, how an administrator follows a paged fleet job, and what a failure leaves behind.

## 2. Scope

The document covers the abandoned-session reconciler, the periodic and on-demand fleet authorization reconcilers, and the paged checks inside bus save and deletion. Durable operation resources and stopped-executor recovery are specified in [operation resources](../api/OPERATION_RESOURCES.md). Lease fencing and its cross-store limits are described in [worker leadership](WORKER_LEADERSHIP.md).

## 3. Behaviour

### 3.1 Pages and cursors

Every reconciler reads candidates in document-ID pages of 100. A page owns its records and caches, so memory does not grow with the backlog. A full page returns its last ID as `nextCursor`; `null` marks the end. An exactly full last page therefore needs one more, empty read. A cursor stays valid when its document is deleted because the query continues after the ID value.

This is a repeatable scan, not a snapshot. A record that moves behind the cursor during a pass is visited on the next full pass.

| Path | Page | Concurrency | Continuation |
|---|---|---|---|
| Abandoned sessions (`ride_sessions` with status `pending`, `armed` or `active`) | 100 sessions, then targeted live record reads | 4 sessions at a time | `_reconciliation_cursors/abandoned-sessions`, hourly |
| Periodic fleet authorization (`drivers`) | 100 drivers with page-local bus and assignment caches | Batches of 10 Auth calls; no new batch after 30 s | `_reconciliation_cursors/fleet-authorizations`, every 10 min |
| Fleet reconciliation job (admin) | 100 drivers and at most 100 result records | Batches of 10; 30 s budget | The caller submits `result.nextCursor` |
| Bus save: route validation | 100 `active_rides` or `devices` per query | One page at a time | All pages are checked before the bus is saved |
| Bus save: driver authorization repair | 100 drivers per query | Batches of 10, with an audit checkpoint per batch | All pages |
| Bus deletion: driver unassignment | 100 drivers per query | Batches of 10, with an audit checkpoint per batch | All pages; stopped-executor recovery after a crash |
| Bus deletion: live record cleanup | 100 `activeBuses` keys per query | 4 conditional transactions | Ordered key cursor until done |

### 3.2 Checkpoints and leadership

The abandoned-session reconciler runs at most one scan and queues at most one more, with a 5 s limit on queue age; its page executor allows one active page and three waiting. Periodic fleet scans run one at a time, including across leadership changes. A page's cursor is saved only after all dispatched work has settled, in a transaction that checks the worker lease. A failure keeps the previous cursor, and a crash between the effects and the checkpoint repeats the page. Session and value predicates, and comparison with current Auth claims and mirrors, make a repeated page safe. An expired leader cannot advance a cursor.

### 3.3 Cross-store safety

Session cleanup rechecks lifecycle activity, session ownership and locks; a session with recent or unknown activity is protected. A session whose bus or route ID cannot address a Firestore document or RTDB node (empty, or containing `/`, `.` or `#`) is skipped and listed in the page summary's `skippedIds`, so it cannot fail the page and pin the cursor.

An RTDB transaction can first see an empty local cache. It then returns a no-op so the SDK retries against the server value, and the session and activity checks apply to the real record. Live record cleanup during bus deletion compares the whole captured value and bus identity before removal, so a newer lifecycle survives.

### 3.4 Fleet lock

Every fleet endpoint that changes Auth, the periodic and on-demand reconcilers, and [privacy deletion](PRIVACY_DELETION.md) share the fleet lock, the Firestore document `_fleet_reconciliation_locks/singleton`, which never expires. Legacy fleet mutations are admitted with 2 active, 8 waiting and a 2 s queue limit, including writing the `_fleet_operations` audit record. A raw SDK call keeps its permit and the lock until it settles, even after a paired-read failure or a client disconnect. There is no expiry-based takeover. Graceful shutdown drains accepted mutations.

Bus mutations record batch and cursor progress in `_fleet_operations`, and the lock exposes its `auditOperationId`. Bus deletion rechecks each driver's assignment and the bus lock, then rechecks rides, devices and the lock in the transaction that deletes the bus. A partial failure can leave drivers unassigned while the bus still exists; inspect that state before retrying. These APIs do not commit Firestore, RTDB and Auth atomically and cannot prove that another replica has stopped.

## 4. Configuration

| Item | Value | Source |
|---|---|---|
| Page size | 100 records | `backend/src/lib/reconciliationPages.ts:2` |
| Abandoned scan and page executors | 1 active and 1 waiting scan; 1 active and 3 waiting pages; 5 s queue age | `backend/src/services/abandonedRideReconciler.ts:15`, `backend/src/services/abandonedRideReconciler.ts:16` |
| Abandoned scan interval | 1 h | `backend/src/services/abandonedRideReconciler.ts:18` |
| Abandoned session concurrency | 4 | `backend/src/services/abandonedRideReconciler.ts:103` |
| `ABANDONED_RIDE_THRESHOLD_HOURS` | Default 12 h, minimum 1 h | `backend/src/services/abandonedRideReconciliationLogic.ts:1`, `backend/src/services/abandonedRideReconciler.ts:77` |
| Fleet Auth batch size | 10 drivers | `backend/src/routes/fleet.ts:188` |
| Fleet page budget | 30 s | `backend/src/routes/fleet.ts:176`, `backend/src/services/workerCoordinator.ts:147` |
| Periodic fleet interval | 10 min | `backend/src/services/workerCoordinator.ts:171` |
| Fleet mutation admission | 2 active, 8 waiting, 2 s queue age | `backend/src/routes/fleet.ts:222` |
| Live record cleanup page and concurrency | 100 keys, 4 transactions | `backend/src/routes/fleet.ts:384`, `backend/src/routes/fleet.ts:388` |

## 5. Failure modes and recovery

### 5.1 Following a fleet reconciliation job

1. Submit `POST /api/v2/fleet-reconciliation-jobs` with a new `Idempotency-Key` header (16 to 128 characters of `A-Z`, `a-z`, `0-9`, `_` or `-`) and the body `{}` for the first page.
   Expected result: 202 with `Retry-After: 1` while processing, or 200 with the result. After a transient or unknown response, poll `GET /api/v2/fleet-reconciliation-jobs/{key}` with the same key.
2. Read the result's `records` and `nextCursor`. A settled record failure does not hide later pages. `timeBudgetExceeded: true` means later records in the page were not dispatched; `nextCursor` then points after the last settled batch, or is `""` if no batch ran.
   Expected result: failed records are listed with a code for investigation.
3. While `nextCursor` is not `null`, submit a new key with `{"cursor": "<nextCursor>"}`. An empty cursor means the first page. Each key identifies one page: reusing a key with a different cursor returns 409 `IDEMPOTENCY_KEY_REUSED`.
   Expected result: the last page returns `nextCursor: null`.
4. If an operation is stranded, or the lock is held by a stopped executor, follow the stopped-executor recovery in [operation resources](../api/OPERATION_RESOURCES.md). A returned cursor is never permission to repeat Auth work whose outcome is unknown.

The legacy endpoint `POST /api/fleet/reconcile?cursor=<value>` returns `{checked, repaired, failed}` with the CORS-exposed headers `X-Reconciliation-Complete` and, when more pages exist, `X-Next-Cursor`. Follow the header through every page. Status 207 means a record failed or the dispatch budget ran out; `checked` counts records actually visited.

### 5.2 Error responses

| Response | Meaning | Action |
|---|---|---|
| 409 with `Retry-After: 1` | The fleet lock is held. | Retry later, or inspect the lock with `GET /api/v2/fleet-reconciliation-jobs/lock`. |
| 503 with `Retry-After: 1` | Admission is full or the audit record could not be written; the outcome may be unknown. | Read the current state before retrying the mutation. |
| A call that never settles | Its permit and the lock stay held by design. | Stop the process, audit external effects, then use the conditional lock recovery. |

## 6. Verification

| Behaviour | Tests |
|---|---|
| Page helpers and bounded batches | `backend/src/lib/reconciliationPages.test.ts` |
| Abandoned-session bounds, protection and recovery | `backend/src/services/abandonedRideReconciler.bounds.test.ts`, `backend/src/services/abandonedRideReconciler.recovery.test.ts`, `backend/src/services/abandonedRideReconciliationLogic.test.ts` |
| Fleet jobs, cursors, legacy headers and mutation admission | `backend/src/routes/fleetOperations.test.ts` |
| 203 sessions, 1,001 drivers with synthetic Auth, and paged bus, device and RTDB cleanup against emulators | `backend/src/reconciliation.integration.test.ts`, run by `npm run test:rules` |

Live Auth outcomes, deployed indexes, replica load, process supervision and latency still need staging evidence before production use.
