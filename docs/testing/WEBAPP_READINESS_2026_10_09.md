# Webapp readiness — 9 October 2026

**The real stationary passenger flow is verified on localhost:3000. Full webapp
and moving-route acceptance remain open.** Chrome completed the existing
passenger's Google sign-in, opened the connected bus's route, selected boarding
and destination stops and acknowledged boarding. Firestore retained exactly one
passenger after repeat boarding. A reproduced reload defect was repaired locally:
reloading now restores the joined ride and both selections after authenticated
backend membership verification. Admin History displays both stop choices.

This continues the [8 October browser run](WEBAPP_READINESS_2026_10_08.md),
[115-issue/209-comment audit](BALCONY_ISSUE_INVENTORY_2026_10_08.md), and
[stationary GNSS/latency audit](BALCONY_READINESS_2026_10_08.md). The source remains
based on testing `a66f91642107eaa1216272ceabefb61c4aedbf8a` with uncommitted local
repairs. No release, firmware flash or GitHub issue mutation occurred.

## Actual Chrome and connected-device evidence

The owner confirmed the device was still stationary at a new location. The old
balcony route was about 10 km away, so its boarding proximity could not establish
today's acceptance. Under the existing QA approval, the real route editor created
**QA Stationary Boarding 9 Oct**, `qa-stationary-20261009`, with Google road
geometry of about 0.7 km, **QA Stationary Origin** and **QA Gufa Destination**.
The existing endpoint geofence remained 20 m. An initially distant origin kept
direction pending; after ending that service, the origin was adjusted using the
map marker's keyboard drag controls and the next service resolved forward.
No geolocation spoofing or authorization relaxation was used.

| Check | Witnessed result | Limit |
| --- | --- | --- |
| Port and login | Existing university passenger completed normal Google popup sign-in at port 3000; later the existing admin did too | This successful run does not establish every embedded-browser/network/redirect case |
| Passenger map | Real stationary Bus01 route, markers, timeline and stop selectors loaded | Moving and reverse behavior require a physical run |
| Boarding | Valid code plus real allowed Chrome location acknowledged; durable own manifest stored both chosen stop IDs | Successful nearby case; full invalid/expiry/concurrency matrix remains separate |
| Repeat action | Existing passenger count stayed one | Single-account repeat, not many-client load |
| Reload | Full Chrome reload restored tracking, On board and both stop selections; code input remained empty | Only an authenticated own-membership response restores state |
| History | Active QA row contained one passenger; after ending early and reloading admin, the terminal row retained both boarding and destination names plus the origin route log | Ending early does not prove final-stop completion or actual alighting |
| Route editor | Explicit create ID, noneditable saved ID, stop rename/save and Google marker keyboard drag worked | Full provider/POI/reorder/delete matrix remains pending |
| Places recovery | Coordinate-text query returned 502 PLACES_UPSTREAM_FAILURE; named-place query subsequently returned 200 | Cause of the first provider failure was not isolated |

The populated service is `PA9n43mGsDbKkH4Dt4zP`; the earlier direction-pending
service is `7YJjHgFXnejmcgwDLsPA`. Sensitive locations, boarding codes, account
identifiers and manifest user IDs remain in ignored local evidence, not this
report. Route preview selections alone were not counted as successful boarding.

## Local repairs completed in this continuation

- **Joined ride lost on reload:** a per-account, one-day local hint stores only
  the session ID and save time. The existing no-store status endpoint returns
  only the requesting joined passenger's validated stop choices, after its
  current manifest membership is authorized. Other passengers remain forbidden;
  privileged status responses do not expose boarding choices. An expired,
  forged, denied, malformed or terminal hint cannot restore On board. Auth
  changes, cancellation and a newer successful join fence delayed recovery.
  Recovery does not replay a join or store the boarding code/location/token.
- **Boarding stop absent from admin manifest:** History now resolves and displays
  the stored boarding stop alongside the selected arrival stop. Missing metadata
  displays Unavailable; a destination never reached still has no invented time.
- Regression checks exposed an overlapping Retry query during implementation;
  recovery now skips an already tracked joined ride, preserving bounded polling.
- **Settings save rejected audit metadata:** an actual evening save returned
  `Unknown setting: updatedAt`. The Firestore settings reader now retains only
  the five typed settings fields; the panel submits only edited overrides,
  avoiding stale full-document updates. A real retry at 20:58:00 IST sent only
  `serviceStartTime` and returned HTTP 200 with `saved: true`. The existing
  value was used, and reloading Settings retained it with No changes disabled,
  preserving passenger copy and announcement settings. Separate
  regressions cover stored metadata/malformed fields and the partial save body.

The previous projection-readiness, freshness clock, auth persistence, tracking
contrast and trace-correlation repairs are documented in the 8 October reports.

## Verification at the final local source

