# Bounded Work Admission

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-027 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

Every backend queue that can grow while a dependency stalls has a fixed number of running jobs, a fixed number of waiting jobs and a maximum time a job may wait before it starts. This document lists those limits and describes how rejected or expired lifecycle work is recovered.

## 2. Scope

All limits apply per backend process; the fleet-wide ceiling is the per-process value times the replica count. Deadlines inside a telemetry request are described in [telemetry deadlines](TELEMETRY_DEADLINES.md). Executors that serve one feature are listed in Section 4.2 with a link to the document that owns them.

## 3. Behaviour

### 3.1 Admission rules

- A job is admitted immediately or rejected. Capacity exhaustion rejects admission; queue expiry rejects a job that has not yet started its dependency call. Both release the waiting metadata and allow a later retry.
- A dispatched job keeps its execution slot and its key's ordering until the real promise settles, even after a response deadline or shutdown. Clearing deduplication fingerprints never lets a new write race an older commit whose outcome is unknown.
- Dispatch rotates fairly between ready keys, so one busy key cannot take every turn.
- The caller's async context, including the worker generation, is carried into queued work. A queue shared by fenced and unfenced callers starts each item in its own requester's context.
- Route matching, rerouting and the public projection keep only the newest position per ride: a newer position replaces the waiting one and refreshes its queue age, and a running job may hold one newest follow-up. Durable lifecycle writes use a separate first-in, first-out queue and are never replaced.
- The deduplication cache (least recently used, 1,000 fingerprints) only suppresses repeated writes; it does not control execution or capacity.
- KDF admission failure or expiry is returned to the device as the retryable telemetry 503.

### 3.2 Lifecycle recovery after overload

Rejected or expired lifecycle work, and any failed live event, requests a reread of current state instead of keeping the event body. The worker leader also requests one at startup, so missed removals are found after a cold start.

1. Every second, if a reread is requested and both the intake and durable queues have room for 25 more items, the recovery loop reads one page of 25. It holds at most one page and one read at a time and never runs parallel scans.
2. It first pages through `activeBuses` keys, then `bus_locations` document IDs.
3. A live record re-enters the ordered intake. At dispatch the record is read again, so an older page value is never written.
4. A durable `bus_locations` record whose live record is missing is retired only after checking current RTDB presence and the canonical ride and lock ownership. Presence is checked again inside the bus's ordered write, and the Firestore transaction rechecks session ownership, so a replacement route, driver or lock is never retired by an older projection.
5. Individual item failures do not stop the page; a full queue or a failed item schedules another full pass. A failed page read retries the same cursor.

Recovery starts from current state and already committed progress. It cannot reconstruct a movement or event time that was never observed or committed during the overload. Shutdown stops replay intake and waits for its single read within the engine's shutdown budget.

## 4. Configuration

None of these values is configurable at run time. The defaults of the shared executor are 8 running, 256 waiting, 32 waiting per key and a 5 s queue age (`backend/src/lib/boundedKeyedExecutor.ts:43`).

### 4.1 Telemetry and lifecycle queues

| Work | Running | Waiting | Waiting per key | Queue age | Source |
|---|---:|---:|---:|---:|---|
| Telemetry ingestion, keyed by device | 8 | 32 | 1 | 2 s | `backend/src/services/deviceTelemetryService.ts:43` |
| Credential check for an unverified pair | 16 fills | 64 callers per fill | | 5 s caller deadline | `backend/src/services/deviceTelemetryService.ts:143` |
| Credential refill for a previously verified pair | 8 fills | 64 callers per fill | | 5 s caller deadline | `backend/src/services/deviceTelemetryService.ts:149` |
| scrypt KDF | 4 | 32 | 1 | 5 s | `backend/src/services/deviceTelemetryService.ts:38` |
| scrypt KDF, verified refill lane | 2 | 8 | 1 | 5 s | `backend/src/services/deviceTelemetryService.ts:42` |
| Durable fleet and active-ride writes | 8 | 256 | 32 | 5 s | `backend/src/services/tripStateEngine.ts:59` |
| Ordered live lifecycle intake | 8 | 256 | 32 | 5 s | `backend/src/services/tripStateEngine.ts:62` |
| Route matching, newest position per ride | 8 | 256 rides | 1 | 5 s | `backend/src/services/telemetryRouteService.ts:1281` |
| Rerouting, newest position per ride | 2 | 64 rides | 1 | 5 s | `backend/src/services/telemetryRouteService.ts:1326` |
| Public live projection, newest value per bus | 2 | 64 | 1 | 5 s | `backend/src/services/liveBusProjection.ts:198` |
| Automatic service admission | 8 | 128 | 1 | 10 s | `backend/src/services/automaticServiceAdmission.ts:14` |
| Lifecycle recovery page | 1 page of 25 | | | | `backend/src/services/pagedLifecycleReplay.ts:8` |

