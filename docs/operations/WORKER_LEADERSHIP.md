# Worker leadership and fencing

Last updated: 2026-10-27 03:40 IST (UTC+05:30).

The coordinator owns `_worker_leases/trip-state-worker`. The lease lasts 45
seconds and renews every 15 seconds. `WORKER_INSTANCE_ID` is a diagnostic label;
every process appends a random UUID, so duplicate labels do not grant shared
ownership. Acquisitions increment a persistent `generation`. Orderly release
expires the record without deleting the generation. Do not delete this record
or reset its generation while workers or their requests can still exist.

Each acquisition has a revocable context retained by asynchronous tasks and
explicitly bound to RTDB listeners. A timer independent of the renewal promise
revokes leadership. Admission also checks `performance.now()`, so a suspended
event loop cannot admit work before the overdue timer runs. Slow or late lease
responses cannot activate or revive a revoked acquisition. There is at most one
unsettled renewal and one coordinator fleet reconciliation per process.
Work queues shared by fenced and unfenced callers (for example durable ride
restores, used by both device ingest and the trip engine) start each queued item
in its requester's captured context and deduplicate in-flight work only within
the same worker generation. A revoked leader's queued restore rejects without
writing, and device ingest never inherits a leader's fence.

## Clock and admission contract

Runtime wall clocks must remain within 2 seconds of the reference clock. Monitor
time synchronization and remove unsynchronized replicas from worker service.
Local authority ends no later than 41 seconds after the renewal attempt starts
(45 seconds minus twice the skew allowance), and earlier if the wall-clock
expiry leaves less time. Another owner waits until the recorded expiry plus 2
seconds. Firestore transaction callbacks use a fresh wall time on each retry.
Changing the wall clock backwards cannot extend the local monotonic deadline.
Arbitrary clock errors beyond this allowance are an infrastructure failure, not
a guarantee supplied by a client-clock lease.

On revocation the coordinator stops listeners/timers before awaiting cleanup.
Shutdown does not await an unsettled renewal; a dispatched lease write may still
settle, but its response cannot start workers. Its lease expires naturally.

## Destination enforcement

- Worker Firestore lifecycle transactions and deletion batches read the exact
  lease in the same transaction as their writes. Owner, generation, local
  deadline and wall-clock expiry (with skew margin) are checked before work and
  after the callback. A concurrent takeover changes the transaction's read set;
  Firebase must serialize the earlier commit before takeover or retry/abort it.
  This adds one lease read to each worker write transaction.
- Worker RTDB lifecycle/retention transactions check local authority on dispatch
  and on every SDK callback retry. Surviving object projections carry internal
  `_workerGeneration`; a lower generation cannot overwrite a newer projection.
  Existing session, timestamp and unchanged-value predicates remain mandatory.
  Stale-presence cleanup now conditionally checks the timestamp instead of
  unconditionally updating/removing a snapshot read earlier.
- Auth and recursive-delete APIs have no destination fencing primitive. Check
  local authority immediately before each dispatch. Dispatched calls retain
  uncertain outcomes and can finish after revocation. Fleet Auth reconciliation
  retains its durable singleton lock until all dispatched calls settle; lease
  expiry never authorizes lock takeover or blind replay. Durable deletion jobs
  survive an interrupted cleanup and are removed only under a valid lease.
- HTTP/admin/device operations outside the leader context keep their existing
  semantics. They must still enforce their own assignment, ordering and durable
  operation contracts. Worker expiry is not an HTTP dependency timeout.

Firestore and RTDB cannot atomically share a lease. RTDB generation checks apply
only once a newer generation has reached that destination; deleting a record
also deletes its generation. Already dispatched requests cannot be recalled.
These limits must remain visible in acceptance evidence. R07 addresses durable
executor and stranded-lock recovery; R09/R10 address queue traversal/retries.

## Verification and deployment acceptance

The baseline regressions reproduce an indefinitely active worker during a hung
renewal and late activation after expiry. Coordinator/fence tests cover cutoff,
late replies, timely renewal, backward clock changes, skew allowance, unique
process ownership, preserved generations, callback context and RTDB retries.
`npm run test:rules` also runs the actual Firebase emulator worker suite:
valid/superseded Firestore writes, expiry after a destination read, and RTDB
generation rejection. It requires both emulators and never targets external
Firebase. CI runs it on Linux along with the authorization rules suite.

Exact-head CI and merged source evidence belong to issue #246. Issue #245 still
requires staged replica failover/clock monitoring and observed ride recovery;
these software tests do not establish live deployment or moving-route acceptance.
