# Eki A–Z acceptance execution ledger

Last updated: 2026-10-07 22:28 IST (UTC+05:30).

This is the current status companion to the
[complete supplied A–Z plan](WEBAPP_A_Z_AB_TESTING_PLAN.md), including all
351 feature cases, the C01–C22 control matrix, H01–H18 HTTP matrix, boundary/race
expansions, physical checks and future A/B experiments. Catalog inclusion is
not an executed pass. Attached documents are historical requirements/evidence;
the user's current instructions define authorized work.

Current work is issue #246 **R01–R15 only**. R16+ repair work is deferred;
previously completed later-numbered items retain their historical evidence.
This task preserves later open PRs/worktrees and makes no new acceptance claim
for them. Remote `testing` also contains externally merged PR #270 (R21) and
PR #271 (R23), through `41ffbc7`; their presence does not expand this task scope.
This scope restriction refers to Rxx repair subissues, not feature case IDs.
GNSS is disconnected and `npm run dev` stopped. There is no separate Firebase
staging project; destructive/load/privacy checks use disposable loopback
emulators. Do not treat the existing testing Firebase project as disposable.

## Pending execution

- Affected administrator **Aryan**: the owner reported on 7 October that the
  failure was likely a debug-token issue and believes access now works. This
  remains reported recovery, without witnessed affected-account acceptance.
  Witness his actual sign-in with current
  testing source and matching enrolled App Check configuration, open every
  admin panel, and exercise a denied-read Retry if it occurs. A different
  existing administrator session does not establish this account's acceptance.
- Full admin CRUD: routes provider/error/conflict/delete paths, bus creation
  result and metadata/assignment persistence, operators, settings, feedback,
  history, chat and ride start/stop are pending actual provider acceptance.
  Later R16+ fixes are deferred even when this future catalog names their tests.
- R11: deployment in a suitable protected environment, new index build
  readiness, and the real retention/collection-group queries after readiness.
  A mock REST response or emulator does not prove an actual cloud index ready.
- R14: matching backend/status endpoint, schema/backfill, restrictive RTDB
  rules and browser rollout must be verified together before field testing.
  Merging software does not perform that deployment. Real fleet/replica egress,
  latency and concurrency acceptance needs a representative observed window.
- R15: prolonged real mobile/PWA suspension, real SDK disconnect/flapping,
  and measured many-client recovery with SDK/network/billing behavior.
- #245: full forward/reverse/turnaround/parallel-road/off-route bus run,
  correlated sample→server→database→browser paint p50/p95/p99 with same-window
  usage, long soak, physical faults, secure provisioning/OTA, deployment,
  monitoring/ownership and institutional gates remain open.

## Evidence and commit boundaries

