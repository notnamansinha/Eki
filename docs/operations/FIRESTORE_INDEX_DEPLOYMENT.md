# Firestore index deployment (issue #246 R11)

Both jobs in `.github/workflows/deploy.yml` deploy the committed
`firestore.indexes.json` with `--only firestore:indexes --non-interactive`
to their explicit project before releasing hosting or rules. Existing branch,
exact-SHA and protected-environment gates still apply. Project provisioning and
the existing staging/production target policy are unchanged.

Index creation is asynchronous. `scripts/verify-firestore-indexes.mjs` then
runs three read-only REST queries against the target's default database:

- Ride retention: terminal status IN completed/failed/interrupted, endTime
  older than 180 days, ordered by endTime and document ID.
- Privacy deletion: collection-group messages filtered by senderId.
- Privacy deletion: collection-group messageRateLimits filtered by userId.

Each probe selects only document names and returns at most one record. Privacy
probes use a synthetic identifier. No writes/deletions occur, and returned
records and provider error bodies are not logged. These are billed reads;
the gate does not run a retention sweep or deletion worker.

The checker retries index-related FAILED_PRECONDITION responses every ten
seconds for up to thirty minutes, with a fifteen-second per-request timeout.
Authentication, authorization, other API errors and malformed responses fail
closed immediately. A failed gate stops the subsequent hosting/rules release;
already submitted index builds continue. Inspect Firebase index build status
and rerun the deployment after resolving the failure. Large builds may require
more than thirty minutes; rerunning does not require changing the index spec.

Successful responses must contain valid RFC3339 read times or projected document
names in the exact selected project, default database and expected collection
scope. Empty-query read-time-only responses are valid; empty/malformed document
objects, impossible dates and wrong-project/collection names are rejected even
when another field appears valid. JSON parse errors are replaced with a safe
query label so malformed provider bodies cannot leak into deployment logs.

The gate reuses the workflow's FIREBASE_TOKEN exchange and requires permission
to query Firestore in addition to the CLI's index deployment permissions.
To verify an explicitly chosen target without deploying:

```sh
node scripts/verify-firestore-indexes.mjs --project <project-id>
```

Local regression tests use simulated REST responses to cover missing/building
indexes, eventual readiness, deadline exhaustion, authorization failures and
both workflow jobs' ordering. Emulator success cannot establish deployed index
readiness. Fresh-project acceptance is recorded only when the real deployment
gate succeeds; no live deploy is part of this change's local verification.

References: [Firebase index management](https://firebase.google.com/docs/firestore/query-data/indexing)
and [Firestore runQuery API](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery).
