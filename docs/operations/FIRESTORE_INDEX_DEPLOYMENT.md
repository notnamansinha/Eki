# Firestore Index Deployment

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-007 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This document describes how the Deploy workflow publishes Firestore indexes and blocks the Hosting and rules release until the queries that background workers depend on can run. It also gives the manual procedure for checking a project.

## 2. What is deployed

| Source | Content | Deployed by |
|---|---|---|
| `firestore.indexes.json` | Composite index on `ride_sessions` (`status`, `endTime`, both ascending); collection-group field overrides on `messages.senderId` and `messageRateLimits.userId` | `firebase deploy --only firestore:indexes --non-interactive` (Deploy, step 6) |
| `database.rules.json` | RTDB `.indexOn` for `activeBuses`: `routeId`, `busId`, `timestamp` | `firebase deploy --only database:rules` (Deploy, step 7) |

Firestore builds indexes as long-running operations that continue after the deploy command returns [1]. The readiness gate below waits for them.

## 3. Readiness gate

After the index deploy, both Deploy jobs run `node scripts/verify-firestore-indexes.mjs --project <project>` with a 32-minute step timeout. The script exchanges `FIREBASE_TOKEN` for an access token and sends seven read-only `runQuery` requests [2] to the project's default database. Each request selects only document names and returns at most one document.

| Probe | Collection | Query shape | Used by |
|---|---|---|---|
| Ride-session retention | `ride_sessions` | `status` in `completed`, `failed`, `interrupted`; `endTime` older than 180 days; ordered by `endTime`, then document ID | Retention sweep |
| Messages privacy deletion | `messages` (collection group) | `senderId` equals a synthetic ID | Privacy deletion |
| Message rate-limit privacy deletion | `messageRateLimits` (collection group) | `userId` equals a synthetic ID | Privacy deletion |
| Privacy pending queue | `_privacy_deletion_requests` | `status` equals `pending`, ordered by document ID | Privacy deletion queue |
| Abandoned ride reconciliation | `ride_sessions` | `status` in `pending`, `armed`, `active`, ordered by document ID | Abandoned-ride reconciler |
| Route preview recovery | `_route_geometry_previews` | `status` equals `processing`, ordered by document ID | Operation recovery |
| Fleet job recovery | `_fleet_reconciliation_jobs` | `status` equals `processing`, ordered by document ID | Operation recovery |

The last four probes rely on automatic single-field indexes, which the index file does not declare. The gate tests the deployed query shapes, so it also catches a project where automatic indexing was changed.

Gate behaviour:

- A `FAILED_PRECONDITION` response that mentions an index is retried every 10 s until 30 minutes have passed. Each request has its own 15 s timeout.
- Any other HTTP error, an authentication or permission failure, or a malformed response fails at once.
- A successful response must contain a valid RFC 3339 read time, or document names inside the selected project, the default database and the expected collection. Empty results are valid.
- The script never logs response bodies or document names, and it writes and deletes nothing. Each query in each pass is billed as a document read.

A failed gate stops the job before Hosting and rules are deployed. Index builds that were already submitted continue in Firebase.

The gate needs a token that can deploy indexes and run Firestore queries in the project. Emulator runs cannot show that deployed indexes are ready; `scripts/verify-firestore-indexes.test.mjs` covers the gate with simulated responses, including the order of steps in both Deploy jobs.

## 4. Check a project by hand

Prerequisites: a Firebase CLI token for the project in the current shell as `FIREBASE_TOKEN`, taken from the secret store and not typed into shared history.

1. From the repository root, run:

   ```powershell
   node scripts/verify-firestore-indexes.mjs --project <project-id>
   ```

   Expected: `Firestore retention, privacy and recovery queries ready for <project-id>.` While indexes build, the script prints `Waiting for Firestore indexes:` with the pending probe names.
2. If indexes are missing, deploy them, then repeat step 1:

   ```powershell
   npx --yes firebase-tools@15.14.0 deploy --project <project-id> --only firestore:indexes --non-interactive
   ```

   Expected: the CLI reports the indexes as deployed; step 1 then succeeds within 30 minutes for a small database.
3. Remove the token from the shell with `Remove-Item Env:FIREBASE_TOKEN`. Expected: `$env:FIREBASE_TOKEN` is empty.

## 5. Recovery

| Failure | Action |
|---|---|
| `Firestore index readiness timed out` | Open the Firestore indexes page in the Firebase console. If a build is still running, wait for it and rerun Deploy; the index file does not need to change. |
| `failed (HTTP 401)` or `(HTTP 403)` | The token cannot query Firestore in that project. Replace the environment's `FIREBASE_TOKEN` and rerun. |
| `Invalid Firestore readiness response` | The project or database name is wrong, or the API returned an unexpected body. Check `--project` and the project's default database. |
| `Missing --project.` or `A valid explicit --project is required.` | Pass `--project <project-id>` with a valid project ID. The usage text names `disable-appcheck-enforcement.mjs` because both scripts share the argument parser. |
| `FIREBASE_TOKEN is required to verify Firestore indexes.` | Set `FIREBASE_TOKEN` in the shell (Section 4) or in the environment's secrets. |

## 6. References

[1] Google, "Manage indexes in Cloud Firestore," firebase.google.com/docs/firestore/query-data/indexing. Accessed: 2026-10-30.

[2] Google, "Method: projects.databases.documents.runQuery," docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery. Accessed: 2026-10-30.
