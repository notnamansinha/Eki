# Non-moving webapp readiness — 9 October 2026

The current request expands earlier R01–R15 work to remaining webapp software
and stationary checks, excluding physical moving tests. The change is based
on `testing a66f916` and targets `testing` through a PR. No deployment, firmware
flashing, account privilege change or destructive cloud-data test is included.

## Repaired behavior

- Continuous 1 Hz input no longer prevents restart projection readiness;
  leadership and newer-revision fences remain tested.
- Dashboard, fleet and passenger markers expire using a running clock even
  when no further snapshots arrive.
- Firebase Auth initializes one persistence hierarchy rather than repeatedly
  migrating persistence during account resolution. The observed Google
  network error remains a network/provider failure with recovery controls;
  software cannot guarantee Google connectivity.
- A joined passenger reload restores only their own validated boarding from
  backend status. The local pointer contains only a per-account session ID and
  timestamp, expires after 24 hours and cannot grant membership or reveal codes,
  tokens or coordinates. Account switches and terminal sessions fence recovery.
- Admin History includes both boarding and alighting stop names. Settings
  submits edited allowed fields rather than Firestore `updatedAt` metadata.
- Reassigning a device retires its old public bus presence immediately. A
  durable pending retirement can be retried after cross-store failure; revision
  tombstones prevent an already authenticated old sample reviving that entry.
  Active rides, replacement devices and newer assignments remain protected.
- New admin chat records have the administrator sender role and role badge
  rather than being typed as operator messages (R22). Older stored records are
  not backfilled.
- R30 adds rollover-safe diagnostic scheduling, optional complete extended
  health reports and redacted process-scope reason/schema counters. New health
  fields require installing the new firmware; existing devices remain compatible.
- R32 adds HTTPS client validation and bounded optional API App Check
  verification, with separate exact device authentication. The owner permits
  authenticated live fleet viewing by any Google account. Deployment enforcement
  remains staged, as documented in [API security](../operations/BROWSER_API_SECURITY.md).
- Trace controls are explicit opt-in and telemetry correlation normalizes
  device sample/sequence keys without changing authority or freshness policy.

## Actual stationary browser evidence

[The 9 October browser record](WEBAPP_READINESS_2026_10_09.md) documents actual
Chrome on port 3000: existing passenger sign-in, route/stop selection, real
nearby boarding, repeat deduplication, reload recovery, populated admin History,
service end and persistent interrupted history. Settings retry saved through
the real backend after the metadata repair. Original device assignment and
allowed routes were restored, with no active ride or bus lock.

The device has since been relocated while stationary. No moving arrival or
completion time is fabricated. The short `qa-stationary-20261009` route is
approximately 0.7 km. The 1,355.5 km legacy entry displayed in Routes is
**Vaishnodevi to Campus (`Route-1`)**; **meowmeow (`route_01`) is 1.3 km**.
The owner authorized using a short QA route rather than repairing old test
geometry. The legacy route is preserved and excluded from a moving test plan.

The final evening Chrome check restored admin access and showed one online
Bus01, stopped, with zero services. Browser-control timeouts required a fresh
tab; History then loaded and expanded the real one-passenger manifest with both
stop names and no destination time. Earlier settings/boarding observations
retain their own run window; no new passenger journey is inferred.

All six admin panels loaded in the final tab. Feedback filtering/detail worked;
the owner's existing `test2` record was changed from reviewed to resolved,
then restored to reviewed and rechecked after reload. No new feedback/message
was sent. Bus01's original display name and sole allowed route were checked in
the editor, then canceled untouched. The short QA route rejected an empty name;
swap and move-up controls changed only the unsaved draft, which was canceled.
Settings loaded its original values with a disabled No changes button. These
observations cover these controls, not every cloud failure/conflict/delete case.

## Local software verification

| Gate | Result |
| --- | --- |
| Backend unit/HTTP suite | 950 passed after adding the generated frontend instruction-file mirrors; 46 integration cases skipped in the unit invocation |
| Frontend suite | 631 passed across 76 files |
| Actual loopback Firebase integration/rules suite | 46 passed in the separate emulator invocation |
| Synthetic desktop/mobile browser suite | 20 passed with the real app components and synthetic SDK/HTTP providers |
| Script tests | 75 passed |
| OpenAPI / UI contracts | 71 registered operations / passed |
| Frontend/backend lint | Passed |
| Strict production build | Passed with CI-only public placeholders, backend TypeScript, static export, service worker and CSP contract |
| Dependency audits | Runtime and full dependency audits: zero vulnerabilities |
| Stalled-work admission benchmark | Passed 250,000 synthetic submissions, bounded retained work/heap, recovery and FIFO; no live fleet/provider calls |
| Firmware native suite | 83 passed across nine suites |
| Firmware development / quiet / journal / secure | All four builds passed; ESP-IDF builds used an isolated short-path copy with example-only credentials; secure used an ephemeral test signing key |
| Firmware artifact guards | Development trace marker present, quiet trace marker absent, strong pre-application SNTP guard linked |

The new emulator retirement test initially used an incorrect WorkerFence API;
it was corrected and the complete 46-case run passed. Initial browser fixture
failures were corrected to model valid SDK App Check token reuse; final checks
assert attestation on both GET and PATCH without removing authorization checks.
Windows ESP-IDF builds use short paths; stale ignored generated sdkconfig was
removed only from the isolated copy. Strict export's generated CI-host CSP was
not retained in deployment configuration. Private logs, real locations, tokens,
firmware keys and screenshots stay in ignored `temp/` or isolated test folders.
The local Docker daemon was unavailable; the PR's required backend-image
build/boot smoke job must pass in GitHub CI before merge.

## Evidence boundaries and remaining external acceptance

All 115 GitHub issues were audited: 113 closed and #245/#246 still open at the
recorded refresh. Closed status alone is not acceptance evidence. R22/R30
software and R32 enforcement capability are included here; issue #246's live
rollout requirements cannot be closed by this local PR.

The full 351-case ledger retains actual partial/NOT_RUN outcomes. Software
regressions do not certify every live Google/provider/affected-account oracle.
Aryan's account acceptance, actual chat/feedback delivery to people, prolonged
real mobile suspension, many-client recovery and complete correlated GNSS to
browser-paint timing still need their specific observed environments. No real
message was sent to another person as an incidental test.

Physical route/fault/secure-board/OTA tests are excluded by the current request.
Production index readiness, replica/hosting cutover, WAF/quotas/backup/alert
ownership, same-window billing, institutional release decisions and the 90-day
compatibility/30-day legacy-traffic windows remain external gates. Those cannot
be certified by an emulator, a firmware build, or one stationary device.

R36 remains a product decision, with existing policies preserved: one-Hz parked
telemetry, eight-character service boarding codes without automatic time rotation,
100 m maximum passenger accuracy, a 60-second accepted bus-fix age limit and
150 m passenger-to-bus joining radius. The separate 20 m stopped endpoint
direction check was not widened. No parked heartbeat/cost, code rotation,
turnaround or offline-shell policy was silently changed.

The optional product changes in R36 are not needed to fix the reproduced
webapp failures. At zero turnaround dwell, the existing automatic return
remains subject to fresh stopped terminal evidence; a dedicated offline shell
and slower parked heartbeat were not introduced without a product decision.

The owner's transient 20:42:06 backend 503 recovered; its exact exception was
unavailable. The subsequent 123 settled requests were all 202 in the recorded
125-second window. This does not establish the original exception's cause or
a complete outage/recovery SLA. See the linked browser record for timings.
