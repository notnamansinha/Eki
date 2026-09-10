# RTDB region latency decision

Status: **Singapore candidate approved; production cutover requires the staged gate below.**  
Decision date: 2026-09-10. Scope: issue #169; this decision does not authorize creating or switching a production database.

## Verified current state

`firebase database:instances:list --project bustrack-be165 --json` reported one active default instance, `bustrack-be165-default-rtdb`, in `us-central1` (Iowa). The Firebase CLI output contained no credentials. The repository does not deploy a managed backend region: its current bench/demo design runs Express on this Asia/Kolkata-configured workstation behind an HTTPS tunnel. At measurement time port 4000 was not listening and the configured public tunnel returned four 404 responses and one timeout, so it cannot be represented as a live production backend measurement.

Every runtime uses one singleton configured from an environment URL: `backend/src/lib/firebaseAdmin.ts` supplies all server reads/writes, and `frontend/src/lib/firebaseCore.ts` supplies all browser listeners. A repository search found no second application RTDB initialization. Production already fails closed when either deployment URL is absent. `npm run verify:rtdb-instance` now additionally rejects mismatched instance hosts and unexpected regions without printing either URL.

## Measurements

All figures below are warm sequential requests from the same India workstation on 2026-09-10. They are directional evidence, not a universal service-level objective.

| Probe | Samples | Average | p50 | p95 | Qualification |
|---|---:|---:|---:|---:|---|
| Firebase Admin `limitToFirst(1).get()` against the real Iowa `activeBuses` path, run A | 30 | 280.5 ms | 274.5 ms | 297.8 ms | Authenticated backend-to-RTDB read; values were not logged |
| Same authenticated probe, run B through the committed command | 30 | 318.0 ms | 284.5 ms | 472.9 ms | p99/max 860.6 ms, showing the need for multi-time sampling |
| Integrated `testing` candidate, run C through the committed command | 30 | 283.0 ms | 270.1 ms | 272.8 ms | Authenticated Admin read; p99/max 650.0 ms; no database values logged |
| HTTPS GET to the real Iowa instance | 30 | 314.4 ms | 284.8 ms | 680.1 ms | Returned 401 by design; measures user-vantage transport/front-door latency, not authenticated sync |
| Like-for-like nonexistent Iowa RTDB front door | 20 | 309.5 ms | 293.0 ms | 348.6 ms | 404 response, interleaved with Singapore probes |
| Like-for-like nonexistent Singapore RTDB front door | 20 | 142.6 ms | 94.2 ms | 275.5 ms | 404 response, interleaved with Iowa probes; one 781.9 ms outlier |

The Singapore front-door median was 198.8 ms (67.8%) below Iowa in the interleaved comparison. Firebase officially recommends locating RTDB near its users/services, exposes Singapore as `asia-southeast1`, and does not allow changing an existing instance's location. This evidence justifies a real Singapore staging instance and makes Singapore the intended production target. It does **not** yet prove database-operation, authenticated listener, or real-drive p95 improvement.

Repeat the authenticated backend probe with `npm run measure:rtdb --workspace=backend`; it performs one warm-up plus 30 bounded one-child reads by default, prints timing only, and accepts 10–500 samples through `RTDB_LATENCY_SAMPLES`.

## Cutover gate

Do not cut over until an approved nonproduction `asia-southeast1` instance passes all of these checks on the campus network, mobile data, and the actual backend host at representative times:

1. Run at least 100 warm authenticated Admin reads in each region and record p50/p95/p99.
2. Record browser `onValue` server-receive-to-render timing and reconnect behavior with authenticated App Check-enabled users.
3. Rehearse one moving device at the one-second cadence and record `/api/health` processing, device-to-server, RTDB-write and route-processing p95/p99 plus errors/429s.
4. Require Singapore median and p95 to improve by at least 30% with no worse error/reconnect rate, no regression in ingestion throughput, and successful lifecycle/passenger/admin acceptance.
5. Obtain the university owner and Firebase billing/region approval. If the gate misses, retain Iowa and archive the measurements.

## Migration plan (not executed)

1. Create a separately named Blaze-plan RTDB instance in `asia-southeast1`. Add an explicit Firebase CLI database target; deploy the current default-deny rules and `.indexOn` entries to the candidate before importing data.
2. In staging, copy the complete root so server-only `driverRouteAssignments`, rate-limit/credential-version state, live projections, and route geometry are not omitted. Store exports only in an approved encrypted temporary location, hash them, restrict access, and delete them under the data-handling policy after validation.
3. Validate source/destination top-level keys and child counts, rules with the emulator and authenticated/unauthenticated probes, App Check enforcement, indexes, Admin health, lifecycle recovery, live markers, route geometry, messaging authorization and device credential invalidation.
4. Rehearse rollback. Then schedule a maintenance window: stop the backend/worker so there is one writer, wait for in-flight telemetry to drain, take a final export, import it, revalidate counts/hashes, and keep devices retrying through their bounded queue.
5. Set `FIREBASE_DATABASE_URL` and `NEXT_PUBLIC_FIREBASE_DATABASE_URL` to the exact candidate origin in the backend and frontend deployment environments. Before either deployment, run with `RTDB_EXPECTED_REGION=asia-southeast1` and `npm run verify:rtdb-instance`. Build the frontend, verify its static output contains the candidate host and not the old host, start the backend against the candidate, require `/health` readiness, then deploy Hosting and force-refresh the controlled demo clients.
6. Run the complete automated/rules/firmware gates and a physical route rehearsal. Confirm telemetry, lifecycle worker, admin snapshots, passenger singleton listener, route geometry and assignment reconciliation all mutate/read only the candidate. Retain the old instance read-only for an approved observation period; do not delete it in the cutover change.

Rollback before any candidate writes is a configuration revert. After candidate writes begin, stop producers, export the candidate, import/validate that state back into Iowa, run the matching-instance preflight for `us-central1`, and only then revert backend/Hosting. Never flip URLs independently or write to both instances without an explicitly reviewed replication design.

## Non-goals

A region move cannot fix heartbeat cadence, device retries, RTDB transaction contention, route-processing backlog, stale marker selection, or an unstable tunnel. Those remain separate measured controls (#159, #160, #165–#174).

## References

- [Firebase RTDB locations](https://firebase.google.com/docs/database/locations)
- [Firebase CLI RTDB instance and data commands](https://firebase.google.com/docs/cli#rtdb-commands)
- [Manage multiple RTDB instances and per-instance rules](https://firebase.google.com/docs/database/usage/sharding)
- [RTDB JSON export/import and backups](https://firebase.google.com/docs/database/backups)
