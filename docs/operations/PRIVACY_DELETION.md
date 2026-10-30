# Passenger Account Deletion

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-015 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This document describes how a passenger requests account deletion, how the background worker processes the request, and how an administrator monitors and recovers a request that failed or was interrupted.

## 2. Scope

Passenger accounts only. Operator and administrator accounts are offboarded by university IT. Account deletion removes account-owned records; it is not a complete personal-data erasure workflow. Feedback, passenger ride entries and messages are retained and remain subject to the retention schedule in the [Firebase data model](../data/FIREBASE_DATA_MODEL.md).

## 3. Behaviour

### 3.1 Request

1. In the passenger **Profile** tab the passenger selects **Delete Account** and confirms. The confirmation states that feedback, passenger ride entries and messages are retained. Cancelling sends nothing.
2. The browser calls `POST /api/v2/privacy-deletion-requests` with no body. The legacy alias `POST /api/privacy/deletion-request` behaves the same way.
3. The backend takes the UID from the verified token and checks current Auth claims, the `users` profile role and `drivers` membership. A missing role claim alone does not block a passenger. A privileged or operator account receives 409.
4. A transaction creates `_privacy_deletion_requests/{uid}` with `status: pending`, or updates an existing record. Resubmission keeps the original request time, lifetime attempts and error history. A `failed` request returns to `pending` with a new generation and a fresh failure budget; a request being processed is left alone. The record stores the Auth account creation time, so a UID that is later recreated needs IT review instead of being deleted automatically.
5. The backend returns `202 {"accepted": true}`. This acknowledges that the request is queued, not that the account is deleted. The browser then shows **Deletion requested**; dismissing it signs the passenger out. A failed or malformed response shows an error in the Profile tab and does not sign out.

### 3.2 Processing

The [worker](WORKER_LEADERSHIP.md) scans for due requests when it acquires the lease and every 60 s afterwards. There is no waiting period and no routine approval. There is also no guaranteed completion time: a backlog, contention or dependency failures delay processing, and requests stay queued while no worker runs.

- Each scan reads one page of 20 `pending` requests in document-ID order from the cursor in `_reconciliation_cursors/privacy-deletions`. A completed pass resets the cursor. Requests that are not yet due are skipped without blocking later IDs.
- One deletion runs at a time per process, with at most 20 waiting (one per UID) and a 2 s limit on undispatched queue age. If the queue is full, the scan keeps its cursor; the work remains durable for a later scan.
- An execution claims the request (`status: processing`, executor ID, new generation, `deadlineAt`) and has a 30 s monotonic budget. Every write checks the claim and the worker lease in the same transaction.
- Inside the fleet lock (`_fleet_reconciliation_locks/singleton`) the worker rechecks eligibility, then deletes the account's `messageRateLimits` documents in pages of 200. A full page ends the turn and requeues the request so other requests get a turn.
- When no rate-limit documents remain, the worker rechecks eligibility, sets `phase: auth_deletion_dispatched`, deletes `users/{uid}`, `feedbackCooldowns/{uid}` and `passenger_requests/{uid}`, deletes the Auth user (an already missing user counts as success) and finally deletes the queue record.

### 3.3 Retry and failure

| Outcome | Next state | Error code |
|---|---|---|
| Fleet lock held by another operation | `pending`, retried after 60 s, no failure counted | `FLEET_BUSY` |
| Account ineligible or its identity changed | `failed` immediately | `ACCOUNT_INELIGIBLE` |
| 30 s budget exceeded | `pending` with backoff, or `failed` on the fifth consecutive failure | `DEPENDENCY_DEADLINE` |
| Any other dependency failure | `pending` with backoff, or `failed` on the fifth consecutive failure | `DEPENDENCY_FAILURE` |

The backoff starts at 1 min, doubles per consecutive failure, adds up to 20 % jitter and is capped at 1 h. Scans skip `failed` requests. Logs omit UIDs, dependency payloads and stack traces; monitoring uses the fixed error codes.

### 3.4 Access after deletion

Once the profile is gone, a still-valid ID token cannot recreate account-owned state:

- Firestore rules allow a passenger to read ride chat and to create feedback only while `users/{uid}` exists.
- Passenger ride-status reads, boarding and chat messages on the backend read the profile and refuse when it is missing.
- `POST /api/users/bootstrap` returns 409 while a deletion request exists and 401 when the Auth account is deleted or disabled. It never recreates the profile or repairs claims in either case.

Operator and administrator access to ride history is unchanged.

