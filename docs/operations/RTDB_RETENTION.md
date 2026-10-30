# RTDB Retention

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-022 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This document describes how the backend deletes old Realtime Database records: superseded reroute geometry under `activeRouteGeometry`, and, once retired, the legacy `users` and `messages` trees. It also gives the procedure for inventorying and applying the sweep by hand.

## 2. Scope

The RTDB sweep runs at the end of the daily retention sweep, after the Firestore categories. Firestore retention periods (ride sessions, feedback, completed trips and operation records) are defined in the [Firebase data model](../data/FIREBASE_DATA_MODEL.md). The sweep never deletes live bus state, assignments, credential versions, rate-limit windows, current Firestore profiles or ride ownership.

## 3. Behaviour

### 3.1 Schedule

When `RETENTION_SWEEPER_ENABLED` is `true`, the [worker leader](WORKER_LEADERSHIP.md) runs the retention sweep when it acquires leadership and every 24 h afterwards. In production (`NODE_ENV=production`) the backend refuses to start unless the variable is `true`; in development and tests the sweep is off by default. The sweep settles every Firestore category before the RTDB sweep starts, so one failing category neither skips RTDB cleanup nor stops the others. Failures are rethrown afterwards (several as an `AggregateError`) and logged.

### 3.2 Age and the observation window

A record is eligible when its newest known activity is more than 180 days old. Known times come from the fields `timestamp`, `createdAt`, `updatedAt`, `sentAt`, `endTime` and `completedAt`, in epoch milliseconds, epoch seconds or ISO 8601 strings; values before the year 2000 are ignored. A record exactly at the cutoff, or dated in the future, is kept.

A record without a usable time is not treated as old. The sweep records when it first saw the record's content and waits a full 180 days from then. Any change to the content restarts that window. A record nested deeper than 32 levels, or with more than 100,000 nodes, is skipped as malformed.

The first-seen times are kept in the server-only Firestore collection `_rtdb_retention_inventory`. Each document is keyed by the SHA-256 hash of the RTDB path and stores the path, a SHA-256 fingerprint of the content and `firstSeenAt`; it stores no copy of the content. Firestore transactions keep one window across replicas. Deletion is an RTDB transaction that removes the record only while its fingerprint is unchanged. A failure leaves the record and its inventory for the next sweep, and inventory for records that no longer exist is removed on later runs. The sweep reads RTDB in key pages of 25, outside telemetry requests.

### 3.3 Geometry

Each reroute publishes a new immutable geometry version under `activeRouteGeometry/{busId}_{routeId}/{version}` with a server `createdAt`. A version key that is an epoch time serves as a fallback age; a version with neither gets the 180-day observation window.

- The version referenced by the live record's `routeVersion` is always kept, even for an offline or completed ride.
- Any other version is deleted only when it is older than 180 days and has also been seen unreferenced for at least one day. The inventory distinguishes referenced and unreferenced observations, so a version that was current until shortly before a sweep starts a new one-day grace.
- The only publisher allocates a new version for every publication and refuses, inside its pointer transaction, to publish a version created more than one day earlier. An aged deletion candidate therefore cannot become a current pointer again. Client writes to this tree are denied by the database rules. A new writer, including an Admin SDK script, must follow the same contract.

### 3.4 Legacy trees

The current clients keep profiles and messages in Firestore. RTDB `users` and `messages` have no application readers and the client rules deny access. With `LEGACY_RTDB_RETIRED=true`, each top-level child of these trees is deleted only when the newest activity anywhere inside it is older than 180 days, so older entries in a recently active group are kept.

## 4. Configuration

| Item | Value | Source |
|---|---|---|
| Retention period | 180 days | `backend/src/services/rtdbRetention.ts:3` |
| Unreferenced geometry grace and publisher stall limit | 1 day | `backend/src/services/rtdbRetention.ts:5`, `backend/src/services/telemetryRouteService.ts:798` |
| Time fields | `timestamp`, `createdAt`, `updatedAt`, `sentAt`, `endTime`, `completedAt` | `backend/src/services/rtdbRetention.ts:7` |
| Nesting and size bound | 32 levels, 100,000 nodes | `backend/src/services/rtdbRetention.ts:44` |
| RTDB page size | 25 keys | `backend/src/services/firebaseRtdbRetention.ts:8` |
| Sweep interval | 24 h | `backend/src/services/retentionSweeper.ts:191` |
| `RETENTION_SWEEPER_ENABLED` | Must be `true` in production; off by default elsewhere | `backend/src/services/retentionSweeper.ts:80` |
| `LEGACY_RTDB_RETIRED` | `false` by default; only the exact value `true` enables legacy deletion | `backend/src/rtdbRetentionCli.ts:12`, `backend/src/services/retentionSweeper.ts:169` |

## 5. Procedures

### 5.1 Inventory with a dry run

Run from `backend/` with credentials for the target project:

```powershell
npm run retention:rtdb -- --dry-run
```

The command without arguments is also a dry run. It prints counts only (`scanned`, `candidates`, `currentGeometry`, `geometryGrace`, `quarantined`, `skippedMalformed`), never paths, messages, coordinates or account identities. A dry run reads the inventory but does not write it and deletes nothing.

Expected result: a JSON summary with `"dryRun": true` and `"deleted": 0`.

To include the legacy trees without enabling them for the deployment, set the variable for this process only:

```powershell
$env:LEGACY_RTDB_RETIRED = "true"; npm run retention:rtdb -- --dry-run; Remove-Item Env:LEGACY_RTDB_RETIRED
```

### 5.2 Retire the legacy trees

1. Confirm that no independently deployed older client or integration still reads RTDB `users` or `messages`.
2. Review a dry run that includes the legacy trees.
3. Set `LEGACY_RTDB_RETIRED=true` in the backend configuration. The setting declares the whole legacy trees retired; it does not expire individual messages of unknown schemas.

### 5.3 Apply once by hand

After reviewing the dry run, run `npm run retention:rtdb -- --apply` from `backend/`.

Expected result: a summary with `"dryRun": false`. `changedDuringDeletion` counts records that changed between the read and the delete and were therefore kept. A failure prints a message without database contents; check credentials and connectivity, then run again.

## 6. Verification

| Behaviour | Tests |
|---|---|
| Dry-run immutability, opt-in legacy deletion, cutoff, seconds, ISO and future times, undated quarantine, changed records, current pointers, geometry grace, conditional delete races, nesting bound, stalled publishers | `backend/src/services/rtdbRetention.test.ts` |
| Inventory store, paging and orphan cleanup | `backend/src/services/firebaseRtdbRetention.test.ts` |
| Command-line arguments | `backend/src/rtdbRetentionCli.test.ts` |
| Category isolation and RTDB sweep ordering | `backend/src/services/retentionSweepExecution.test.ts` |

A read-only inventory on 2026-10-03 found eight legacy records, none eligible and none undated, and no geometry records.
