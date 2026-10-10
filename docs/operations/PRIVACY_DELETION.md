# Passenger deletion queue and recovery

Last updated: 2026-10-05 15:56 IST (UTC+05:30).

`POST /api/v2/privacy-deletion-requests` and the legacy passenger alias derive
UID from the verified token. Current Auth, profile role and driver membership
must exclude privileged accounts. A missing role claim alone does not deny a
passenger. Operator/admin accounts require the existing IT offboarding process.
A request returns `202 {accepted:true}`; this acknowledges registration,
including an existing failed request, and does not certify deletion.

## Admission and resubmission

Admission and admin controls each allow eight raw fills and sixteen waiters per
fill, with a three-second caller deadline. Timed-out dispatched calls retain
capacity until real settlement. Retry an uncertain admission with the same UID.
Creation is transactional. Resubmission preserves the original request time,
lifetime attempts and error history. A failed request returns to pending with a
fresh generation and failure budget; an active processing claim remains untouched.
Current Auth creation time is bound
to the target: a recreated UID requires IT review rather than deleting its new
account automatically.

## Bounded and fair processing

The leader scans one document-ID ordered page of twenty pending requests every
minute. `_reconciliation_cursors/privacy-deletions` stores a lease-fenced cursor;
restart resumes it, and a completed cycle resets it. Backoff records are skipped
without blocking later document IDs. Saturation retains the scan cursor.
One raw deletion executes and at most twenty wait, one per UID, with a two-second
undispatched queue age. Expired queued work remains durable for a future cycle.
No timeout frees an unsettled dependency's execution permit or fleet mutex.

Each execution claims an executor UUID/generation and has a thirty-second
monotonic dispatch budget. Ordinary progress/deletion transactions validate both
the claim and worker lease at commit. A turn handles at most two 200-session
manifest pages (indexed array and legacy dynamic field), and one 200-document
page each for feedback, message and rate-limit collection groups. A full page
schedules another fair turn; lifetime `attempts` count these turns. A successful
continuation resets consecutive `failures`, so a large history is not dead-lettered
merely because it needs more than five chunks. Manifest updates preserve other
passengers and remove both the array and legacy field.

Transient failures use exponential one-minute backoff with jitter, capped at one
hour. Five consecutive failed executions produce `failed`, which ordinary scans
exclude. Fleet mutex contention postpones work without consuming a failure.
Ineligible/currently privileged or changed-account identities fail immediately.
Error logs omit UIDs, dependency payloads and stack traces; admin monitoring uses
fixed error codes. Profiles/cooldowns/passenger requests and Auth are retired
only after bounded personal-data queries are drained. An already absent Auth
account is an idempotent success. Completed queue records are removed as before.
No retention period, privacy entitlement or product policy is changed here.

## Monitor and recover

1. As an administrator, use `GET /api/v2/privacy-deletion-requests`. Follow
   `nextCursor` until null; each page contains at most twenty whitelisted records.
   Inspect status, attempts/failures, executor/generation, due/deadline times,
   fixed error code and `cleaning`/`auth_deletion_dispatched` phase. The latter is
   conservative: Auth may or may not have received/committed the call.
2. For a `failed` request, diagnose the dependency or account-eligibility problem.
   Deliberate retry uses `POST /api/v2/privacy-deletion-requests/{uid}/recovery`
   with `expectedExecutorId` and `expectedGeneration`. This CAS begins a fresh
   bounded failure cycle, preserving lifetime attempts and error history and
   recording the recovering admin and time. Eligibility is checked again on work.
3. For an expired `processing` request, first stop and independently verify
   termination of its exact executor, then audit uncertain Auth/data effects.
   Recovery additionally requires `executorStopped:true`. An unexpired claim or
   any locally unsettled execution is refused, even with that attestation.
   Expiry alone never authorizes takeover.
4. If `GET /api/v2/fleet-reconciliation-jobs/lock` exposes `privacyRequestId`,
   recover that processing request first, then recover the exact stopped-owner
   lock using the existing fleet lock recovery endpoint. Lock release writes an
   atomic audit including linked privacy status. Never clear a running mutex.
5. Inspect durable status after an uncertain recovery acknowledgement. A changed
   generation rejects a duplicate recovery; passenger resubmission restarts only
   failed work. With no live process holding the mutex, normal queue turns resume.

All fleet API Auth-changing paths and privacy deletion share the same non-expiring
mutex. Eligibility is rechecked inside it before cleanup and Auth dispatch. CLI
role sync, console/other-system changes and account recreation must be quiesced
operationally during deletion: the mutex cannot fence actors outside this API.

## Evidence and acceptance limits

Regressions reproduce overwritten retry history, first-twenty poison starvation
and indefinite retries, and check current/claim-less eligibility, large-history
fairness, raw stalls, bounded capacity and late-generation fencing. Actual local
Firestore SDK tests exercise cursor mutation, manifests/collection groups,
1001-record chunking and a disposable executor killed during synthetic Auth.
No live Auth account, hardware, board firmware or production project is touched.

Suitable staging still must verify deployed collection-group indexes, actual
Auth failure/revocation outcomes, supervisor stop attestation, replica/console
quiescence and delayed authenticated writes. Already-dispatched external effects
cannot be recalled. Existing cached or in-flight authenticated writes can arrive
after cleanup; these software checks do not certify universal erasure under
arbitrary concurrent clients, backup erasure or institutional privacy sign-off.
Those remain issue #245 acceptance gates.