| Evidence | Source and result | Limit |
| --- | --- | --- |
| Historical full plan | Supplied baseline `722ab6e`; original SHA-256 recorded in companion | Static file/control/API/history census; declared cases are not executed |
| Admin recovery software | PR #268, merged testing `0b24b52`; 47 focused, 12 synthetic browser, 24 actual emulator cases; final-head and merged CI pass | Account/browser enrollment acceptance stays open |
| Route interaction software | [PR #269](https://github.com/notnamansinha/Eki/pull/269), head `f52c9dd`, merge `9579cdc`; 74 focused and 12 synthetic mobile/desktop browser cases; 9 merged route/map cases pass | Synthetic map/provider/save transport |
| PR #269 CI | [Push](https://github.com/notnamansinha/Eki/actions/runs/37359330129), [PR](https://github.com/notnamansinha/Eki/actions/runs/37359385536), [merged testing](https://github.com/notnamansinha/Eki/actions/runs/37360092803): web/backend-image/firmware pass; tested head and merge trees identical | CI covers committed software, not actual OAuth/Google/cloud UX |
| Actual localhost browser | Chrome, testing `0b24b52`, 6 October before disconnect; details below | Signed-in principal was not established as Aryan; no final merged code or hardware acceptance implied |
| Stationary tunnel observation | 00:37:17.567–00:38:18.398 IST on 6 October, 60.83 seconds, 59 captured telemetry entries, 32 captured HTTP 202, 27 still in flight (status 0), no read errors | Pending entries were not revisited; zero is not a settled failure, and this is not complete response latency or sample→paint evidence |

The original checkout's comment-only tracked change and untracked files were
preserved. Documentation and repairs use isolated managed worktrees. The
original browser server was advanced from `722ab6e` to `0b24b52` for the
observed manual run; it was subsequently stopped by the owner.

## Actual localhost clicks before interruption

An existing administrator session restored. Live Ops loaded and showed a
stationary device online. Routes and Fleet/People loaded without a witnessed
permission-denied error. This confirms those reads for that session only.

The actual route editor created **QA Stationary Acceptance**, identifier
`qa-stationary-20261006`, through Google map picking and the real backend.
Picking was armed deliberately; two stops were renamed **QA West Stop** and
**QA East Stop**, reordered, swapped and an A marker dragged. Deploy succeeded.
A fresh browser tab/reload and Edit confirmed persisted labels/order and the
dragged coordinates. An unsaved display-name edit was cancelled and the saved
name stayed unchanged. Provider-independent reverse geometry, billing counts,
conflicts, long routes and deletion were not established by this interaction.

Fleet/People exposed saved buses, an operator and route choices. A QA vehicle
form (`qa-stationary-bus-20261006`, **QA Stationary Vehicle**) was filled and
submitted with the QA route. Its creation outcome was interrupted and remains
**UNVERIFIED**. Inspect whether it exists before another submit; do not infer
success or absence. The QA route remains saved, unassigned at the observation
point. No cleanup was performed or claimed. Before later removal, check current
assignments/active rides and use the normal guarded confirmation flow.

Settings/feedback/history/chat mutations, ride start/stop, real denied Retry,
sign-out/account switching and the affected account were not manually completed.
No personal account IDs, credentials or precise observed coordinates are
published in this ledger.

## R01–R15 software checklist

Use [issue #246](https://github.com/notnamansinha/Eki/issues/246) for exact merged
heads, tests and pending acceptance; [issue #245](https://github.com/notnamansinha/Eki/issues/245)
for external gates. Completion here is software scope, not a full field pass.

| Repairs | Current record |
| --- | --- |
| R01–R10 | Already merged; [priority record](ISSUE_246_PRIORITY_PARTS_2026_10_05.md), work admission, deadline, leadership, durable operation, reconciliation and privacy runbooks describe tested bounds and unresolved field gates |
| R11 | [PR276](https://github.com/notnamansinha/Eki/pull/276) merged `31db267`; tested head `e8b490c` and fetched merge trees identical; 18 merged focused and 74 script checks, 70-operation OpenAPI/UI contracts, audits zero; [push](https://github.com/notnamansinha/Eki/actions/runs/37444429836), [PR](https://github.com/notnamansinha/Eki/actions/runs/37444696350) and [merged CI](https://github.com/notnamansinha/Eki/actions/runs/37445413131) pass all three jobs. Index-first protected workflow and strict bounded name-only query readiness gate; actual cloud deployment readiness pending |
| R12 | PR266 merged `c160242`; route catalog/watch invalidation, actual ordering/ack-loss emulator checks; [catalog contract](../operations/ROUTE_CATALOG.md) |
| R13 | PR267 merged `bff3b02`; bounded read-only geometry GET and explicit authorized repair; [geometry contract](../operations/ROUTE_GEOMETRY_READS.md) |
| R14 | Measurement and isolated software verification underway; retain pending until actual isolation/order/fence coverage and merge evidence exist |
| R15 | [PR275](https://github.com/notnamansinha/Eki/pull/275) merged `b358dd2`; tested integrated head `a202a5f` and merge trees identical; 25 focused +19 mirror +16 synthetic browser checks pass on fetched merge; [push](https://github.com/notnamansinha/Eki/actions/runs/37445787428), [PR](https://github.com/notnamansinha/Eki/actions/runs/37445792389) and [merged CI](https://github.com/notnamansinha/Eki/actions/runs/37446408451) pass all three jobs. Healthy short switches, 30-second suspension gate, visible+online debounce, natural recovery cancellation, 5-second cooldown and bounded equal jitter; real PWA/network/many-client acceptance pending |

On the final integrated R15 head, actual Chrome clicks on the local synthetic
fixture observed an initial verification timeout; **Try again** plus synthetic
provider approval reopened protected UI. The fixture then denied both buses
and routes: **Retry fleet access** closed protected data while shared
verification was pending, and approval made **Verified buses** and
**Verified routes** visible. This is witnessed browser interaction using
synthetic SDK/HTTP, with no live project or affected-account acceptance.
The resume fixture displayed Ready with a live synthetic bus; full suspension/
flap/handshake assertions come from the 16-case controlled browser suite.

## R14 independent software and browser evidence

The final independent review passed **65 focused publisher/HTTP/OpenAPI tests**
and **9 actual Firebase SDK emulator tests**, plus lint. These cover worker
handover without a redundant revision, same-generation reconstruction of erased
destinations, captured generation across SDK retries, bounded replay, stop and
leadership fencing, and strict session membership. Independent frontend review
passed **74 new acceptance cases** and **59 existing lifecycle cases**. Final
owner gates and PR/merge evidence are recorded separately once complete.

In the same two-route fixture with 20 raw, 20 matched and 40 internal updates,
the raw listener delivered 80 callbacks / 78,611 decoded JSON bytes; selected
route A delivered 40 / 14,734 (**81.26% fewer decoded bytes**). Route B updates
delivered no route A callbacks. The active-session window made zero catalog
writes/callbacks. Publisher work was 40 source reads / 17,626 bytes, 80 actual
transaction attempts / 40 commits / 13,894 public-value bytes, and zero
reconstruction reads during the measured 20-fix window. Startup and periodic
repair costs are separate; this is not production billing, network framing,
latency or reduced authority contention evidence.

Actual Chrome interaction on the isolated localhost fixture recovered unready,
catalog-denied and detail-denied states through visible Retry, opened each route's
own tracking identity, opened/closed the timeline, returned home, and selected a
destination in the in-app picker. This exposed and verified the correction of an
unfetched route card to **Open for live status**, rather than a false pending
direction. SDK, authentication and transport were synthetic. Real road geometry
was unavailable and shown as such. Screenshot capture failed with the browser
tool's CDP timeout on both existing and fresh tabs; DOM/AX interaction evidence
was retained. No affected-account or live GNSS acceptance is implied.

## R14 supplemental acceptance oracles

These are required regression oracles for the focused successor to PR #277.
They remain pending until the final source and recorded results below establish
execution; the original PR's green CI alone did not cover these failures.

| Area | Accepted path and adverse/recovery oracle |
| --- | --- |
| Public isolation | The selected-route UI listener receives only its whitelisted route detail; its payload excludes other-route coordinates, raw histories, anchors, claims and worker metadata. Admin fleet and existing authenticated HTTP compatibility endpoints use the same whitelist; scoping does not deny all cross-route HTTP access. |
| Auth generations | A new sign-in cannot replay a previous generation's cache while verification is pending; a late old callback cannot publish. Denied detail/catalog/schema reads show actionable recovery, and Retry passes through shared verification. |
| Readiness and rollout | Missing, incompatible or incomplete backfill remains visibly unavailable. Selected and joined routes each need authoritative delivery before recovery clears. A genuinely empty compatible route is distinguished from denied or unready data. |
| Freshness | Catalog and detail use configured expiry with receipt paired to the accepted sample. Delayed-but-valid samples stay visible for their receipt window; future/stale and unrelated receipts cannot extend it. Boundary checks use explicit clocks. |
| Completion | A joined session's completion survives coalesced automatic turnaround and route changes. Authoritative session status resolves disappearance without treating an interrupted/missing session as completed. Feedback applies to the completed session only. |
| Session/direction | Equal telemetry coordinates/timestamps in a new session or changed direction still reset relevant lifecycle state. The projection preserves public completion markers without another route's coordinates. |
| Fencing | A no-op handover still stamps the new worker generation. Revoked/stopped workers cannot publish after delayed reads, transaction retries or queued work; a dispatched operation retains its permit until settlement. |
| Recovery and bounds | Startup/source/catalog/view replay is paged, capacity bounded and resumable after failed reads, missed notifications, removal and lost acknowledgments. Shutdown returns within its documented bound and does not authorize late writes. Existing legal route IDs, including reserved JavaScript keys, remain supported safely. |
| Measured cost | Compare the same fixture, write sequence and time window for raw versus projected listeners. Record bytes/events, transaction retries and server work separately; smaller client payloads do not prove fewer authority transaction attempts or production egress. |

## Reproduce and extend later

Record each execution's exact Git/build, timezone/window, actor role, provider,
environment, input/seed, expected/actual UI and authoritative state, outbound
calls, test output, cleanup and limitations. Use **PASS**, **FAIL**,
**BLOCKED_ENVIRONMENT**, **NOT_RUN**, **PARTIAL**, or
**NOT_APPLICABLE_WITH_REASON**. A subset pass must specify what remains.

First inspect current package scripts. Normal software gates are `npm test`,
`npm run lint`, `npm run build:production`, `npm run test:e2e:admin`,
`npm run test:rules`, `npm run verify:openapi`, `npm run verify:ui-contracts`,
and both full and runtime dependency audits. CI additionally builds backend
images and development/journal/secure firmware. Each repair needs exact final
head checks, fetched merge tree/ancestry verification, relevant merged tests
and merged-testing CI. Run heavy local suites sequentially to avoid fixture
startup/deadline noise; retain first failures and explain unchanged reruns.

On this Windows/Java 21 machine, local emulators required a process-scoped
`JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\eki-emulator-disabled-unix-socket-directory`
where that directory does not exist, to use TCP selector fallback. Emulator
project IDs and ports must be isolated; never fall back to live Firebase if
startup fails. Actual emulator transactions/rules are distinct from mocks,
and emulator Auth/provider stubs still cannot establish live provider behavior.

For route/map UI acceptance, restart current testing locally with matching
backend/configuration, witness Maps loading, verify mode-gated picking,
drag/rename/reorder/swap, save ack, reload and cloud persistence; then separately
exercise Places errors, duplicate ID/version conflicts, independent reverse
roads, assignment/delete guards and approved cleanup. Expand C01–C22 for each
control occurrence and H01–H18 for **each current** OpenAPI method/path; the
old59-operation appendix cannot substitute for a current census.

The supplied [GNSS generator](simulations/generate-gnss.mjs) is an offline planning helper until explicit
loopback replay is configured. Generated coordinates/seed/JSONL validate input
plans only. They do not prove ingestion, matching, motion, physical GNSS or
latency; use current isolated backend/emulator fixtures for those assertions.
Real reverse road geometry must be supplied independently; array reversal
is not a valid one-way-road oracle. No hardware reconnection is needed for
software fixture tests. Offline validation results are recorded separately.

The supplied generator was run offline twice per profile with count360/seed42:
all **20** profiles produced identical plans and ordered schedules. Counts,
duplicate bodies, stationary coordinates/speed and stale/future offsets were
checked; four invalid profile/count/outage/seed arguments were rejected.
Outage45/120/301 plans contained315/240/59 events; duplicate contained396;
the other profiles contained360. This is input-generator verification only:
no network replay or backend/matching/physical acceptance occurred.

## All 351 feature cases: execution state

The original actions and full expected oracle remain in section 5 of the
companion plan. **NOT_RUN** means this session has no full-case execution;
earlier regression evidence may cover a subset. Rows below preserve every
identifier. No complete feature case is marked PASS from a partial click or
synthetic dependency. R16+ remediation remains deferred; all rows are retained
for the later pure testing stage. Universal control/API/race matrices still
expand these rows rather than being silently omitted.

### AUTH

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| AUTH01 | Anonymous load `/`, `/passenger`, `/admin`, `/feedback` directly | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH02 | Click Google popup sign-in once; complete allowed isolated account login | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH03 | Cancel popup / block popup / provider network failure | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH04 | Use full-page sign-in; reload callback; back/forward | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH05 | Same-origin Hosting helper on web.app and firebaseapp.com; configured custom domain | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH06 | Invalid/unregistered OAuth origin, redirect URI, referrer or App Check hostname | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH07 | Auth restore stalled beyond current 8-second guard and role verification beyond 10 seconds | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH08 | Role fetch permission denied/not found/malformed/stale cache | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH09 | Bootstrap missing profile; repeat; existing passenger/admin/operator profile | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH10 | Forge role/name/UID in body/local Storage; expired or revoked token | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH11 | Sign out with live listeners/chat/map/dialogs mounted | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH12 | Passenger P→Q and admin→passenger without process restart | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH13 | Role revoked or operator assignment changed while tab open | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH14 | Delete/disable Firebase account while client token remains | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH15 | Missing environment variables vs valid config; local/tunnel backend URL s | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH16 | Two tabs sign in/out and one reloads after role change | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH17 | 404/unknown path, static export deep links, malformed URL IDs | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| AUTH18 | Auth/App Check refresh during HTTP retry and listener reconnect | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### PAX

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| PAX01 | One fresh resolved live route; click `Track <route name>` | PARTIAL — Synthetic Chrome: Track A opened its bus/session map; complete live-provider and adverse-path oracle pending. |
| PAX02 | Fresh online stationary device without session; click its card | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX03 | Pending-direction session; open card, choose destination and inspect timeline | PARTIAL — Synthetic Chrome: pending direction stayed explicit and Beta destination selection persisted; real boarding/ETA/timeline matrix pending. |
| PAX04 | Device marker far outside configured route while stationary | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX05 | Route has no stops/waypoints or malformed projection | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX06 | Zero buses, loading routes, routes listener failure and retry | PARTIAL — Synthetic Chrome: unready, catalog-denied and detail-denied states showed Retry and recovered; full empty/loading/provider matrix pending. |
| PAX07 | Multiple routes and buses with identical names/different IDs | PARTIAL — Synthetic Chrome: Track A and B opened distinct identities; duplicate names, ETA/chat and real-provider matrix pending. |
| PAX08 | Active bus plus available unarmed bus on same route | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX09 | Click Routes→tracking→Back→Profile→Routes repeatedly | PARTIAL — Synthetic Chrome: tracking, timeline close and Back returned route cards; repeated Profile navigation and full layer matrix pending. |
| PAX10 | Tab through home while hidden tracking layer remains mounted | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX11 | Switch selected route during pending geometry/ETA/chat request | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX12 | Switch selected bus while old session update arrives | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX13 | Joined ride finishes; new session appears on same bus | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX14 | Selected bus removed without terminal completion | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX15 | No new telemetry; advance clock across signal-loss/expiry boundaries | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX16 | Reconnect with same bus but new session/route version | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX17 | Announcement active/inactive/empty; service-start placeholder and long text | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX18 | Carousel swipe/pointer/keyboard at first/last card and one/zero cards | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX19 | Profile name/photo absent/broken/untrusted text | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX20 | Open general feedback, cancel, reopen; change account | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX21 | Sign-out confirmation cancel/confirm/Escape | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX22 | Passenger deletion request cancel/confirm/retry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX23 | Admin/operator views profile deletion affordance / calls API directly | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX24 | Slow route/settings listener with live data already loaded | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX25 | Browser reload mid-tracking / back gesture on mobile | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| PAX26 | Service direction changes forward→reverse while destination open | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### BOARD

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| BOARD01 | Resolved armed/active ride; valid ordered stops, eight-character code, nearby accurate geolocation | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD02 | Missing boarding/destination/code; code lengths 0/7/8/9 | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD03 | Lowercase/whitespace code vs alphabet exclusions I/O/0/1 and punctuation | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD04 | Browser permission denied, unavailable GPS or 10-second geolocation timeout | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD05 | Accuracy negative, zero, 100m, 100m+epsilon, missing, string | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD06 | Passenger distance 149.99m, 150m, 150.01m from trusted hardware | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD07 | Hardware fix age 60 s±1 ms; future skew 10 s±1 ms; receipt/sample mismatch | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD08 | Pending direction/unarmed/offline/terminal ride | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD09 | Same stop, unknown stop, reverse order, duplicate stop ID | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD10 | Forward join then reverse route with proper reversed stop selection | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD11 | Wrong code from another session/bus, rotated code during transaction | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD12 | Session completes or assignment/direction changes between initial read and transaction | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD13 | Existing member corrects stop choices without geolocation | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD14 | Member removed after initial read; retry update without position | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD15 | Manifest 999→1000 new member, 1000→1001, existing member update at cap | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD16 | Two concurrent first joins for same UID | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD17 | Submit forged user Name/user Id/admin fields | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD18 | HTML 200/204/missing `joined`/wrong session acknowledgement/network lost after commit | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD19 | Unmount or switch ride while geolocation/token requests resolve | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD20 | Passenger Q tries P's membership endpoint/body UID; operator/admin attempts passenger self-join | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD21 | Trusted live projection exists but mismatched device/bus/route/session | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| BOARD22 | Code request as assigned operator/admin/unassigned operator/passenger | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### MAP

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| MAP01 | Current raw and matching position for same seq/timestamp/context | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP02 | New raw arrives before match; previous current-context match exists | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP03 | Match missing/stalled past grace | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP04 | Match late/old seq/wrong sampled At/session/direction/version | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP05 | Match confidence just below/at/above 0.45 | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP06 | Off-route state, reconnect or direction pending | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP07 | Invalid top-level coordinates but valid/invalid raw child | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP08 | Select bus B2 with B1 dynamic route cached | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP09 | One malformed dynamic geometry among several valid entries | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP10 | Active route context resets matcher IDs | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP11 | Initial route fit with bus outside endpoints; user drags map then new fixes | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP12 | Click Center on bus before first fix/after fix/after bus disappears | PARTIAL — Synthetic Chrome: Center on bus clicked with a fix; actual Google pan and before-fix/disappeared cases pending. |
| MAP13 | Destination dropdown pointer, arrows, Home/End, typeahead if implemented, Enter/Escape/outside | PARTIAL — Synthetic Chrome: in-app destination picker opened and Beta persisted after pointer selection; keyboard/focus/outside matrix pending. |
| MAP14 | Expand timeline by click and keyboard; collapse/backdrop/Escape | PARTIAL — Synthetic Chrome: timeline opened with two stops and explicit unavailable geometry; close worked, keyboard/backdrop/Escape matrix pending. |
| MAP15 | Forward/reverse paths on divided or parallel roads | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP16 | GPS jitter at stop and along parallel road with weak HDOP | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP17 | Stops before/after bus, destination changes, passed stop | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP18 | Speed 0/stopped/slow/fast and configured delay | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP19 | Invalid speed/heading ranges in RTDB boundary | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP20 | Last route bus removed, selected bus stale, route switch | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP21 | Geometry loop/self-intersection/close parallel segments/anti-meridian | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP22 | Large polyline, malformed/truncated encoding, invalid points or missing geometry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP23 | Maps script/key/referrer/billing failure or slow load | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP24 | Resize/rotate/high DPR/zoom/reduced motion | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP25 | Burst80 ms fixes, 500 ms delayed match, out-of-order delivery | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP26 | Background/foreground/OS sleep and long RAF gaps | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP27 | Same sample ancillary update before scheduled render trace callback | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP28 | Tiny/sub-pixel move with smoothing coalescence | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP29 | Browser/server clock offset and wall-clock jumps | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| MAP30 | Empty route timeline, long names, many stops | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### GNSS

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| GNSS01 | Nine-field valid payload via Device auth and registered D1 | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS02 | Immediately previous eight-field and legacy six-field payloads | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS03 | Unknown/missing field or arbitrary bus Id/route Id/session Id | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS04 | Latitude−90/90±epsilon; longitude−180/180±epsilon | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS05 | Speed−epsilon/0/200/200+epsilon; heading−epsilon/0/359.999/360 | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS06 | HDOP0/4/4+epsilon/99/99+epsilon, omitted previous schema, null nine-field | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS07 | seq 0/1/0 xffff ffff/overflow/fraction/string; motion unknown/case variants | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS08 | Sample now−60000±1 ms and now+10000±1 ms | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS09 | device Sent At before sample, equal sample, future 10 s±1 ms | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS10 | Body511/512/513 bytes, whitespace padding, multibyte UTF-8, invalid JSON | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS11 | Exact same accepted fix retried with same seq/sample identity | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS12 | Older timestamp, repeated seq with new body, seq reset, same timestamp newer seq | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS13 | Newer fix commits before delayed older fix across replicas | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS14 | Wrong credential repeatedly then valid credential | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS15 | Disable/rotate/reassign D1 while replica cache warm | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS16 | Normal30 km/h at1 Hz forward and reverse | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS17 | Stationary jitter within/outside adaptive 15..50m budget | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS18 | One huge short-gap teleport followed by good samples near old anchor | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS19 | 45-second outage with plausible and implausible displacement | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS20 | 120-second outage at30 km/h (~1 km) then three coherent good fixes 1 s apart | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS21 | Same120-second outage followed by one isolated outlier | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS22 | Candidate intervals 499/500/5000/5001 ms | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS23 | Candidate poor/unknown quality, uncertain motion, repeated/out-of-order/burst samples | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS24 | Reacquisition candidate exceeds full-outage plausible travel | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS25 | Gap60000/60001/300000/300001 ms | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS26 | Normal accepted fix interrupts evidence; context changes midway | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS27 | Raw fix accepted by transport but fails anchor plausibility | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS28 | Fresh fix cleanup with legacy rtdb Committed At/active Route Polyline present | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS29 | Diagnostics flood exhausts IP pool while telemetry valid | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS30 | Many devices behind one NAT, wrong credentials, two replicas | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS31 | RTDB commit failure, registry failure, server unavailable, shutdown during ingest | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS32 | Accepted response includes X-Eki server timing headers | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS33 | Stale queue sample 55 s boundary and API60s boundary | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS34 | Valid HDOP without explicit accuracy and explicit invalid accuracy in browser live input | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS35 | Sequence wrap/reset after warm/cold recovery and original sample replay | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| GNSS36 | Corrupted RTDB child shape, unexpected field, old compatibility record | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### TRIP

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| TRIP01 | Arm at forward origin / reverse origin with good current fix | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP02 | Arm between endpoints, poor HDOP, stale fix or ambiguous nearby endpoints | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP03 | Endpoint coordinate/config Version changes while inference in flight | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP04 | Origin within 20m, depart around adaptive departure threshold | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP05 | Loop route final stop close to origin, before departure | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP06 | Cross next stop 20m boundary vs later stop first | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP07 | One segment crosses multiple close stops in order | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP08 | Uncertain motion/invalid segment/long jump crossing stop | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP09 | Restart backend at each stop checkpoint before/after history persistence | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP10 | Firestore completion commits; RTDB terminal publication fails | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP11 | RTDB child_removed/stale sweep concurrent with queued writer | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP12 | Bus reused for new session while old writer/matcher/reroute finishes | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP13 | At final ordered stop after departure | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP14 | Automatic turnaround at destination with configured 0/nonzero dwell | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP15 | Endpoint GNSS oscillation / poor quality / stale claim / two leaders | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP16 | Manual End ride early on authorized current session | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP17 | Repeat interrupt; interrupt already completed/failed/missing session | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP18 | Pending/armed/active abandoned beyond 12 h boundary with seconds/ms/Firestore timestamps | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP19 | Per-bus burst while Google route work slow | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP20 | Wrong turn >60m twice vs strong deviation>120m; boundary samples | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP21 | Brief deviation/jitter returns on route before reroute resolves | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP22 | Reroute network timeout 3.5 s, retry 5 s, provider malformed result | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP23 | Dynamic geometry persisted/readable for selected bus/version | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP24 | Metadata-only edit while route active | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP25 | Geometry edit/deletion while active or assigned | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP26 | Leader lease 45 s/renew 15 s, crash, restart and partition | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP27 | Graceful shutdown with queued writes/workers and hard timeout | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| TRIP28 | Route cache>bounds, cold/warm cache, invalidation/version race | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### OPS

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| OPS01 | Open all six tabs via pointer and keyboard arrows/Home/End | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS02 | Operator subscription auth/permission/quota/network failure; Retry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS03 | Select assigned/unassigned operator; inspect derived vehicle field | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS04 | Start service valid online assigned device | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS05 | Start double click, dropped response after commit, retry after refresh | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS06 | Start ack HTML/204/empty/missing session ID or wrong shape | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS07 | Start disabled device/offline/missing route/stale assignment/active conflicting session | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS08 | Expand each live ride/map marker/Open live details with same names | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS09 | Delay−2/−1/+1/+2 at0/1/1439/1440 and rapid alternating updates | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS10 | Delay unknown ack/conflict/session changes during request | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS11 | Request boarding code / missing code ack / invalid code length | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS12 | Open chat then switch session; clear messages at zero/nonzero | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS13 | Clear ack missing/negative/nonfinite or proxy HTML | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS14 | End ride early confirm/cancel/Escape and concurrent replacement session | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS15 | Completed ride appears while controls pending | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS16 | Zero fleet/multiple routes/large lists/long names/mobile | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS17 | Reopen panels repeatedly and principal change during dynamic import | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OPS18 | Admin session detail GET vs delay PATCH paths | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### ROUTE

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| ROUTE01 | Add route; set name/ID/color; two valid stops; Save | PARTIAL — Real create/save/reload succeeded; stable IDs, colors and independent reverse provider geometry not fully checked. |
| ROUTE02 | Generated ID vs explicit create ID; existing route edit ID field | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE03 | Name blank/long/Unicode, colors all eight choices | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE04 | Search0/1/2/3 chars and rapidly change query around 300 ms debounce | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE05 | Places unauthorized/429/timeout 5 s/502/malformed/zero results | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE06 | Select result with incomplete/invalid coordinates, duplicate stop | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE07 | Toggle Pick on map; click map/POI; drag stop marker | PARTIAL — Real mode-gated map picks and drag persisted; all POI/accidental-click boundaries pending. |
| ROUTE08 | Rename stop blur/Enter/Escape where supported; reorder first/middle/last | PARTIAL — Real rename/reorder persisted; Enter/Escape and all boundary positions pending. |
| ROUTE09 | Remove down to1/0 stops and try Save | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE10 | Swap A & B on2 and many stops; swap twice | PARTIAL — Real two-stop swap observed; many-stop/twice-restoration matrix pending. |
| ROUTE11 | Metadata-only name/color/short Name change | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE12 | Coordinate/order change | PARTIAL — Real coordinate change persisted; computation count/chunk/version races pending. |
| ROUTE13 | 26/27/28 points and 99/100/101 stops | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE14 | Forward/reverse provider path differs on one-way/divided roads | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE15 | Invalid polyline/chunk endpoint gap/no distance or duration/large encoded body | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE16 | Save returns 202/lost response at30s; poll operation until 35 s reconcile deadline | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE17 | Same save ID/payload vs same ID/different payload; two replicas | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE18 | Stale config Version; other admin saved route first | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE19 | Route endpoints changed while active ride/assignment exists | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE20 | Cancel editor with unsaved changes, reopen other route while save completes | PARTIAL — Real unsaved name Cancel discarded draft; concurrent save/other-editor race pending. |
| ROUTE21 | Delete route valid/unassigned vs assigned/active; confirm cancel | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE22 | Expand stops in route list; zero/malformed metadata/loading error Retry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE23 | Admin token expires midway through long save/poll | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE24 | Geometry GET lazy repair concurrent with save/version change | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE25 | Route segment from/to/via valid invalid reverse and out-of-order | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| ROUTE26 | Durable preview create/status processing/succeeded/failed, unknown deadline | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### FLEET

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| FLEET01 | Add vehicle ID/name with route checkboxes; zero/one/many routes | PARTIAL — Fleet read and QA vehicle submission observed; creation outcome unverified, full oracle pending. |
| FLEET02 | Vehicle ID collisions/case/invalid chars/very long and duplicate names | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET03 | Edit vehicle name/routes; save/cancel; edit while pending | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET04 | Delete vehicle unassigned/assigned/active and concurrent ride start | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET05 | Add operator ID/name/Auth UID/vehicle | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET06 | Auth UID missing/nonexistent/already bound or Firebase claims update fails | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET07 | Reassign/unassign operator with old token and two replicas | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET08 | Operator assignment changed during armed/active ride | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET09 | Delete operator inactive/active/nonexistent; confirm cancel | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET10 | Collapse/expand saved vehicle/operator lists with 0/1/many | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET11 | Vehicle/routes/operator subscription independently fail/retry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET12 | Legacy fleet reconcile partial success 207 and v2 durable job | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET13 | Same key different reconcile payload / crash after claims update | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET14 | Direct unauthorized CRUD vs UI hidden controls | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FLEET15 | Route deleted/renamed between checkbox load and save | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### CHAT

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| CHAT01 | Joined passenger and assigned operator/admin exchange messages | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT02 | Pending direction with real online session, member vs nonmember | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT03 | Empty/whitespace/500/501 char/Unicode/profanity/evasion/HTML text | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT04 | Same request ID same text twice, same ID different normalized text | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT05 | Sends within 3 sec, 10/min vs11/min, 60/hour vs61/hour | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT06 | Multiple tabs/concurrent replicas attempt rate bypass | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT07 | Unauthorized passenger/unassigned driver/forged sender or UID | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT08 | Completed/interrupted/failed/deleted session | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT09 | Response HTML/204/missingid/lost after commit; retry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT10 | Listener cache-only/pending Writes then remote confirmation | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT11 | 199/200/201+messages with limit To Last200 and same timestamp | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT12 | Session switches/unmount/auth not ready/error Retry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT13 | Own/other message while closed/open panel | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| CHAT14 | Clear messages concurrently with send/listener catch up | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### FEED

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| FEED01 | General feedback with comment; empty comment and 200/201 words | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED02 | Completed joined ride with rating 1..5/comment or both | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED03 | Unjoined/pending/active/interrupted/failed ride or forged identifiers | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED04 | Rating 0/1/5/6/fraction/string and no comment | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED05 | 24 h cooldown exact boundary, concurrent submit, P→Q | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED06 | Same request ID/payload retry vs different payload conflict | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED07 | HTML 200/204/missing submitted true/network fail; edit draft during pending | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED08 | 10 seconds after joined completion vs disappearing/unjoined ride | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED09 | Stars/buttons/textarea/close/backdrop/cancel keyboard | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED10 | Admin All/type/status/search combinations and Reset | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED11 | Expand feedback with missing metadata/long comment/deleted referenced entity | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED12 | Mark reviewed/resolved, repeated same status, pending write | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED13 | Missing/wrong status ack/proxy HTML/403 or 500 | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED14 | Standalone `/feedback` load, role guard, Back to admin | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FEED15 | Feedback listener auth/readiness/permission/quota error and Retry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### SET

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| SET01 | Load all four text fields and announcement switch | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SET02 | Save valid partial update; change one field; toggle active | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SET03 | Limits service 64/main 200/sub 300/announcement 500 at±1; blank required text | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SET04 | `announcementActive` true false vs string/number/null | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SET05 | Save no changes/double click/pending | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SET06 | Save draft A then type B while A in flight | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SET07 | Conflict/errors/HTML 204/missing ack; retry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SET08 | Listener update from other admin during local dirty draft | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### HIST

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| HIST01 | Completed/interrupted/failed sessions with stop arrivals | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| HIST02 | Expand/collapse rows with duplicate bus names and deleted metadata | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| HIST03 | Delete terminal session; confirm cancel/Escape and focus | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| HIST04 | Delete pending/armed/active session directly | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| HIST05 | Delete parent succeeds then subcollection batch fails; restart worker | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| HIST06 | Session row vanishes while confirmation open; replacement row reused DOM | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| HIST07 | History/routes/drivers listener independent errors Retry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### DATA

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| DATA01 | Queue passenger self-deletion request and repeat | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA02 | Admin/operator attempts deletion, forged uid, revoked token | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA03 | Privacy worker batches>200, partial failure and restart | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA04 | Privacy cleanup while unrelated active sessions/users exist | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA05 | Auth deletion succeeds/fails before/after other cleanup | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA06 | 180-day terminal history cutoff−1/exact/+1, active very old | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA07 | Retention `recursiveDelete` failure after parent removal | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA08 | Current/in-flight reroute geometry older/newer than 24 h grace | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA09 | Concurrent new geometry write while cleanup scans old record | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA10 | Undated/malformed legacy records | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA11 | Legacy RTDB users/messages with unknown external consumers | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA12 | Dryrun counts vs actual isolated cleanup and retry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA13 | Retention and manual history delete same session two replicas | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| DATA14 | Backups/restore into disposable project | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### SEC

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| SEC01 | Client SDK writes directly to sessions/live buses/chat/feedback/settings/profiles | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC02 | Read each collection as anonymous/passenger/admin/assigned/unassigned operator | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC03 | Alter custom claims/profile role from client; forge admin body | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC04 | Missing/invalid App Check where enforced, valid debug isolated, valid real S5 | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC05 | Cross-origin allowed/disallowed/tunnel, origin missing and credentialed preflight | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC06 | CSP: Maps/Auth/App Check/RTDB/backend origin allowed vs unapproved script | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC07 | Strings with HTML/JS/URL schemes across chat/feedback/names/place labels | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC08 | Prototype keys/__proto__/constructor/path separator/query duplicates | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC09 | Device brute force and scrypt concurrency; credential cache LRU overflow | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC10 | Auth identity rate behind shared NAT; replicas with same UID | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC11 | HTTP request oversize malformed chunk invalid Content Type and proxy header spoof | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC12 | Inspect frontend export/source maps/logs/trace/HAR/diagnostics | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| SEC13 | Dependency lock install/audit:production and dev separate | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### API

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| API01 | Every 59 operation H01–H18; enumerate aliases | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| API02 | Public `/health` vs admin `/api/health` | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| API03 | Readiness partial Firestore/RTDB failure, cached snapshot expiry | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| API04 | Production missing CORS/RTDB instance/retention config at startup | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| API05 | Write 30/identity/min, global 200/min, route compute 10/min, plan 30/min where current | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| API06 | Durable operation processing/succeeded/failed; 16..128 ID; body hash conflict | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| API07 | Durable operation deadline ambiguous upstream outcome | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| API08 | Requests PATCH/DELETE valid invalid status actor ownership | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| API09 | Buses collection/single snapshots stale unknown ID and auth | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| API10 | Analytics live status vs device presence and clock clamp | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| API11 | Diagnostics body 1023/1024/1025 bytes, report shape auth, retention | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### OBS

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| OBS01 | Ingest same correlated sample through server/RTDB/browser/marker | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OBS02 | Actual settled position within 5 cm target with wrong context/held position | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OBS03 | Browser clock offset unavailable/wall jump/server restart | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OBS04 | OTLP disabled/unavailable/slow/export error | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OBS05 | Background tab/reduced motion/long RAF gaps | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OBS06 | Trace 25,000 record cap, clear/download/health download/scenario invalid | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OBS07 | Match payload size/listener connections/reads/writes/provider usage same window | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| OBS08 | Alert on injected store failure/dropped telemetry/increased p95/worker lease failure | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### FW

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| FW01 | Inject labelled NMEA stream valid/no-fix/checksum error/noise | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW02 | Fix/location/speed/course/HDOP age around 5 s | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW03 | Speed 2.5 moving/1.5 stopped thresholds and three consecutive observations | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW04 | Moving/stopped/uncertain cadence with real clock | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW05 | Queue 0/1/120/121 samples, overflow and stale 55 s | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW06 | Warm reset mid metadata/sample write and CRC corruption | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW07 | Full power loss before/after flash checkpoint | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW08 | Journal torn write at every byte/interrupted erase/wrap/corrupt tag/wrong key/context/layout | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW09 | Storage absent/old partition/read failure/unknown write outcome | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW10 | Legacy plain Arduino board with stock flash core dumps + dedicated journal build | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW11 | Device HTTP 200/202/408/425/429/5xx/401/403/permanent 4xx/transport error | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW12 | Retry 1..30 s jitter, Retry-After up to 5 min, sample expires before attempt | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW13 | Response Content-Length 0..1024/exact/truncated/oversize/Transfer-Encoding/trailing bytes | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW14 | TLS valid/wrong CA/wrong hostname/expired/not-yet-valid certificate / clock | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW15 | GNSS UTC valid/invalid, SNTP fallback, 2038/rollover/64 bit millis | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW16 | Wi-Fi/GNSS/radio loss/reconnect with queued fixes | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW17 | Watched task stall>25 s, controlled brownout during armed ride | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW18 | Diagnostics failure 429/5xx/transport and backoff 5..60 s | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW19 | OTA manifest sequence new/old, invalid hash / length / magic, signature failure | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW20 | OTA check active ride/lock, disabled release/no eligible version | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW21 | Secure fleet build missing keys/insecure macro/mismatched config | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| FW22 | Spare board Secure Boot V2/encryption/download lockdown/signing custody | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### WEB

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| WEB01 | SW first install/update while active or joined ride vs idle | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB02 | Offline cold load vs warm cached shell; private API requests | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB03 | SW cache old assets/new HTML/deployment rollback | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB04 | Notifications/install prompts only if current feature exists | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB05 | Chromium/Firefox/WebKit, mobile touch/iOS Safari/Android Chrome | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB06 | 360×800, 390×844, 768×1024, 1280×800, 1920×1080; zoom 200/400% | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB07 | Slow CPU/network, low memory, high DPR, landscape, safe-area insets | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB08 | CSP/CORS/Google keyreferrer/Auth domain/App Check on actual deployment | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB09 | Robots/sitemap/manifest/404/icons and social metadata where present | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB10 | Clock/timezone Asia/Calcutta/UTC/DST/locale, long RTL names | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB11 | Network mock with SW blocked and separate SW-enabled suite | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| WEB12 | Browser permissions: geolocation allow/deny/revoke and insecure origin | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

### REL

| Case | Planned action | Current result and next evidence |
| --- | --- | --- |
| REL01 | Future clean install with lockfiles and Node 24/Java 21 where current CI requires | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| REL02 | Root script/unit/component/rules/contracts/build/audit gates | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| REL03 | Strict production export with required environment vs placeholder container smoke | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| REL04 | Firmware native/dev/journal/secure builds | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| REL05 | Main exact green SHA deploy workflow vs testing branch | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| REL06 | Staging/prod project mapping, managed image digest, rollback | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| REL07 | Backend origin changed from tunnel, DNS/TLS/CA/key/CORS/CSP/auth changes | NOT_RUN — execute the complete current-source oracle and boundary matrix. |
| REL08 | Backup restore/retention enable/monitoring/WAF/quotas/owners | NOT_RUN — execute the complete current-source oracle and boundary matrix. |

