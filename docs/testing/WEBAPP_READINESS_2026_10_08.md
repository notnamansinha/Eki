# Webapp readiness — 8 October 2026

**Readiness is not yet signed off.** Actual browser checks reached the live bus,
route, stop pickers, stationary service, boarding-code endpoint and persisted
admin History. Successful passenger boarding and a populated manifest remain
unverified: passenger authentication recovered after an embedded-browser reload,
but its boarding attempt timed out acquiring location. Chrome's isolated origin
remained unsigned in in the browser session available to automation.
The ADMIN account's attempted boarding was correctly rejected.

This run follows the [complete issue audit](BALCONY_ISSUE_INVENTORY_2026_10_08.md)
and [20-minute GNSS balcony capture](BALCONY_READINESS_2026_10_08.md). It exercises
local source based on `testing` at `a66f91642107eaa1216272ceabefb61c4aedbf8a`,
with the local projection-readiness repair and frontend repairs below. These
changes are uncommitted and have not been deployed. The testing Firebase project
contains existing data and was not treated as disposable.

## Actual browser observations

Chrome used the real Firebase, Google Maps, backend and connected stationary
GNSS. The existing principal was an administrator. Browsing the passenger
workspace as that principal does not establish passenger membership permissions.

| Area | Observed result | Remaining acceptance |
| --- | --- | --- |
| Admin navigation | Live Ops, Routes, Fleet & People, History, Feedback, Settings loaded | Full keyboard and denied-provider matrix; affected administrator Aryan's login |
| Passenger route | Track opened a real map; bus marker, route and stop markers visible; Center on bus worked | Multiple real buses, moving/reverse geometry, off-route recovery |
| Stops and timeline | Destination picker and selected timeline stop worked on desktop and 390 × 844 mobile viewport; QA boarding/destination pickers worked | Joined passenger destination persistence, passed stops and trip completion |
| Service lifecycle | Started original-route session with direction pending; boarding controls remained gated; ended early and observed stored History | Full moving route and automatic turnaround |
| Balcony QA service | Separate two-stop route saved with real geometry, approximately 0.4 km; GNSS near its origin resolved forward service | Successful passenger boarding, populated manifest and terminal passenger history |
| Delay and boarding code | QA service +1 minute acknowledged; code endpoint returned a code | Complete limit, retry, expiry and concurrency matrix |
| Passenger authorization | Admin boarding returned “A passenger account is required to board.” | Actual passenger success and cross-passenger isolation |
| Fleet | Existing 6 October QA vehicle found; name edited, saved, reloaded, then restored; temporary Bus01 allowed-route change saved | Operator CRUD; removal/conflict boundaries beyond the device guard observed here |
| Route editor | QA stops searched, dragged, renamed and saved; prior QA draft reorder cancelled | Provider failures, complex routes and guarded deletion |
| History | After admin reload, both new test records remained Ended early; QA record expanded to zero passengers and the recorded origin arrival; existing completed record opened its passenger manifest and arrival log | Today's populated boarding/selected-stop history and full boundary matrix |
| Feedback | Five existing entries read; reviewed/search/empty/reset filters worked; standalone feedback page loaded | Real submission, review mutation and retry; drafts were cancelled |
| Settings | Required blank service-start field rejected without save; existing copy remained | Valid settings save, reload and rollback |
| Chat/profile | Chat opened; empty draft disabled Send, text enabled it; feedback draft validated; sign-out Cancel retained session | Actual passenger-authorized message delivery; no messages or feedback were sent |

Route/destination preview selection is not proof of a stored boarding record.
That requires an acknowledged passenger join and matching manifest/history data.

## Reproduced defects and local repairs

1. **Fresh fixes falsely appeared offline.** Dashboard/Fleet and passenger
   signal checks compared incoming timestamps to a clock cached on a 15-second
   timer. A fix arriving more than ten seconds after that tick looked too far
   in the future. Freshness now uses the current clock for incoming renders;
   the timer still causes expiry during genuine silence. Two new regressions
   failed before repair; the final suite includes three cases covering fresh
   arrivals and genuine expiry. Live false warnings were absent in the observed
   window after repair.
2. **One tab's reload disrupted another tab's authentication.** Firebase's
   default IndexedDB restoration followed by per-provider migration to local
   storage removed the other tab's persistence record. Authentication now
   chooses its persistence order once during initialization. Independent admin
   and passenger-workspace reloads subsequently retained their workspaces.
3. **Tracking header text was hard to read over light map tiles.** The active
   bus information now has an opaque surface and border, verified on desktop
   and mobile.
4. **Trace analysis failed to correlate projected listeners and map phases.**
   Listener keys include `node:` while render keys use the logical bus/route
   identity. The analyzer normalizes that wire prefix while retaining run and
   session isolation. Its regression suite passes all 12 tests.

An admin-only, query-flagged **Download telemetry trace** control exposes the
existing local trace download. It sends no trace to an external service. Trace
records exclude location coordinates, tokens and message contents.

## Authentication and location blockers observed during this run