| Check | Result |
| --- | --- |
| Frontend suite | 621 passed across 76 files, final evening rerun |
| Backend suite | 926 passed; 45 integration cases skipped across 10 files |
| Joined-status HTTP/OpenAPI contract subset | 49 passed against an actual loopback Express server with mocked data/auth providers |
| Admin desktop/mobile browser regressions | 20 passed; synthetic providers at isolated port 3105 |
| Frontend and backend lint | Passed |
| Frontend production build and backend TypeScript build | Passed |
| OpenAPI validation | 71 registered HTTP operations, schemas and policy metadata verified |

Today's skipped emulator cases were not promoted to passes. Earlier emulator,
firmware and telemetry-analyzer results retain their own run dates. Test logs and
actual-browser screenshots are in ignored `temp/webapp-readiness-2026-10-08/`
with `20261009` filenames. Synthetic browser tests are distinct from the live
Firebase/Google/GNSS observations above.

## Cleanup and remaining gates

The QA service was ended through the real admin confirmation and stored as
interrupted with one passenger. The guarded device assignment transaction restored
`device_01` to `route_01`; Fleet restored Bus01's allowed routes to `[route_01]`.
Read-only Firestore checks verified no active ride or bus lock, with the device
enabled and existing names/operator assignment retained. QA route and history
remain as evidence. Port 3001 is no longer part of this workflow.

At the morning source, route reassignment briefly showed two online map entries for the same Bus01:
the old route node remains fresh until its freshness window expires. This is an
observed admin-count/map concern. The subsequent
[non-moving software continuation](NON_MOVING_READINESS_2026_10_09.md) repairs it
with revision-fenced retirement, HTTP retry tests and actual RTDB emulator
projection removal. This paragraph retains the morning observation rather than
claiming a new live reassignment run. A panel switch also briefly displayed live data unavailable
before recovering its fresh listener. Full outage/recovery bounds need a dedicated
run. The earlier 45.245-second worker lease wait is retained in the 8 October report.

The displayed long-distance legacy entry is Vaishnodevi to Campus (`Route-1`),
not meowmeow (`route_01`, 1.3 km). The owner selected the short QA route rather
than repairing old false-test geometry. Other pending gates include affected-admin Aryan's
actual login, full CRUD/error/conflict boundaries, actual passenger chat/feedback
submission, mobile suspension, many-client recovery, forward/reverse/turnaround
and off-route travel, and complete correlated sample-to-browser-paint latency.
All 351 feature cases remain in the [A–Z execution ledger](WEBAPP_A_Z_AB_TESTING.md)
with partial observations distinguished from complete passes. This run closes
the real nearby boarding and populated-history evidence gaps; it does not close
issues #245/#246 or certify the entire feature matrix.

The 8 October observed RTDB-commit-to-passenger render target was p50 1.234 s,
p95 2.243 s and p99 2.896 s over 131 correlated rows. These are previous-window
render measurements, not today's timing or a complete GNSS-to-screen-paint chain.

## Evening restart and another stationary location change

The owner restarted npm dev and ngrok and reported a telemetry 503 at
20:42:06.939 IST, then confirmed it recovered and that the device was stationary
at another new location. Read-only ngrok inspection captured three preceding 502s
(20:41:56, 20:41:59 and 20:42:03), then one backend 503 at 20:42:06. Its JSON was
`Telemetry service unavailable.`, `retryAfterMs: 1000`, `commitState: not_dispatched`.
The first subsequent captured 202 began at 20:42:39, about 33 seconds later.
The startup error's exact dependency cause is **unconfirmed**, because the backend
exception log was unavailable. An initial credential-invalidation race is one
source-supported possibility, not an established diagnosis. No new repair of
that failure is claimed. No request was replayed and credentials were not read.

A separate 125-second read-only follow-up, 20:45:14.569–20:47:19.971 IST,
captured 123 settled telemetry requests, all 202, and one still-pending request.
Accepted HTTP request latency was p50 353.6 ms, p95 992.1 ms and p99 1183.0 ms.
Pending status zero was excluded from failures and latency statistics. This
window is neither a fleet load test nor sample-to-browser-paint measurement.
The backend health check returned OK; the public projection was ready. The
new stationary sample had matching raw/accepted coordinates, stopped motion,
connected signal and HDOP 1.28 in the read-only snapshot. Chrome restored admin
access and showed one device online with zero services. Original assignment,
enabled device, populated interrupted QA history, and absence of bus lock/active
ride were reconfirmed. The earlier QA route was not moved to this third location.

An evening GitHub refresh still found 115 issues (113 closed, two open: #245 and
#246), with no issue updates after the prior audit boundary. UI source contracts
and all 12 telemetry-analyzer regressions also passed again. All 351 feature case
IDs remain present. The restart interruption and recovery are evidence for the
remaining outage/recovery gate, not justification for complete readiness sign-off.
