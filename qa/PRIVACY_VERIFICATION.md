# Privacy, Deletion and Sub-Processor Verification

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-018 | 1.0 | Current | 2026-11-24 |

## 1. Purpose

These harnesses check what happens to a passenger's personal data, and which third parties a visitor's browser contacts, against what the code and the documentation claim ([issue #524](https://github.com/notnamansinha/Eki/issues/524)):

| Command | Level | What it checks |
|---|---|---|
| `npm run qa:privacy:deletion` | L2 | Deletes two synthetic passengers through the real backend, worker and Auth against disposable emulators, then checks every store in the inventory (Section 3), sweeps every Firestore document, RTDB node and Auth user for the synthetic values, scans the backend log and measures the request-to-completion time |
| `npm run qa:privacy:deletion:staging` | L4 | Read-only check of one dedicated staging test account after its deletion, tied to the serving Cloud Run revision. `-- --dry-run` writes the read plan only |
| `npm run qa:privacy:hosts` | L3 | Loads every public route of the built static export in Chromium without signing in, records every request host and blocks every host that is not loopback |
| `npm run qa:privacy:hosts:live` | L4 | The same page loads against `https://bustrack-be165.web.app`, with real network access |

Section 6 compares the notice with the code and holds the data owner's sign-off. Neither the harnesses nor this document give legal advice or legal approval.

## 2. Prerequisites

| Item | Deletion, local | Deletion, staging | Host check |
|---|---|---|---|
| Node and Java | Node 24, Java 21, as for [`npm run qa:api`](HTTP_AUTHORIZATION.md) | Node 24 | Node 24 and Chromium from `npx playwright install chromium` |
| Checkout | Locked dependencies and no `.env`, `backend/.env` or `e2e/emulator/.env` file | Clean: the runner refuses a dirty tree | `npm run build` first for the local target; restore `firebase.json` afterwards with `git checkout -- firebase.json` (the local server computes the inline-script hashes itself) |
| Ports | Emulators 8085, 9005, 9095, 4405, 4505, 9150; fixture 3116 and 3117 | None | `127.0.0.1:24524`, or `EKI_PRIVACY_HOSTS_PORT` |
| Identities | Synthetic, created by the run | A dedicated staging test account whose UID starts with `eki-qa-privacy-` (Section 4.4) | None: no sign-in |
| Credentials | None; the safety preflight rejects real ones | Application Default Credentials of an operator with read access to Auth, Firestore, RTDB and the Cloud Run service. Never a service-account key in the repository | None |
| Approval | None | The staging owner agrees the window | Live target: none beyond this procedure; it loads public pages only |

## 3. Personal-data inventory

[`scripts/qa/privacy-inventory.mjs`](../scripts/qa/privacy-inventory.mjs) lists every store that holds passenger personal data or is keyed by a passenger UID. It was derived from `backend/src`, `frontend/src`, `firestore.rules` and the [Firebase data model](../docs/data/FIREBASE_DATA_MODEL.md). [`scripts/qa-privacy.test.mjs`](../scripts/qa-privacy.test.mjs), part of `npm test`, keeps it current: it scans the non-test sources for every Firestore collection and RTDB root and fails when one is not classified, and it fails when the deletion worker's list of deleted stores ([`privacyDeletionWorker.ts`](../backend/src/services/privacyDeletionWorker.ts)) and the inventory disagree.

| Store | Path | Personal data | What deletion does | Finding |
|---|---|---|---|---|
| Auth | user `{uid}` | E-mail, display name, photo URL, providers, claims | Deleted | |
| Firestore | `users/{uid}` | uid, email, displayName, photoURL, role | Deleted | |
| Firestore | `feedbackCooldowns/{uid}` | userId, feedbackId, time | Deleted | |
| Firestore | `passenger_requests/{uid}` | passengerId, busId, lat, lng (legacy, no current writer) | Deleted | |
| Firestore | `ride_sessions/*/messageRateLimits/{uid}` | userId, send times | Deleted | |
| Firestore | `_privacy_deletion_requests/{uid}` | The UID (document ID), Auth creation time, request and error fields | Removed when deletion succeeds | PRIV-01 |
| Firestore | `feedbacks/*` | userId, userName, comment, rating, ride IDs | Retained by policy; 180-day retention | |
| Firestore | `ride_sessions/*` | `passengers.{uid}` (userId, userName, stops, join time), `passengerIds` | Retained by policy; 180 days after the ride ends | |
| Firestore | `ride_sessions/*/messages/*` | senderId, senderName, text | Retained by policy, with the ride | |
| Firestore | `ride_sessions/*/archivedMessages/*` | Copy of a cleared message | Retained by policy, with the ride | |
| Firestore and RTDB | `_userAuthorization/{uid}` | The UID (key), role, version | Not deleted: written for accounts that were once operators or administrators | PRIV-02 |
| Firestore | `_fleet_reconciliation_locks/singleton` | `privacyRequestId` while a deletion runs | Removed with the lock | |
| Firestore | `_reconciliation_cursors/privacy-deletions` | `cursor`: the last UID of a full page of 20 pending requests | Overwritten by the next scan | PRIV-03 |
| RTDB | `users/{uid}` (legacy) | Unknown legacy data; no current writer | Not deleted; retention removes it only when `LEGACY_RTDB_RETIRED=true` | PRIV-04 |

Operator and administrator UIDs also appear in `drivers.authUid`, `settings.updatedBy`, `feedbacks.reviewedBy`, `ride_sessions.interruptedBy` and the operation audit collections. Passenger deletion refuses operator and administrator accounts ([privacy deletion](../docs/operations/PRIVACY_DELETION.md#31-request)), so those fields are outside this inventory.

Stores outside the code:

- Backend logs in Cloud Logging. Section 4.1 scans the local equivalent; the deployed sink and its retention are not observable from the repository.
- Cloud Run and Hosting request logs, which record client IP addresses and request paths. An administrator recovery request, `POST /api/v2/privacy-deletion-requests/{uid}/recovery`, puts a UID in the path.
- Backups and exports: the [deployment checklist](../docs/operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md) item for scheduled backups or exports is open, so there is no backup erasure to observe yet.
- The browser: Firebase Auth state in IndexedDB, `sessionStorage` key `eki:location-notice`, and the service worker cache. Sign-out after the deletion request clears the Auth state.

### 3.1 Findings

| ID | Severity | Finding |
|---|---|---|
| PRIV-01 | Medium | No record of a completed deletion survives. The worker deletes `_privacy_deletion_requests/{uid}`, the only record of the request, and logs omit UIDs, so nothing shows afterwards that a deletion was requested or when it finished. A completion time cannot be evidenced on a deployed project after the fact |
| PRIV-02 | Low | `_userAuthorization/{uid}`, in Firestore and RTDB, survives the deletion of an account that was once an operator or administrator. It is keyed by the UID and holds the role and version. The [deletion procedure](../docs/operations/PRIVACY_DELETION.md) does not list it as retained |
| PRIV-03 | Low | The privacy scan cursor can hold the UID of a pending request until the next scan, also after that account is deleted |
| PRIV-04 | Unknown | The legacy RTDB `users` and `messages` trees are outside the deletion. Staging sets `LEGACY_RTDB_RETIRED=false`. Whether a deployed project still holds passenger data there is unverified |
| PRIV-05 | Medium | There is no completion-time commitment: the deletion procedure states that there is no guaranteed completion time. The worker scans every 60 s while an instance holds the lease, and staging scales to zero |
| PRIV-06 | Medium | There is no export or data-access path. No endpoint, screen or procedure gives a passenger a copy or summary of their data |
| PRIV-07 | High | No privacy notice is published. `UNIVERSITY_LINKS` in [`frontend/src/config/university.ts`](../frontend/src/config/university.ts) leaves the privacy notice and terms URLs empty, so both links are hidden, and no page states purposes, retention, a grievance contact, a lawful basis or sub-processors |
| PRIV-08 | Low | Many error handlers log the raw error object, for example [`users.ts:127`](../backend/src/routes/users.ts) and [`sessions.ts:68`](../backend/src/routes/sessions.ts). A Firestore error can quote a document path such as `users/{uid}` |

Severity is an engineering estimate. The findings are recorded here, not fixed.

## 4. Procedure

Run every command from the repository root.

### 4.1 Deletion, local

1. Run `npm run qa:privacy:deletion`. It builds the backend, starts the emulators through `firebase-tools@15.14.0 emulators:exec` with a 12 min deadline and reruns [`scripts/qa/run-privacy-deletion.mjs`](../scripts/qa/run-privacy-deletion.mjs) inside them. Expected: about 4 min, most of it the wait for the worker's 60 s scan, and `artifacts/qa/privacy-deletion-local-report.md` with `verdict: MATCHES_INVENTORY`.

Inside the emulators the runner:

1. Starts the browser acceptance fixture [`e2e/emulator/backend.mjs`](../e2e/emulator/backend.mjs): the compiled backend with its worker, on `127.0.0.1:3116`, with the loopback network guard. Its output goes to `artifacts/qa/privacy-deletion-local/backend.log`.
2. Creates two synthetic Auth accounts with distinctive values: a passenger, and a former operator that the real fleet endpoints assign to and then remove from an operator record.
3. Drives the passenger through the real endpoints: profile bootstrap, boarding with a synthetic location, a chat message, an administrator message clear (which archives it), and a second message. It writes one general feedback and its cooldown in the shape the browser writes ([`feedbackStore.ts`](../frontend/src/lib/feedbackStore.ts)), and a legacy `passenger_requests` record. `npm run qa:browser` covers the browser's own feedback write under the rules.
4. Reads every inventory entry for both accounts, then requests deletion with `POST /api/v2/privacy-deletion-requests` and polls once a second, for up to 180 s, until the request record and the Auth user are gone.
5. Sends `POST /api/users/bootstrap` with each pre-deletion ID token. Expected: 401, and no profile is recreated.
6. Reads every inventory entry again, then reads every Firestore document, every RTDB node two levels deep and every Auth user, and records each one that still holds a synthetic UID, e-mail, name, photo URL, coordinate, message or feedback text.
7. Stops the backend, scans its log for the same values and for any JWT or bearer value, then rewrites the log with those values replaced.

### 4.2 Hosts, local

1. Run `npm run build`, then `git checkout -- firebase.json`.
2. Run `npm run qa:privacy:hosts`. Expected: `artifacts/qa/privacy-hosts-local.md`. The runner serves `frontend/out` with the global headers of the committed `firebase.json` and the export's own inline-script hashes, loads each route in Section 5 at 1280 x 800 with service workers blocked, records every request host and aborts every request and WebSocket to a host other than loopback. Nothing leaves the machine.

### 4.3 Hosts, live

1. Run `npm run qa:privacy:hosts:live`. Expected: about 1 min, 7 page loads of `https://bustrack-be165.web.app`, and `artifacts/qa/privacy-hosts-live.md` with the `Last-Modified` and `ETag` headers of `/`, which identify the Hosting release. The runner does not sign in, type, click or submit anything. Requests that the pages make on their own, for example to Firebase, are recorded and allowed. Run it only against the public staging site.

To compare with a published notice, save its text to a file and add `-- --notice <file>` to either host command. The report records the file's SHA-256 and the vendors it declares.

### 4.4 Deletion, staging

Run from a clean checkout. PowerShell is shown. The staging owner first creates the dedicated test account with an Admin SDK UID that starts with `eki-qa-privacy-`, for example `eki-qa-privacy-01`, an e-mail address and password, and no operator or administrator claims. Firebase-generated UIDs are 28 alphanumeric characters without hyphens, so the runner can refuse a real passenger by the UID alone.

1. Read the serving revision: `gcloud run services describe eki-backend-staging --region asia-south2 --format="yaml(status.traffic)"`. Expected: one revision with `percent: 100`.
2. Sign in with `gcloud auth application-default login` as an operator with read access to Auth, Firestore, RTDB and the Cloud Run service.
3. In a private browser window, sign in to `https://bustrack-be165.web.app` as the test account, use the passenger features you want covered (board a ride, send a message, send feedback), then open **Profile**, select **Delete account** and confirm. Note the time of the confirmation with its offset.
4. Set `$env:EKI_PRIVACY_CONFIRM_PROJECT = "bustrack-be165"`, `$env:EKI_PRIVACY_EXPECTED_REVISION = "<revision from step 1>"`, `$env:EKI_PRIVACY_TEST_UID = "<test UID>"` and `$env:EKI_PRIVACY_REQUESTED_AT = "<time, for example 2026-11-24T15:10:00+05:30>"`. Optionally set `EKI_PRIVACY_WAIT_MINUTES` (default 15, at most 60).
5. Run `npm run qa:privacy:deletion:staging -- --dry-run`. Expected: `verdict: DRY_RUN`, nothing sent, and `artifacts/qa/privacy-deletion-staging/plan.json` listing every read. Review it.
6. Run `npm run qa:privacy:deletion:staging`. The runner reads the serving revision through the Cloud Run Admin API and stops unless it equals `EKI_PRIVACY_EXPECTED_REVISION`. It then repeats the read plan every 15 s until the request record and the Auth user are gone or the wait ends, and reads the revision again. Expected: `artifacts/qa/privacy-deletion-staging-report.md` with the per-store outcomes, counts of retained records and an upper bound of the completion time.
7. Run `Remove-Item Env:EKI_PRIVACY_*` and close the private window. Attach both report files to the tracking issue.

The runner refuses to start when the project confirmation is wrong, the revision is not an `eki-backend-staging` revision name, the UID lacks the test marker, the request time is missing, has no offset, or is not within the last 7 days, or any `*_EMULATOR_HOST` variable is set. Every read in the plan is one of `getUser`, `getDocument`, `getField`, `count`, `countArray`, `countGroup` or `getRtdb`; the executor refuses a plan with any other operation before it reads anything. The report holds booleans and counts, never document contents. `archivedMessages` is not read on staging because no collection-group index covers `senderId` there.

## 5. Evidence and verdicts

| File | Content |
|---|---|
| `artifacts/qa/privacy-deletion-<profile>-report.json`, `.md` | Commit and dirty flag, target, revision (staging), per-account store outcomes, sweep hits, log scan totals and line numbers, access checks, request-to-completion times, findings, verdict |
| `artifacts/qa/privacy-deletion-local/backend.log` | The fixture's output with synthetic values replaced by their category |
| `artifacts/qa/privacy-deletion-staging/plan.json` | Every staging read |
| `artifacts/qa/privacy-hosts-<target>.json`, `.md` | Routes with status and final path, each host with request count, methods, resource types and routes, the vendor map, the hosts the Content-Security-Policy permits, cookies after the run (names and domains only), notice status, verdict |

The host check loads `/`, `/install`, `/passenger`, `/admin`, `/feedback`, `/privacy` and `/terms`. The last two show whether such pages exist.

| Verdict | Harness | Exit code | Meaning |
|---|---|---|---|
| `MATCHES_INVENTORY` | Deletion | 0 | Every store behaved as the inventory states; recorded gaps reproduced |
| `UNEXPECTED` | Deletion | 1 | A store was not deleted, a retained store was deleted, a seeded store was missing before deletion, the sweep found a value outside the retained and residual stores, the log held a synthetic value or token, or an access check failed |
| `STALE_FINDING` | Deletion | 1 | A recorded gap no longer reproduces; update the inventory and close the finding |
| `NOT_COMPLETE` | Deletion, staging | 1 | The request record or the Auth user still existed when the wait ended |
| `REVISION_CHANGED` | Deletion, staging | 1 | Staging served another revision after the run |
| `DISCLOSED` | Hosts | 0 | Every observed vendor is declared in the supplied notice |
| `UNDECLARED_VENDORS` | Hosts | 1 | An observed host belongs to a vendor the notice does not declare |
| `UNMAPPED_HOSTS` | Hosts | 1 | An observed host, or a host the CSP permits, matches no entry in [`privacy-vendors.mjs`](../scripts/qa/privacy-vendors.mjs) |
| `NO_NOTICE` | Hosts | 1 | Nothing undeclared loaded, but there is no notice to compare with |
| `BLOCKED`, `DRY_RUN` | Both | 1, 0 | Setup failed (`setupError` names the step); plan written and nothing sent |

A declared vendor that never loads is a warning, not a failure: signed-in screens, such as the passenger map, load vendors that the public routes do not.

The first runs and their results are recorded in [privacy verification, 24 November](../docs/testing/PRIVACY_VERIFICATION_2026_11_24.md).

## 6. DPDP notice and code checklist

This checklist compares what a privacy notice would have to state with what the code does. On 2026-11-24 no notice is published (PRIV-07), so every notice cell reads "Not published". The code column is verified against the sources cited. Whether the code's behaviour satisfies the Digital Personal Data Protection Act, 2023 and its rules is a legal question for the data owner [1].

| Item | Notice | Code and configuration |
|---|---|---|
| Notice published and reachable | Not published: the Privacy notice and Terms of use links are hidden while their URLs are empty | `UNIVERSITY_LINKS` in `frontend/src/config/university.ts`; `/privacy` and `/terms` are not routes |
| Data collected | Not published | Section 3: Google account identity (e-mail, name, photo URL), ride manifest entries, chat messages, feedback, one location fix per first boarding |
| Purposes | Not published | Sign-in and profile; boarding a ride; ride chat; feedback; walking-time estimate on the map |
| Location | The map prompt says the location "stays on this device" and that tracking works without it; the boarding screen says boarding "shares your location once to check that you are at the stop" | The map computes the walking time in the browser (`PassengerMap.tsx`). First boarding sends `lat`, `lng` and `accuracy` to `PUT /api/v2/ride-sessions/{sessionId}/passengers/me`, which checks the distance to the bus and stores only the chosen stops (`sessions.ts`). Both statements match the code |
| Retention | Not published | Feedback, ride sessions with their manifests and messages, and completed trips: 180 days; operation logs: 90 days ([storage architecture](../docs/data/STORAGE_ARCHITECTURE.md#6-retention-and-deletion)); the periods await the data owner's approval |
| Account deletion | The confirmation says the profile and login account are deleted, and feedback, ride entries and messages are retained | Matches the worker, with PRIV-01 to PRIV-04 |
| Deletion timing | Not published | No commitment (PRIV-05) |
| Access and export | Not published | No path (PRIV-06) |
| Correction | Not published | Profile fields come from the Google account at first sign-in; there is no edit screen |
| Grievance and contact | Not published: the Help & contact link is hidden while its URL is empty | No contact in the app |
| Lawful basis or consent | Not published | The only consent prompt is the browser location prompt behind the map notice. Sign-in, boarding, chat and feedback have no notice or consent step |
| Sub-processors | Not published | Section 5 and the evidence record list the hosts; the CSP permits only Google services: Firebase Hosting, Authentication, Firestore and Realtime Database, Sign in with Google, Google Maps Platform, Google Fonts, Google static content and account photos, and the Cloud Run backend |
| Cookies and trackers | Not published | No analytics or advertising SDK in the source; the host checks record the cookies set |

### 6.1 Data owner sign-off

The data owner records here whether the findings in Section 3.1 and the gaps in this checklist are accepted, and for which staging revision. The engineering team cannot sign this section and does not give legal approval.

| Role | Name | Decision | Date | Revision |
|---|---|---|---|---|
| Data owner | Not signed | | | |
| Data protection officer | Not signed | | | |

## 7. Troubleshooting

| Symptom | Action |
|---|---|
| `Firestore Emulator has exited with code: 1` and `Unable to establish loopback connection` on Windows | Set `$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=<ASCII folder>"` and run again ([emulator acceptance](EMULATOR_ACCEPTANCE.md#6-troubleshooting)) |
| `Port 3116 is in use` or `Emulator port(s) already in use` | Another emulator or browser QA run is active; wait for it or stop the process the message names |
| `The backend fixture did not start` | Read `artifacts/qa/privacy-deletion-local/backend.log` |
| `A deletion did not finish within 180 s` | Read the backend log for `[Privacy]` lines and check that the worker took the lease |
| `frontend/out is missing` | Run `npm run build` first |
| A local Turbopack build fails with `Could not find the Next.js package` | `node_modules` is a link outside the checkout; Turbopack does not follow it. Build in a checkout with its own `node_modules` |

## 8. Limits

- The local run proves the code's behaviour against emulators, the compiled backend and synthetic Auth. It does not show deployed indexes, Cloud Logging, request logs, backups or the time a deployed worker takes.
- `qa:privacy:hosts:live` and `qa:privacy:deletion:staging` contact the public staging site and, for the second, the staging project. They are the exceptions to the [QA programme](README.md) rule that harnesses contact no real Google or Firebase service. Neither runs in CI.
- The host check sees only public routes without sign-in. The CSP list in the report is the upper bound of what a signed-in session can contact.
- Vendor declarations are matched by name in the notice text. A reviewer still reads the notice.
- No run gives legal approval (Section 6.1).

## 9. References

[1] Government of India, "The Digital Personal Data Protection Act, 2023," Act No. 22 of 2023. Accessed: 2026-11-24.
