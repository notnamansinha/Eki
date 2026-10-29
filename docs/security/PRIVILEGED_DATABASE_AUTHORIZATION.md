# Privileged database authorization (issue #315)

Last updated: 2026-10-26 06:00 IST (UTC+05:30).

Privileged ID tokens carry `authorizationVersion`. Firestore and Realtime
Database compare it with backend-only `_userAuthorization/{uid}` records.
Missing records, blocked roles and old versions deny privileged reads. Versions
are fresh random UUIDs, so a demotion followed by promotion cannot revive an old
token, including changes within the same second. Ordinary authenticated public
projections and passenger chat membership retain their existing policy.

Admin HTTP middleware also requires the current version in both databases,
`role: "admin"` and the boolean `admin: true` claim. It performs fresh metadata
reads without a positive cache. This closes Firebase Auth's same-second
revocation boundary, where a saved token can still pass the provider's
`auth_time < validSince` check. Unavailable metadata returns a retryable 503;
stale or incomplete privilege returns 403. Finish the claims backfill before
directing admin traffic to this backend; unversioned legacy admin tokens fail
closed at HTTP admission as well as at the database rules.

Firestore and RTDB admin rules use the same claim contract: `role: "admin"`
and `admin: true` together, so a token carrying only the role claim is denied
in both databases. Firestore additionally checks the current `users/{uid}.role`. Driver session
and message access requires the current driver registry's `authUid`, the
assigned bus, and matching token/authorization assignment fields. Removing or
reassigning a registry record therefore immediately closes its operator reads.
The worst driver read consults four distinct documents (session, authorization,
profile, driver); repeated paths are cached within the rules evaluation.

## Writers and recovery

Fleet assignment, unassignment, demotion and reconciliation use
`publishUserAuthorization`; the operator CLI `sync-role-claims` uses the same
publisher for administrators and passengers. Profile bootstrap never grants
privileged authorization. Client writes to roles and authorization records are
denied.

All role/assignment publishers must hold the durable fleet mutex from their
canonical state reads until publication and assignment-mirror cleanup settle.
The CLI locks each bounded chunk, re-reads profiles after acquiring the lock,
and waits for every user even when a sibling read fails. Page snapshots supply
identities only; a role captured before a completed demotion must never be
published afterward. A busy lock fails the CLI; retry after the current writer
finishes. A stopped CLI leaves its lock for the existing stopped-executor
recovery procedure; never take it over while the process may still run.
Unassigned drivers receive a current driver authorization without assignment
claims; stale mirrors for their current and previous driver IDs are removed.
The CLI does the same before reporting a failure when a driver record points
at a missing bus, a bus without routes or a malformed bus ID, so earlier
`role: "admin"`/`admin: true` claims never survive a failed driver sync.

The publisher first writes a fresh blocked version to both databases, then
revokes refresh sessions before exposing the new version in Auth claims, then activates matching
records. All sibling work settles before an error reaches the fleet caller.
Conditional activation and rollback preserve newer concurrent versions. An
activation failure attempts to block both products and returns an error; old
tokens remain invalid because publication has already rotated both versions.
Driver deletion invalidates the principal before removing its registry record,
retaining the principal lookup if invalidation fails so deletion can be retried.

Firestore and RTDB have no shared transaction. A failure during initial
invalidation can leave one database on its previous version; the operation
fails and must be retried. Never treat a failed/unknown fleet operation as
completed. Inspect its operation record and both authorization records, stop
any prior executor as required by the fleet recovery workflow, then retry or
reconcile. A later metadata/profile/assignment change never makes an old token
current again. A rollback failure also remains a failed operation.

Admin role changes must run through the publisher: update the authoritative
user role and run the backend `sync-role-claims` command. Directly editing Auth
claims or only a Firestore profile does not publish the RTDB revocation state.
Any other backend Auth revocation path that targets privileged users must also
rotate this authorization state; a standalone Firebase revoke operation does
not automatically update database rules metadata.

## Coordinated rollout

1. Deploy the backend publisher and CLI first. Pause privileged role/assignment
   changes from older backend replicas before backfill and rule activation.
2. Backfill existing privileged users with `npm run sync-role-claims
   --workspace=backend` against the approved target. The command also repairs
   assignment mirrors and revokes existing sessions; require users to sign in
   again. Resolve every failed record before considering backfill complete.
3. Deploy both rulesets together. Do not restore claim-only rules to work around
   missing metadata; those records require repair. Resume fleet writes only
   after all writer replicas use the publisher.
4. In staging, save a token, demote/reassign/delete its principal through the
   supported workflow, and confirm that Firestore operator/admin reads and RTDB
   fleet-root reads fail using that same token. Repeat a role/assignment change,
   confirm the original token remains denied, and verify newly signed-in users
   and passenger public/chat reads. Exercise failed writes and retry/recovery;
   retain redacted outcomes separately from emulator evidence.

Local tests use synthetic identities and loopback emulators. They do not
certify live Firebase Auth revocation, provider configuration or deployment.
Firebase describes revocation-aware database checks in its
[session management documentation](https://firebase.google.com/docs/auth/admin/manage-sessions).