The credential check runs before a request takes an ingestion slot, so requests stalled on scrypt for unknown devices cannot take ingestion capacity from known devices, and the verified refill lanes keep known devices from queueing behind them.

### 4.2 Feature executors

| Work | Limits | Owner |
|---|---|---|
| Admin route computation | 2 running, 8 waiting, 2 s | [Route geometry reads](ROUTE_GEOMETRY_READS.md) |
| Legacy fleet mutations | 2 running, 8 waiting, 2 s | [Reconciliation](RECONCILIATION.md) |
| Durable HTTP operations | 2 running, 8 waiting, 2 s | [Operation resources](../api/OPERATION_RESOURCES.md) |
| Privacy deletion | 1 running, 20 waiting, 2 s | [Passenger account deletion](PRIVACY_DELETION.md) |
| Abandoned-session scans | 1 scan running, 1 waiting, 5 s | [Reconciliation](RECONCILIATION.md) |
| API read caches | 8 fills, 32 waiters, 3 s | [API read caching](API_READS_AND_RETIREMENT.md) |

## 5. Failure modes and recovery

Admin health (`GET /api/health`) exposes `telemetry.workQueues` with `kdf`, `ingestion`, `lifecycle`, `intake`, `staleSweep`, `recovery` and `publicProjection`, and `telemetry.routeProcessing` for matching and rerouting. The counters show running and waiting keys, rejections, expiries, peak waiting and the configured limits; they contain no bus IDs, session IDs or credential digests. The public `/health` and `/live` probes do not expose them.

| Symptom | Meaning | Action |
|---|---|---|
| Rising `rejected` or `expired` on a queue | A dependency is slow or stalled. | Check Firebase and Google availability. Queued work is retried from current state. |
| `recovery.requested` stays `true` | The queues stay too full for a 25-item page. | Find the slow dependency; recovery resumes once queues drain. |
| Running count stuck at its limit | A dispatched call has not settled; its slot stays held by design. | Restore the dependency or restart the process. |

Cross-store races between RTDB and Firestore, and dispatched effects that cannot be recalled, keep the limits described in [worker leadership](WORKER_LEADERSHIP.md).

## 6. Verification

| Behaviour | Tests |
|---|---|
| Executor limits, fairness, expiry and real-settlement ordering | `backend/src/lib/boundedKeyedExecutor.test.ts`, `backend/src/lib/concurrency.test.ts` |
| Newest-position replacement and follow-ups | `backend/src/lib/latestPendingScheduler.test.ts` |
| Durable write FIFO and fingerprints | `backend/src/services/serializedChangeWriter.test.ts` |
| Recovery paging, capacity waits and cursor retry | `backend/src/services/pagedLifecycleReplay.test.ts`, `backend/src/services/tripStateEngine.lifecycle.test.ts` |
| Committed write with a held acknowledgement, queued expiry and a newer final write (Firebase emulators) | `backend/src/workerFence.integration.test.ts`, run by `npm run test:rules` |

A synthetic stalled-dependency benchmark checks the limits and retained memory without any Firebase, provider or network access. Run it from the repository root:

```powershell
npm run build --workspace=backend
node --expose-gc scripts/benchmark-work-admission.mjs
```

It submits 250,000 jobs to each of the KDF limiter, the durable writer and the matcher scheduler with their dependencies held, measures retained heap after five equal rounds, checks the running and waiting ceilings, and verifies recovery and FIFO order after settlement. The result describes these helpers only, not production throughput or end-to-end latency.
