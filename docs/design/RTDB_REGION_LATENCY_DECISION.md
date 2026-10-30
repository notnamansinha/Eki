# RTDB Region Latency Decision

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-ADR-002 | 1.0 | Proposed | 2026-10-30 |

## 1. Context

Decision date: 2026-09-10. Issue: [#169](https://github.com/notnamansinha/Eki/issues/169). This decision does not authorize creating or switching a production database.

At the decision baseline, `firebase database:instances:list --project bustrack-be165 --json` reported one active default instance, `bustrack-be165-default-rtdb`, in `us-central1` (Iowa) [1]. The Firebase CLI output contained no credentials. The repository deployed no managed backend: the bench and demo design ran Express on an Asia/Kolkata-configured workstation behind an HTTPS tunnel. At measurement time port 4000 was not listening and the configured public tunnel returned four 404 responses and one timeout, so no live production backend could be measured.

Passengers and trackers are in India. The default Firestore database is in `asia-south2` (Delhi), as recorded in the [non-motion inventory of 2026-10-11](../testing/LIVE_NON_MOTION_INVENTORY_2026_10_11.md). Every live write and listener therefore crosses to Iowa.

Each runtime has one RTDB client configured from an environment URL. `backend/src/lib/firebaseAdmin.ts` supplies all server reads and writes from `FIREBASE_DATABASE_URL`. `frontend/src/lib/firebaseCore.ts` configures the browser app from `NEXT_PUBLIC_FIREBASE_DATABASE_URL`, and `frontend/src/lib/firebaseDatabase.ts` creates the single browser RTDB client. No second application RTDB initialization exists. The backend refuses to start in production without its URL, and the strict production web build fails without its URL. `npm run verify:rtdb-instance` rejects mismatched instance hosts and, when `RTDB_EXPECTED_REGION` is set, an unexpected region, without printing either URL; both deploy jobs run it before release.

Firebase recommends storing RTDB data close to its users and services, offers Singapore as `asia-southeast1`, and does not allow changing the location of an existing instance [2].

## 2. Decision

Singapore (`asia-southeast1`) is the intended production location for RTDB. Create a separate nonproduction Singapore instance, and cut over only after it passes the gate in Section 2.1 and the migration in Section 2.2. Until then, keep the Iowa instance.

### 2.1 Cutover gate

Do not cut over until an approved nonproduction `asia-southeast1` instance passes all of these checks on the campus network, mobile data and the actual backend host at representative times:

1. Run at least 100 warm authenticated Admin reads in each region and record p50, p95 and p99.
2. Record browser RTDB callback-to-render timing and reconnect behaviour with authenticated users.
3. Rehearse one moving device at the one-second cadence and record `/api/health` processing, device-to-server, RTDB-write and route-processing p95 and p99, plus errors and HTTP 429 responses.
4. Require the Singapore median and p95 to improve by at least 30%, with no worse error or reconnect rate, no regression in ingestion throughput, and successful lifecycle, passenger and administrator acceptance.
5. Obtain approval from the university owner and for Firebase billing and region. If the gate fails, keep Iowa and archive the measurements.

### 2.2 Migration plan

1. Create a separately named Blaze-plan RTDB instance in `asia-southeast1` [3]. Add an explicit Firebase CLI database target; deploy the current default-deny rules and `.indexOn` entries to the candidate before importing data.
2. In staging, copy the complete root so that server-only state is not omitted: `_userAuthorization`, `driverRouteAssignments`, `_deviceRateLimits`, `_deviceCredentialVersions`, live projections and route geometry. Store exports only in an approved encrypted temporary location, hash them, restrict access, and delete them under the data-handling policy after validation [4].
3. Validate source and destination top-level keys and child counts; rules with the emulator and with authenticated and unauthenticated probes; administrator reads that depend on `_userAuthorization`; indexes, Admin health, lifecycle recovery, live markers, route geometry, messaging authorization and device credential invalidation.
4. Rehearse rollback. Then schedule a maintenance window: stop the backend and worker so there is one writer, wait for in-flight telemetry to drain, take a final export, import it, revalidate counts and hashes, and let trackers keep retrying through their bounded queue.
5. Set `FIREBASE_DATABASE_URL` and `NEXT_PUBLIC_FIREBASE_DATABASE_URL` to the exact candidate origin in the backend and frontend deployment environments, and set the GitHub environment variable `RTDB_EXPECTED_REGION=asia-southeast1`. Run `npm run verify:rtdb-instance` before either deployment. Build the frontend, verify that its static output contains the candidate host and not the old host, start the backend against the candidate, require `/health` readiness, then deploy Hosting and force-refresh the controlled clients.
6. Run the complete automated, rules and firmware gates and a physical route rehearsal. Confirm that telemetry, the lifecycle worker, administrator snapshots, the passenger listener, route geometry and assignment reconciliation all read and write only the candidate. Keep the old instance read-only for an approved observation period; do not delete it in the cutover change.

Rollback before any candidate writes is a configuration revert. After candidate writes begin, stop producers, export the candidate, import and validate that state back into Iowa, run the matching-instance check for `us-central1`, and only then revert the backend and Hosting. Never change the two URLs independently or write to both instances without a reviewed replication design.

## 3. Status

Proposed. Singapore was approved as the candidate on 2026-09-10. No Singapore instance has been cut over: `firebase.json` declares one default database, and no repository change targets a second instance. The decision becomes current when the gate in Section 2.1 passes and the migration in Section 2.2 completes.

## 4. Consequences

1. The live path stays transcontinental until cutover. Every tracker write, worker transaction and browser listener for `activeBuses` and its projections goes to Iowa.
2. Cutover needs a write stop, a complete copy of the RTDB root, a frontend rebuild (the URL is compiled into the static build) and a backend configuration change released together.
3. A region move cannot fix heartbeat cadence, device retries, RTDB transaction contention, route-processing backlog, stale marker selection or an unstable tunnel. Those remain separate measured controls (#159, #160, #165 to #174).

## 5. Alternatives considered

| Option | Assessment |
|---|---|
| Keep Iowa (`us-central1`) | No migration. Authenticated Admin reads from India measured 270.1 to 284.5 ms at the median (Section 6). Retained until the gate passes, and permanently if it fails |
| Singapore (`asia-southeast1`) | Interleaved front-door probes showed a 198.8 ms (67.8%) lower median than Iowa. Chosen as the candidate |
| Relocate the existing instance | Not possible: Firebase does not allow changing an existing instance's location [2] |

## 6. Evidence

All figures are warm sequential requests from the same India workstation on 2026-09-10. They are directional evidence, not a service-level objective.

| Probe | Samples | Average | p50 | p95 | Qualification |
|---|---:|---:|---:|---:|---|
| Firebase Admin `limitToFirst(1).get()` against the real Iowa `activeBuses` path, run A | 30 | 280.5 ms | 274.5 ms | 297.8 ms | Authenticated backend-to-RTDB read; values were not logged |
| Same authenticated probe, run B through the committed command | 30 | 318.0 ms | 284.5 ms | 472.9 ms | p99/max 860.6 ms, showing the need for multi-time sampling |
| Integrated `testing` candidate, run C through the committed command | 30 | 283.0 ms | 270.1 ms | 272.8 ms | Authenticated Admin read; p99/max 650.0 ms; no database values logged |
| HTTPS GET to the real Iowa instance | 30 | 314.4 ms | 284.8 ms | 680.1 ms | Returned 401 by design; measures user-vantage transport and front-door latency, not authenticated sync |
| Like-for-like nonexistent Iowa RTDB front door | 20 | 309.5 ms | 293.0 ms | 348.6 ms | 404 response, interleaved with Singapore probes |
| Like-for-like nonexistent Singapore RTDB front door | 20 | 142.6 ms | 94.2 ms | 275.5 ms | 404 response, interleaved with Iowa probes; one 781.9 ms outlier |

The Singapore front-door median was 198.8 ms (67.8%) below Iowa in the interleaved comparison. This justifies a real Singapore staging instance. It does not prove an improvement in database operations, authenticated listeners or real-drive p95.

Repeat the authenticated backend probe from the repository root:

```powershell
npm run measure:rtdb --workspace=backend
```

The command performs one warm-up read plus 30 bounded one-child reads of `activeBuses`, prints timing only, and accepts 10 to 500 samples through `RTDB_LATENCY_SAMPLES`.

## 7. References

[1] Google, "Firebase CLI reference," firebase.google.com/docs/cli#rtdb-commands. Accessed: 2026-10-30.

[2] Google, "Locations for Realtime Database," firebase.google.com/docs/database/locations. Accessed: 2026-10-30.

[3] Google, "Scale with Multiple Databases," firebase.google.com/docs/database/usage/sharding. Accessed: 2026-10-30.

[4] Google, "Automated Backups," firebase.google.com/docs/database/backups. Accessed: 2026-10-30.