The embedded browser reported `auth/network-request-failed` for popup sign-in
and later for token refresh while verifying access. The line shown in Next's
overlay is the error logging site; it does not identify the failing network
request's cause. After a later reload the embedded browser did show the existing
university account as PASSENGER. The real boarding attempt then returned
“Location acquisition timed out. Please try again.” No join was acknowledged and
the session manifest remained empty. A subsequent observation showed session
restoration pending again, so token-refresh reliability also remains open.
A separate loopback origin in Chrome
preserved the admin session; its popup chooser stalled and its redirect returned
to an unsigned-in landing page. The visible port-3000 passenger workspace still
showed ADMIN. The university account's existing trusted passenger role was
confirmed read-only; no role, credential or protection was changed.

Firebase documents cross-origin helper/storage restrictions for redirect login
and recommends same-origin Hosting configuration or other supported flows:
[Firebase redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices).
This is a possible explanation for the localhost redirect result, **not a
confirmed cause** of the popup/token network failures. The owner reported a
signed-in passenger at port 3001 with location allowed, but the connected Chrome
tab still showed the unsigned-in landing page. This reported state was not
promoted to witnessed acceptance. A successful authenticated, nearby passenger
join with matching manifest/history data is required before signing off.

## Stationary QA cleanup

The QA ride was ended through the admin confirmation flow. Both today's test
sessions have interrupted status and zero passengers; Bus01 has no active ride
or bus lock. The device was restored to `route_01` with the guarded maintenance
transaction (not a browser device-management control), then Fleet & People
restored Bus01's original allowed-route list to `[route_01]`. Its display name
and operator assignment were retained. The existing 6 October QA vehicle's
display name was also restored after its persistence check.

The backend was restarted with its normal environment, removing the temporary
process-only port-3001 CORS origin, and the local passenger-origin proxy was
stopped. After reload, admin showed one online device and zero services; the
public projection reported ready. The new two-stop QA route and the two History records are retained as
evidence; the QA route is unassigned to Bus01. No credentials, roles, access
rules or firmware were changed. A device route change temporarily exposed old
and new live nodes for Bus01 until the old node expired; this transient duplicate
was observed on reassignment and remains a separate acceptance concern.

The restoration used a hard process stop. The replacement backend listened at
17:35:46.976 UTC and acquired worker leadership at 17:36:32.221 UTC, **45.245
seconds later**. This is a restart/lease recovery observation, separate from
sample transport latency; an HTTP health response alone does not establish
worker readiness. The read-only public-status check at 17:37:04.599 UTC was ready.
Include lease handover and stale-data behavior in the outage acceptance gate.

## Measured browser timing

Captured admin/passenger trace runs began around 22:06 IST and exported at
22:19 IST. The following uses the observed window after the freshness repair,
starting 22:16:16 IST. Local listener-to-render uses monotonic time. Database
commit-to-render uses the browser's Firebase server-time estimate recorded with
each event, rather than assuming the Windows clock matches Firebase.

| Phase | Samples | p50 | p95 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Passenger listener → render target | 131 | 442 ms | 991 ms | 1,080 ms | 1,142 ms |
| Passenger RTDB commit → render target | 131 | 1,234 ms | 2,243 ms | 2,896 ms | 3,299 ms |
| Admin listener → render target | 131 | 548 ms | 978 ms | 1,072 ms | 1,098 ms |
| Admin RTDB commit → render target | 131 | 1,073 ms | 2,008 ms | 2,554 ms | 3,343 ms |

These are stationary map target callbacks, not a measurement of screen pixels
or a complete GNSS-receiver-to-paint chain. Across the whole passenger capture,
23 actual marker-settled callbacks had listener-to-settled p50 1,028 ms,
p95 2,030 ms and maximum 2,038 ms. Stationary smoothing/coalescence means most
samples did not produce a new settled target. No overlapping new serial capture
was made, so device timing from the earlier balcony report is not combined into
an invented end-to-end percentile.

The five-minute network observer also captured settled HTTP requests and real
RTDB updates. Initial inspector backlog is excluded using request start time.
Raw network evidence contains precise location and remains in ignored local
storage. These measurements do not establish fleet scale or billed usage.

## Verification and evidence

- Frontend: **600 tests / 74 files pass**, lint passes, build passes.
- Existing admin browser regression harness: **20 pass**, desktop and mobile,
  using synthetic Firebase/HTTP providers. This complements actual clicks and
  does not replace provider/OAuth acceptance.
- Telemetry analyzer: **12 pass**, including projected/logical key correlation
  and isolation across sessions, routes and browser runs.
- Backend and hardware checks from the earlier run retain their separately
  documented results; they were not silently rerun or promoted to browser proof.

Ignored local evidence is under `temp/webapp-readiness-2026-10-08/`: screenshots
(including `admin-qa-history-restored.jpg` after reload),
before/after trace downloads, `metrics-summary.json`, sanitized test logs, the
network observer and private state checks. Public documentation deliberately
omits account identifiers, boarding codes and precise balcony coordinates.

## Before physical movement acceptance

Complete the passenger join → selected destination → manifest → ended History
flow with a real passenger session. Review **Vaishnodevi to Campus**, whose saved
distance displays **1,355.5 km** despite local stop names; its intended geometry
requires an owner-approved oracle before a bus run. Then perform the full
forward/reverse/turnaround, passed-stop, moving latency, parallel-road/off-route
and outage checks retained in issues #245/#246 and the A–Z ledger. This run has
not executed all 351 feature cases or every mutation/boundary on each page.
