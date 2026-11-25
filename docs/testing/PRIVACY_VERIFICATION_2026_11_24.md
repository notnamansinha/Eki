# Privacy Verification: 24 November 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-066 | 1.0 | Historical | 2026-11-25 |

First runs of the [privacy verification](../../qa/PRIVACY_VERIFICATION.md) harnesses for [issue #524](https://github.com/notnamansinha/Eki/issues/524). Passenger account deletion ran end to end against disposable emulators; the public-page host check ran against the local static export and, once, against the live staging site `https://bustrack-be165.web.app`. The staging deletion check and the data owner's sign-off were not done; Section 7 lists why. Times are UTC; every run fell on 24 November in India Standard Time (UTC+05:30).

## 1. Setup

| Item | Value |
|---|---|
| Checkout | Git worktree of branch `feat/524-privacy-verification`, without `.env` files |
| Host | Windows 11 Home 10.0.26200 |
| Node | v26.13.1 (CI uses Node 24) |
| Java | 27.0.1.1, with `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Users\Public\eki-jtmp` |
| Firebase CLI | 15.14.0; `firebase-admin` 14.5.0 |
| Playwright | 1.64.1, Chromium 156.0.8078.4 |
| Harness | Commit `5975890` (`feat(qa): verify passenger deletion, log redaction and sub-processor hosts`), on `a35e6d6` |
| Commands | `npm run qa:privacy:deletion`, `npm run qa:privacy:hosts`, `npm run qa:privacy:hosts:live` |
| Static export | `npm run build` at `a35e6d6`, with no `NEXT_PUBLIC_*` values. `node_modules` in this worktree is a directory junction outside the checkout, which Turbopack refuses to follow, so the build ran with a temporary `turbopack.root` in `frontend/next.config.ts`; that file and `firebase.json` were restored before every run |

## 2. Deletion runs

`npm run qa:privacy:deletion`, each time from a clean tree at harness commit `5975890`, holding the shared emulator lock. Each run took 3 to 4 min from the backend build to the report; about 50 s of it is the wait for the worker's next 60 s scan.

| Run | Dirty | Inside the emulators (UTC) | Passenger: request to completion | Former operator: request to completion | Verdict |
|---|---|---|---|---|---|
| D1 | false | 2026-11-23 21:42:34 to 21:43:55 | 49.6 s | 49.3 s | `MATCHES_INVENTORY` |
| D2 | false | 2026-11-23 21:48:03 to 21:49:24 | 49.8 s | 49.5 s | `MATCHES_INVENTORY` |

Both runs gave the same outcome for every store:

| Store | Passenger | Former operator |
|---|---|---|
| Auth user, `users/{uid}`, `_privacy_deletion_requests/{uid}` | Deleted | Deleted |
| `feedbackCooldowns/{uid}`, `passenger_requests/{uid}`, `ride_sessions/*/messageRateLimits/{uid}` | Deleted | Not seeded; absent |
| `feedbacks/*`, the `ride_sessions/*` manifest entry, `messages`, `archivedMessages` | Retained | Not seeded; absent |
| `_userAuthorization/{uid}` in Firestore and RTDB | Never written | **Retained (PRIV-02)** |
| `_fleet_reconciliation_locks/singleton`, `_reconciliation_cursors/privacy-deletions` | No UID | No UID |
| RTDB `users/{uid}` | Absent | Absent |

Every seeded store was present before the request. The queue record went from `pending` to removed between one-second polls; `processing` was not observed.

After deletion the sweep read 23 Firestore documents, 12 RTDB nodes and 3 Auth users. Six held a synthetic value, all in stores the inventory allows: the feedback document (UID, name, comment), the `qa_session` manifest (UID, name), one message and one archived message (UID, name, text) and both `_userAuthorization` records (the UID as key). No Auth user, profile, cooldown, rate-limit, request or lock record held one.

The pre-deletion ID token of each account got 401 from `POST /api/users/bootstrap`, and no profile was recreated.

The backend log had 22 lines in each run and no synthetic UID, e-mail, name, photo URL, coordinate, message, feedback text, JWT or bearer value. The backend writes no line per request, so these lines are start-up, worker, reconciliation and shutdown output.

A first run before the harness was committed (dirty tree) gave the same outcomes, but its inner process did not exit after writing the report, because the Admin SDK kept its connections open. `5975890` ends the process explicitly; D1 and D2 exited on their own.

## 3. Negative control

To show that the verifier detects a missed store and a leaking log, run N1 used `5975890` with one uncommitted change to `backend/src/services/privacyDeletionWorker.ts`: the worker no longer deleted `passenger_requests/{uid}`, and it logged `[Privacy] negative control: deleting <uid>` before the Auth call. The change was reverted and the backend rebuilt afterwards.

| Run | Dirty | Inside the emulators (UTC) | Verdict | Problems reported |
|---|---|---|---|---|
| N1 | true | 2026-11-23 21:50:17 to 21:51:41 | `UNEXPECTED`, exit 1 | `passenger: passengerRequest NOT_DELETED`; `sweep: firestore passenger_requests/<uid> holds coordinates, uid`; `log: 2 uid value(s)` (lines 19 and 20) |

The redacted log of N1 shows the two lines as `deleting <uid>`.

## 4. Public-page hosts

Both targets loaded `/`, `/install`, `/passenger`, `/admin`, `/feedback`, `/privacy` and `/terms` once each at 1280 x 800, without signing in, typing or clicking.

| Run | Target | Harness commit | Dirty | Started (UTC) | Requests | Hosts other than the origin | Cookies | Verdict |
|---|---|---|---|---|---|---|---|---|
| H1 | Local export, `127.0.0.1:24524` | `5975890` | false | 2026-11-23 19:44:13 | 126 | None | None | `NO_NOTICE` |
| H2 | Local export | `5975890` | false | 2026-11-23 19:45:28 | 126 | None | None | `NO_NOTICE` |
| L1 | `https://bustrack-be165.web.app` | `5975890` | false | 2026-11-23 19:46:57 | 180 | None | None | `UNDECLARED_VENDORS` |

On both targets `/`, `/install` and the three sign-in routes answered 200; `/passenger`, `/admin` and `/feedback` sent a visitor without a session to `/`. `/privacy` and `/terms` answered 404: neither page exists. The only host contacted was the origin, with GET and HEAD requests for documents, scripts, styles, fonts, images and fetches. No page called Firebase Authentication, Firestore, the Realtime Database, the backend, Google Maps or Google sign-in before sign-in, and no cookie was set.

L1 fails because the origin itself is Firebase Hosting, a Google service that no notice declares. The local runs pass the vendor check but return `NO_NOTICE`, because there is no notice to compare with (PRIV-07).

The live origin served the Hosting release with `Last-Modified: Fri, 20 Nov 2026 11:59:57 GMT`, read with one extra HEAD request after L1. That time falls inside Deploy run 44731924203 (11:58:33 to 12:00:21 UTC), which built `6c47e72`, the parent of `a35e6d6`; `a35e6d6` changes only dependencies.

The live Content-Security-Policy, which bounds what a signed-in session can contact, permits these hosts:

| Host | Directives | Vendor |
|---|---|---|
| `apis.google.com`, `accounts.google.com` | script, connect; frame | Sign in with Google |
| `*.firebaseapp.com` | connect, frame | Firebase Hosting and Auth helper |
| `*.firebaseio.com`, `*.firebasedatabase.app`, `bustrack-be165-asia-rtdb.asia-southeast1.firebasedatabase.app/.lp` | script (`/.lp` only), connect, frame | Firebase Realtime Database |
| `*.googleapis.com` | connect, img | Firebase Authentication, Firestore, Google Maps and other Google APIs |
| `maps.googleapis.com`, `*.ggpht.com` | script; connect, img | Google Maps Platform |
| `www.gstatic.com`, `*.gstatic.com` | script; connect, img | Google static content |
| `*.googleusercontent.com` | img | Google account photos |
| `fonts.googleapis.com`, `fonts.gstatic.com` | style; font | Google Fonts |
| `eki-backend-staging-449313371438.asia-south2.run.app` | connect | Cloud Run (Eki backend) |

Every permitted host maps to a Google service in [`privacy-vendors.mjs`](../../scripts/qa/privacy-vendors.mjs); none is an analytics, advertising or other third-party vendor. The local export's policy is the committed one, without the backend origin and RTDB instance that the deployed build adds.

## 5. Findings

The [runbook](../../qa/PRIVACY_VERIFICATION.md#31-findings) describes each finding. This table records what supports each one on this date.

| ID | Severity | Evidence |
|---|---|---|
| PRIV-01 No record of a completed deletion | Medium | Runs D1 and D2: `_privacy_deletion_requests/{uid}` removed, and the sweep found no other record of either request |
| PRIV-02 `_userAuthorization/{uid}` survives for former operators | Low | Runs D1 and D2: both copies kept for the former operator, with the UID as the key |
| PRIV-03 The scan cursor can name a pending UID | Low | Code only (the scan checkpoint write in `privacyDeletionWorker.ts`): a run with fewer than 20 pending requests leaves the cursor `null`, as D1 and D2 did |
| PRIV-04 Legacy RTDB trees outside the deletion | Unknown | Code only: no current writer, so the local runs cannot hold such data; staging was not read |
| PRIV-05 No completion-time commitment | Medium | `PRIVACY_DELETION.md` Section 3.2; local completion times in Section 2 |
| PRIV-06 No export or data-access path | Medium | None of the 72 operations in `backend/openapi.json` returns a passenger's own data as an export, and no screen or procedure does |
| PRIV-07 No privacy notice | High | `UNIVERSITY_LINKS` URLs are empty; `/privacy` and `/terms` answered 404 locally and on the live site |
| PRIV-08 Raw error objects in logs | Low | Code only; the local runs logged no error |

## 6. Notice and code checklist

The checklist in the [runbook](../../qa/PRIVACY_VERIFICATION.md#6-dpdp-notice-and-code-checklist) was completed against `a35e6d6`. Every notice cell is "Not published". The two statements the app does make about personal data match the code: the map's location prompt (the walking time is computed in the browser) and the boarding screen (one fix is sent and only the chosen stops are stored), and the deletion confirmation matches the worker apart from PRIV-01 to PRIV-04. The data owner sign-off in its Section 6.1 is unsigned. This record is not legal approval.

## 7. Not done

| Check | Why | How to run it |
|---|---|---|
| Deletion on staging | Needs a dedicated test account with an `eki-qa-privacy-` UID, an operator's read-only credentials and a window agreed with the staging owner. No traffic was sent to the staging backend or any Firebase or Google Cloud API | [Runbook Section 4.4](../../qa/PRIVACY_VERIFICATION.md#44-deletion-staging) |
| Cloud Logging, request logs and backups | The deployed sinks and their retention are not observable from the repository; the checklist item for scheduled backups is open | Read the log buckets and their retention in the staging project after a staging deletion, and search them for the test UID |
| Export and data-access fulfilment | No path exists (PRIV-06) | A product decision, then a harness |
| Notice, lawful basis and grievance contact | No notice is published (PRIV-07); legal review is the data owner's | Publish the notice, rerun `npm run qa:privacy:hosts:live -- --notice <file>`, then complete the runbook's Section 6.1 |

Only the staging guards were exercised, with synthetic values. `-- --dry-run`, with the loopback network guard preloaded, wrote a plan of 14 reads (`getUser`, `getDocument`, `getField`, `count`, `countArray`, `countGroup`, `getRtdb`) and exited 0. A wrong project, a Firebase-style UID without the marker, `latest` as the revision, a set `FIRESTORE_EMULATOR_HOST` and a missing request time were each refused before any read. One invocation without `--dry-run` was made by mistake, on the clean tree and with no credentials: it stopped at "Could not load the default credentials" before its first read. Application Default Credentials lookup may have probed the local metadata server address; no request reached the staging backend, Firebase or a Google Cloud API.

## 8. Limits

- Local results describe the compiled backend, the emulators and synthetic accounts. They do not show deployed indexes, Auth failure modes, worker timing on Cloud Run or the deployed log sinks.
- The backend logs one line per process event, not per request, so the log scan covers start-up, worker, reconciliation and shutdown output and any error the run caused (none in D1 and D2). PRIV-08 rests on the code.
- The host checks saw only public routes without a session. The CSP list is an upper bound for signed-in screens, not an observation.