## 4. Configuration

None of these values is configurable at run time.

| Item | Value | Source |
|---|---|---|
| Admission and admin control single flight | 8 fills, 16 waiters per fill, 3 s caller deadline | `backend/src/services/privacyDeletionRequests.ts:9` |
| Consecutive failures before `failed` | 5 | `backend/src/services/privacyDeletionRequests.ts:7` |
| Admin list page | 20 records | `backend/src/services/privacyDeletionRequests.ts:68` |
| Scan interval and page | 60 s, 20 requests | `backend/src/services/privacyDeletionWorker.ts:126`, `backend/src/services/privacyDeletionWorker.ts:95` |
| Execution queue | 1 active, 20 waiting, 2 s queue age | `backend/src/services/privacyDeletionWorker.ts:10` |
| Execution budget | 30 s | `backend/src/services/privacyDeletionWorker.ts:20` |
| Rate-limit deletion page | 200 documents | `backend/src/services/privacyDeletionWorker.ts:9` |
| Backoff | 1 min doubling, up to 20 % jitter, 1 h cap; 60 s when the lock is busy | `backend/src/services/privacyDeletionWorker.ts:80` |

## 5. Monitoring and recovery

All endpoints below require an administrator token.

1. List requests with `GET /api/v2/privacy-deletion-requests`, then follow `?cursor=<nextCursor>` until `nextCursor` is `null`. Each record shows `status`, `attempts`, `failures`, `generation`, `executorId`, `nextAttemptAt`, `deadlineAt`, `lastErrorCode`, `phase` and `recoveryRequired`.
   Expected result: `recoveryRequired` is `true` for every `failed` request and for every `processing` request whose deadline has passed.
2. For a `failed` request, diagnose the dependency or eligibility problem first. Then call `POST /api/v2/privacy-deletion-requests/{uid}/recovery` with `{"expectedExecutorId": "<executorId>", "expectedGeneration": <generation>}`.
   Expected result: `{"recovered": true}`. The request returns to `pending` with a new generation and failure budget; lifetime attempts, error history, the recovering administrator and the time are recorded. Eligibility is checked again when the worker runs it.
3. For an expired `processing` request, stop the exact executor process and confirm that it has terminated. If `phase` is `auth_deletion_dispatched`, the Auth deletion may or may not have been committed; audit the account and its records. Then call the recovery endpoint with the same fields plus `"executorStopped": true`.
   Expected result: `{"recovered": true}`. An unexpired claim, or an execution still running in this process, is refused with 409 even with the attestation. Expiry alone never authorizes a takeover.
4. If `GET /api/v2/fleet-reconciliation-jobs/lock` shows a `privacyRequestId`, recover that privacy request first (step 3), then release the stopped owner's lock with `POST /api/v2/fleet-reconciliation-jobs/lock/recovery` as described in [operation resources](../api/OPERATION_RESOURCES.md). Never clear a lock whose owner is still running.
5. If a recovery response is lost, list the request again before retrying. A changed generation makes a duplicate recovery fail with 409.

A 503 response with `Retry-After: 1` from any of these endpoints means the acknowledgement is unknown; read the current state before acting again.

Every fleet endpoint that changes Auth and the privacy worker share the fleet lock, which never expires, and eligibility is rechecked inside it before cleanup and before the Auth call. The lock cannot fence changes made outside this API: pause CLI role sync, Firebase console edits and account recreation for an account while its deletion runs. A dispatched Auth call cannot be recalled, and an authenticated write already in flight can still arrive after cleanup.

## 6. Verification

| Behaviour | Tests |
|---|---|
| Request validation, privileged refusal, status codes | `backend/src/routes/privacy.test.ts` |
| Queue fairness, backoff, failure budget, poison records, claim and lease fencing | `backend/src/services/privacyDeletionQueue.test.ts`, `backend/src/services/qaPrivacyResubmissionEdge.test.ts` |
| Cursor, retained records, rate-limit pages, an executor killed during Auth deletion | `backend/src/privacyDeletion.integration.test.ts`, run by `npm run test:rules` |
| Confirmation, acknowledgement and sign-out in the browser | `frontend/src/components/passenger/AccountTab.test.tsx` |

These tests use emulators and synthetic Auth. Deployed collection-group indexes, real Auth failure and revocation outcomes, process supervision, replica and console quiescence, backup erasure and institutional privacy approval need staging evidence and sign-off, tracked in the [university deployment checklist](UNIVERSITY_DEPLOYMENT_CHECKLIST.md).
