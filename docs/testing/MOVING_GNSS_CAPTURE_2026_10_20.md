# Armed moving capture — 20 October 2026

Last updated: 2026-10-20 18:56 IST (UTC+05:30).

Recording has ended. This report allocates the retained observations to all 64
unchecked requirements in issues #245, #246, #300 and #337. There is one native
subissue relationship (#245 → #300); checklist rows are not 64 GitHub subissues.
The evidence supports diagnosis and scoped software repairs. It does not close
any complete field or production acceptance requirement.

## Observation and integrity

- Observation window: **16:59:36–18:03:36 IST**, with stream interruptions below.
  Owner departure/end reports were about 48 minutes 41 seconds apart; their
  physical event timing uncertainty was not measured.
- One existing forward service progressed from waiting at the origin to in service
  with a published `currentStopIndex` of 5. It remained active at the final read.
  Completion, automatic return, boarding, chat and feedback were not exercised.
- Private evidence contains 2,042,039 exact serial bytes, 11,635 decoded lines,
  two scoped database/cloud segments, bounded host/network measurements, source
  and local artifact identities, browser console/DOM/screenshots and original app
  trace exports. The 27 Admin-view exports merged to 11,187 contiguous event IDs;
  25 Passenger-view exports merged to 13,202. View labels do not prove distinct
  authenticated roles.
- The verified private archive has 319 files. ZIP CRC and every archived file
  SHA-256 were checked. Archive SHA-256:
  `383b4c146cdcf1ebe200fffa13b5e2e81cc98e171cf149d1c40c6338745dd6e0`.
  An off-device backup was not established. Raw locations, session/device IDs,
  request IDs, credentials and personal data are omitted from this report.
- The source checkout was `3a1486bddbe8acc44b460060e6573508b15e88c9` with retained
  local changes. The testing baseline was `a41f3f801b568cf17c15e05bb12abd0911f0b570`.
  Local image hashes do not attest the installed firmware or receiver identity.

## Coverage interruptions and qualified measurements

Serial observations include 1,239 classified requests: 1,054 HTTP 202, 103
transport -1, 81 transport -11 and one HTTP 400. There were 626 unique accepted
moving sample identities on one device. This is not a 1,000-sample fleet-contention
experiment. The 53 malformed/interleaved trace fragments and original bytes are
preserved.

The cloud inspector observed 2,555 HTTP 202, one HTTP 400 and one HTTP 503 across
the healthy segments. The 503 response reported **commitState unknown**; it must
not be counted as definite loss or definite rejection. A serial timeout can also
coincide with backend acceptance. Backend internal dependency/stdout logs and
protected detailed health were unavailable, preventing a complete root-cause
assignment for the remaining transport failures.

Serial USB observations were absent for about 14 minutes 29 seconds, with 864
port-retry errors. The physical cause was not established. The original 45-minute
ceiling ended serial/host recording at 17:44:36 IST; the proposed successor was
not verified. Cloud/database/sensor collection resumed separately, with an
approximately 78-second handover gap. The original cloud collector also failed
at startup on absent Admin SDK snapshot metadata; its failure and repaired
successor are both retained. These are observation failures, not invented device
or cloud outages.

Independent raw-node callback intervals included 195.225 seconds before the
reported drive, 90.192 seconds during missing USB observations, and 134.997
seconds near the reported basement entry. These measure this observer's intervals,
not packet loss or exact one-way latency. The owner confirmed basement entry,
without an exact time or confirmed device/USB/hotspot shutdown.

The original serial-correlated latency report's approximately 869.5-second
interval spans missing USB evidence. [PR #339](https://github.com/notnamansinha/Eki/pull/339)
repairs browser cadence analysis and labels serial-observed intervals explicitly.
Replaying the saved exports produces a largest browser-listener interval of about
195.6 seconds. It remains qualified by browser recording and suspension context;
it is not an independent display-paint measurement.

Windows Time reported an unsynchronized local clock. Cross-clock estimates retain
four-timestamp/Firebase offset and uncertainty qualifications. Authorized laptop
location observations had coarse reported uncertainty and an unverified source;
they are not independent GNSS truth. Natural reroutes and off-route warnings were
recorded, without a surveyed reference to establish physical false snaps.

Only application `eki-telemetry` exports were found in the checked download
locations. **Saved Chrome Network HAR and Performance traces were unavailable.**
The user reported stopping a recording, but no saved file was verified. Available
browser controls could not operate DevTools, and the internal Downloads page was
blocked. No alternate browser-internal access was used.

## Requirement-by-requirement allocation

These are the frozen capture classifications: **30 OBSERVED_PARTIAL, 29 NOT_RUN,
5 BLOCKED, zero PASS**. A row's brief observation cannot replace its full linked
issue requirement. Software regressions, actual cloud observations, physical
acceptance and owner policy decisions remain separate evidence tiers.

### [Issue #245](https://github.com/notnamansinha/Eki/issues/245)

| ID | Requirement | Capture status | Recorded scope |
|---|---|---|---|
| 245-01 | Moving ride/demo (#51/#149): verify outdoors forward/reverse routes, parallel/divided roads, pending direction and endpoints, ordered stops, final-stop completion, return dwell, all browser roles, restarts and preserved history. | OBSERVED_PARTIAL | One armed forward session progressed to currentStopIndex5 and remained in_service at owner end; no automatic completion/return observed. |
| 245-02 | Latency/transport (#149/#159/#191/#194/#195): complete role/profile-specific first-paint and message timing, clock uncertainty/visibility evidence, controlled weak-network recovery, payload/physical-connection counts and matched Firebase/Google usage; finalize measured transport ADR and geometry budgets. The short-drive device/cloud/React-marker baseline is preserved in the consolidated comment. | OBSERVED_PARTIAL | Both views have contiguous exported event IDs; serial HTTP/browser timing reports retained with clock and recorder-gap qualifications; no exact physical paint or billed usage. |
| 245-03 | Live route editing (#149): verify real Places/provider failures, stop swap/reorder and saved persistence, independent directional geometry, metadata-only call budgets, uncertain save/retry and conflicts. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-04 | Physical network recovery (#56): verify GNSS/radio/Wi-Fi interruption, certificate/hostname validation, HTTP failure classes, stale queue drops and fresh store-and-forward recovery. | OBSERVED_PARTIAL | Natural TLS/HTTP failure/recovery and stale-queue diagnostics retained; no deliberate hotspot/GNSS interruption. |
| 245-05 | Watchdog/brownout (#60): obtain dedicated board/current-limited supply; test >25s task stall and brownout during an armed ride; verify reset counters, queue integrity and same-session recovery without duplicates. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-06 | Managed hosting (#52/#122): establish billing, runtime/domain and operational owners, staging/production boundary and least-privilege secrets; deploy immutable backend with region/scaling limits, worker restart, replica failover within 2s clock tolerance and rollback. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-07 | Endpoint cutover (#119/#122/#169): verify owned DNS/TLS/CA and matching firmware/frontend origin, CSP/CORS/OAuth/API-key restrictions; perform approved region cutover and ingestion/reconnect/drive checks; retire tunnel/debug credentials. | OBSERVED_PARTIAL | Local frontend/backend Firebase alignment and actual HTTPS tunnel checked; no owned production cutover or tunnel retirement. |
| 245-08 | Fleet security (#42/#52): establish approved signing-key custody and tested replacement/recovery plan before witnessed secure provisioning, flash encryption/download lockdown and signed OTA trials. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-09 | Production operations (#52/#122): deploy WAF/rate limits, quotas, monitoring/alerts and 180-day retention; rehearse backup/restore and obtain incident/privacy/backup-erasure owner sign-off. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-10 | Legacy retention (#214): inventory external RTDB users/messages consumers and timestamp provenance; approve cutoff, dry-run retirement with active/in-flight protection, and rehearse partial failure/replica recovery before enabling purge. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-11 | R02: measure real fleet admission and provider/RTDB latency under deployed load, then moving-route state/history recovery. | OBSERVED_PARTIAL | One selected bus/device observed with real cloud projection and browser updates; fleet admission/load acceptance not established. |
| 245-12 | R07: independently attest stopped owning replica, verify real Auth claims/revocation/RTDB mirrors, provider usage and unknown-ack recovery across deployed replicas; measure load/latency. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-13 | R09: verify real Auth/revocation/mirrors and stop-attested recovery; run beyond-cap fleets/backlogs against live indexes and measure deployed load/latency. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-14 | R10: verify real Auth failure/revocation/recreated UID, executor-stop attestation and unknown external effects; quiesce console/CLI/cached/in-flight clients across replicas and verify late writes with privacy/backup sign-off. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-15 | R12: measure deployed route edit/deletion propagation, reconnect/read billing, delayed/uncertain publication ordering and replica load; verify provider/road and moving-route correctness. | OBSERVED_PARTIAL | Raw/public projection and reroute geometry changes retained; route edit/deletion and provider billing not exercised. |
| 245-16 | R13: exercise authorized legacy-route repair, active-ride/stale-version rejection, provider/caches/watch propagation, compute saturation and global replica/provider budgets; correlate cloud usage/latency and moving-route results. | OBSERVED_PARTIAL | Natural rerouting/movement retained; no legacy repair, saturation or approved route mutation. |
| 245-17 | R14: deploy matching backend/status endpoint, canonical projection backfill/current-generation schema, restrictive RTDB rules and browser artifact; measure moving/replica egress and latency. | OBSERVED_PARTIAL | Selected raw/public schema, status/catalog nodes and local served frontend asset inventory retained; no release deployment/backfill/rules acceptance. |
| 245-18 | R19: deploy activeBuses timestamp RTDB index before indexed scans; verify beyond-cap backlog, failed-page cursor retention, replica/session replacement and moving ambiguity/reacquisition. | OBSERVED_PARTIAL | Scoped moving/recovery state retained; beyond-cap/index/cursor failure partitions not exercised. |
| 245-19 | R20: migrate/inventory supported, external and fleet callers; collect billed cloud usage/latency and 90-day compatibility plus 30 consecutive days without supported legacy traffic; communicate release and obtain owner approval before removing adapters. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-20 | R31: verify production collector, sampled error/span behavior, startup/module profiling, RSS/CPU and sustained representative load. | OBSERVED_PARTIAL | Host/process/interface resources captured until recorder ceiling; backend internal collector/startup profiling/representative fleet load unavailable. |
| 245-21 | R35: verify persisted per-ride jitter/backoff/restart and each replica circuit through actual provider outage/recovery, including crash-stranded rerouting claims. | OBSERVED_PARTIAL | Dynamic reroute geometry/version changes and warnings retained; no actual provider-outage/circuit/replica test. |
| 245-22 | GNSS plausibility/marker recovery: verify 200 km/h cap, three-fix corroboration, implausible jumps, physical acquisition/reacquisition, parallel roads, interrupted-ride freshness and 24-hour orphan cap; compare projections/history after loss/restart. | OBSERVED_PARTIAL | Raw/matched quality, freshness, sequence and held-state evidence captured; absolute plausibility truth and 24h orphan tests unavailable. |
| 245-23 | HTTPS/backend-only recovery: correlate remaining -1/-11/-5 transport failures with backend logs; verify TLS/backend outage retries, fresh-only publication and stale drops after repeat hotspot outages. | OBSERVED_PARTIAL | Serial103 transport-1 and81 transport-11 events; inspector503 unknown commit and health errors retained; no internal backend dependency logs or approved outages. |
| 245-24 | Credential faults: verify physical diagnostic and OTA-discovery rejection/recovery, invalid-secret rotation/reflash and secure-fleet equivalents; keep Wi-Fi available during configuration rejection. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-25 | Secure hardware evidence: record board/source/firmware/package hashes, receiver MON-VER, effective sdkconfig/ELF/map and JTAG setting/eFuse; witness encryption/checkpoint power-loss recovery and first-boot NTP/TLS/GNSS corroboration after signing/recovery prerequisites. | OBSERVED_PARTIAL | 7 local firmware/configuration artifact hashes saved; not attestation of flashed image, receiver or secure state. |
| 245-26 | Signed OTA field trials: on stopped GNSS-verified secure hardware, reject wrong key/digest/version and regressing release sequence; interrupt update and exceed five-minute validation in Wi-Fi dead zone; retain rollback/healthy-image hashes. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-27 | Release query readiness (R11): rerun all seven real Firestore query shapes against the final release environment and verify actual queue/recovery sweeps; retain exact FAILED_PRECONDITION diagnostics and index remediation if any. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-28 | Environment/browser acceptance (#204): verify release database/secret alignment, deployed authentication/authorization, registered OAuth hostname/API-key restrictions and current CSP/CORS/browser artifacts; restart after environment changes and test affected second-admin Fleet/Routes/retry plus driver route behavior. Preserve the owner-approved removal of browser/API App Check (#322). | OBSERVED_PARTIAL | Firebase project/database/tunnel and available local views verified; genuine separate roles and release hostname/API restriction acceptance unavailable. |
| 245-29 | Privacy recovery: separately test crashed executor and still-running/hung Auth call; prove exact executor stopped, check generation/audit and unknown external effects before destructive retry. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-30 | Durable restore backlog: verify deployed multi-replica/process-failure recovery, saturation above 1,016 simultaneous distinct rides and explicit interruption semantics. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-31 | Lifecycle failover: terminate owner between RTDB retirement and Firestore completion and around lease renewal/expiry; verify no duplicate session, stranded lock, stale marker or unexplained ~45s recovery delay. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-32 | Legacy records: inventory terminal rides missing endTime and oversized RTDB records; approve bounded backfill/quarantine and rehearse partial sweeper failure/restart with privacy/backup-erasure sign-off. | OBSERVED_PARTIAL | Scoped selected-bus historical session docs retained and pinned; no global legacy inventory, backfill, quarantine or destructive sweep. |
| 245-33 | Drive/contention thresholds (#159/#160/#174): extend the collected normal-hotspot moving latency baseline to controlled poor-network/reconnect phases; collect 1,000 moving contention samples and compare warm baseline/candidate fleet/replica/region transactions/retries and five-token lease. | OBSERVED_PARTIAL | 626 unique accepted moving serial samples; one device only, no fleet contention or matched billing window. |
| 245-34 | Direction/matching/reroute thresholds (#162/#164/#167): validate recorded and real adaptive envelope/endpoints, multipath, intersections, loops/geofences, U-turns/wrong turns, immutable direction, completion/dwell turnaround and visible reroute latency/false snaps. | OBSERVED_PARTIAL | Forward stop/progression, reroutes and two browser off-route warnings observed; no independent GNSS truth or completed turnaround. |
| 245-35 | Firmware cadence/capacity (#168): measure real timeout/retry, duplicate/backlog/bandwidth and stopped/moving hysteresis; verify responsive acquisition and backend capacity before changing parked cadence. | OBSERVED_PARTIAL | Stopped/moving serial cadence, retries and queue diagnostics captured around explicit gaps; backend capacity not tested. |
| 245-36 | Browser suspension/PWA: verify prolonged suspension, update during active ride and network/Google failure/recovery on passenger/operator/admin clients with synchronized evidence. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-37 | Release sign-off: retain redacted timestamps/logs, source/flashed-firmware hashes, Hosting revision/image digest, DNS/TLS/rollback and matched usage windows; obtain named owner acceptance. | OBSERVED_PARTIAL | Source/local artifact/recorder identity and private evidence retained; release rollout/rollback/usage and named acceptance remain absent. |
| 245-38 | SEC-01 / #315 â€” Against the approved staging deployment, retain redacted saved-ID-token evidence for driver unassignment/demotion, reassignment to another Auth UID, deletion, and admin demotion/restoration. Verify old tokens lose protected Firestore/RTDB and HTTP access, current authorized accounts retain access, and authorization publication/retry failures cannot report successful offboarding while stale access remains. Record deployed backend/rules revisions and authorization claims/backfill status. Keep the complete Auth/Firestore/RTDB workflow distinct from disposable-emulator evidence; complete claims backfill before admitting admin traffic. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 245-39 | SEC-03 / #317 â€” On approved stopped GNSS-verified secure hardware, retain redacted source/firmware/package/build hashes and Device-only reservation evidence for signed OTA acquire/install/release, interrupted installation, abort/reboot and failure recovery. Verify ride/conflicting-reservation exclusion and owner-only release throughout. Emulator/native tests do not establish physical OTA acceptance. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |

### [Issue #246](https://github.com/notnamansinha/Eki/issues/246)

| ID | Requirement | Capture status | Recorded scope |
|---|---|---|---|
| 246-01 | R11: complete protected release-environment index-first deployment and real retention/collection-group deletion/recovery sweep acceptance; current-project read-only readiness does not certify destructive outcomes (live gates in #245). | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 246-02 | R20: migrate/inventory supported, external and fleet API callers; retain 90-day compatibility and 30-day no-supported-legacy-traffic evidence, release communication and owner approval before adapter retirement (#245). | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 246-03 | R30: deploy and verify a redacted device-silence alert following credential rejection; establish managed runtime/collector/monitoring prerequisites (#245). | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 246-04 | R34: complete remaining physical, deployed-browser and cloud acceptance in #245; independently verify the flashed image, effective toolchain/package/sdkconfig/ELF/map identity and receiver MON-VER. The retained local-build hashes and short moving latency baseline do not establish installed-image or full-route acceptance. | OBSERVED_PARTIAL | Local hashes and real armed forward observations retained; installed image/MON-VER and complete secure field acceptance absent. |
| 246-05 | R36: decide optional parked heartbeat/cost policy with coordinated freshness/presence/start/turnaround measurements, boarding-code lifetime/rotation, passenger-accuracy/fix-age bounds, zero-dwell return behavior and dedicated offline-shell need; implement approved changes only. | OBSERVED_PARTIAL | Parked/moving/presence and operational lifecycle values retained; no parked-cadence policy adopted or code changed. |
| 246-06 | Decide whether independent release-metadata signatures are required in addition to mandatory RSA-3072 image signatures and descriptor version/sequence checks; implement if adopted. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |

### [Issue #300](https://github.com/notnamansinha/Eki/issues/300)

| ID | Requirement | Capture status | Recorded scope |
|---|---|---|---|
| 300-01 | Record an independent position/time reference, its measured uncertainty and synchronized device/backend/RTDB/browser clocks. Compare along/cross-track error, false parallel-road snaps, marker freshness and lifecycle progression with the reference during safe owner-controlled forward/reverse/turnaround drives. Preserve exact source/flashed image, receiver MON-VER, antenna installation, environment and redacted evidence timestamps. | BLOCKED | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 300-02 | Distinguish measured cold/warm/hot receiver start setup and first valid/usable fix; do not label a software restart a receiver cold start without the correct receiver-state setup. Repeat stationary baseline and moving acquisition/reacquisition under representative sky/antenna conditions. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 300-03 | Verify plausible gradual drift, multipath, adjacent-road ambiguity and quality loss followed by recovery; include fixes that remain inside per-step jump limits. Assert conservative confidence/freshness and no false boarding, stop progression, completion or direction flip. | OBSERVED_PARTIAL | Natural rerouting/freshness degradation and basement-associated warning observed; false-snap/absolute accuracy claims blocked by missing independent truth. |
| 300-04 | Run coupled recovery windows under safe conditions: GNSS loss plus Wi-Fi loss; device reboot plus queued telemetry plus backend reconnect; browser suspension during outage followed by resume. Correlate authoritative session, raw/accepted/matched location, queue drops/retries and observed marker after recovery; distinguish unknown write outcomes from definite rejection. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 300-05 | Compare seeded expectations with observed field behavior without promoting software PASS to field PASS; add a controlled degraded/recovered phase to the recorded normal short-motion phase, with drive bounds, operator responsibilities and stop/abort annotations. Specialized RF vulnerability work still requires an approved contained bench facility; no RF interference/jamming/spoofing is authorized. | OBSERVED_PARTIAL | Normal motion plus labelled naturally degraded/recovered intervals retained; no deliberately injected compound faults or RF work. |
| 300-06 | Define acceptable measured accuracy/fix-age/recovery limits and named owner sign-off before declaring field acceptance. Unavailable instruments, actual receiver setup or safe drive conditions remain BLOCKED, never synthetic passes. | BLOCKED | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 300-07 | Drive the full forward and reverse route with a safe owner-controlled vehicle: pending and resolved endpoint direction, ordered/close stops, departure evidence, final completion, configured zero/nonzero turnaround dwell, U-turn/wrong-turn/parallel-road ambiguity and preserved original passenger history across a distinct return session. Correlate passenger, operator and admin views. | OBSERVED_PARTIAL | Forward service currentStopIndex5, directionforward, departed origin; owner ended while service stillactive. No completed/return session or boarded history. |
| 300-08 | Extend the captured normal-hotspot moving baseline (202 accepted serial moving samples, 106 correlated Passenger React samples) to controlled poor-network/reconnect profiles and collect 1,000 moving contention samples; retain actual paint/message boundaries, clock-offset uncertainty and matched baseline/candidate cloud usage. The measured short-run p50/p95/p99 and gaps are preserved in the consolidated comment. | OBSERVED_PARTIAL | One-device moving/browser timing observations retained, with626 accepted moving serial identities and qualified clocks; no1000 fleet-contention pass. |
| 300-09 | Exercise current-session recovery during approved backend owner/replica restart or partition while driving safely, including lease expiry/renewal, unknown acknowledgements, queued old writes and delayed reroute results. Verify no duplicate return session, stranded lock, unexplained marker disappearance or overwritten replacement ride; retain exact image/source/firmware hashes. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 300-10 | Test real mobile passenger/operator/admin suspension, resume and PWA update during an active ride and combined network/provider interruption. Verify identity, boarding state, geometry/ETA, chat and history after recovery; distinguish actual browser/provider observations from synthetic adapters. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 300-11 | Obtain named owner acceptance of measured movement/freshness/accuracy/latency/recovery thresholds and retained evidence. Real provider/staging access, safe drive logistics and independent timing/position instruments must be arranged explicitly; no unattended live mutations or road/RF fault injection are authorized by this checklist. | BLOCKED | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |

### [Issue #337](https://github.com/notnamansinha/Eki/issues/337)

| ID | Requirement | Capture status | Recorded scope |
|---|---|---|---|
| 337-01 | Investigate deployed archived-message permission denial with the intended Admin identity, deployed rules/claims and browser resource-blocking evidence; verify archived-message recovery. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 337-02 | Recheck the operator-form validation and unselected-destination fixes from merged PR #336 on the current deployed artifact at desktop and exact 390/360 CSS-pixel widths; the source/regression repairs are complete, while deployed acceptance remains pending. | NOT_RUN | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 337-03 | Finish the genuine Passenger-role and remaining Admin/Passenger feature/state census, including Settings/Feedback, navigation/logout/reload, provider/permission failure paths and appropriate disposable fixtures for writes/deletes. Earlier ADMIN/DRIVER sessions do not establish Passenger-role acceptance. | BLOCKED | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 337-04 | Run an armed service with boarding, walking/vehicle ETAs, real chat delivery, completion/feedback, restore/history and automatic return; movement without a session cannot complete these gates (#245/#300). | OBSERVED_PARTIAL | Armed active service observed; boarding, chat, feedback, completion/history restore and automatic return not exercised. |
| 337-05 | Diagnose the remaining device -11/-1 transport failures and previously observed degraded-health/67-second delivery gap; correlate same-attempt device/HTTP/backend/dependency evidence, controlled network/backend recovery and fresh marker observations. Three captured read timeouts had inspector HTTP 202; their device acknowledgement is unknown. | OBSERVED_PARTIAL | Raw serial-1/-11, inspector400/503unknowncommit, health failures and independent cloud observer gaps retained; backend internal logs missing. |
| 337-06 | Complete visibility/suspension-aware browser timing and independent paint observation across all roles/network profiles, including missing render/target correlations and the sparse Admin capture; exact one-way latency remains qualified by clock uncertainty. | OBSERVED_PARTIAL | Contiguous two-view application traces and bounded console/DOM/screenshots retained. Saved Chrome HAR and Performance files were unavailable. |
| 337-07 | Complete independent GNSS-reference accuracy, verified installed firmware/receiver identity, acquisition/reacquisition and controlled compound-fault acceptance under #300; the new continuous serial/cloud/HTTP exports and 100-plus moving Passenger timing pairs are recorded in the consolidated comment. | BLOCKED | Required partition not exercised; related scoped provenance/operational observations do not establish acceptance. |
| 337-08 | Finish the strict acceptance ledger and remaining offline/timeout/race/fix-loss/multiple-bus/provider/role matrices; do not turn static source coverage or unit/mock success into full live or release certification. | OBSERVED_PARTIAL | 64-row strict ledger produced with explicit missing partitions; no offline/role/provider/race/fleet completeness or release certification. |

## Remaining work by area

1. **Software diagnosis:** retain the uncertain 503 outcome and serial recorder
   gaps; collect matched backend dependency evidence before assigning -1/-11
   causes or changing transport policy. New browser instrumentation applies only
   after deploying the matching artifact; it does not repair old evidence.
2. **Live journeys and roles:** use genuine separate Passenger/Driver/Admin
   identities, complete real forward/reverse routes and return dwell, and verify
   boarding/chat/feedback/history/provider and deployed 390/360-pixel matrices.
3. **Physical measurement:** arrange an independent reference and verified
   installed image/receiver, then safe acquisition/reacquisition and explicitly
   approved compound recovery. Dedicated secure hardware and a controlled supply
   are needed for provisioning, OTA and brownout/stall experiments.
4. **Deployment and long-duration gates:** establish managed runtime/collector,
   owners, staging boundaries, release indexes, replica/load and rollback evidence.
   The required 30/90-day compatibility windows cannot be replaced by this drive.
5. **Owner decisions:** parked heartbeat/cost policy, optional release-metadata
   signatures, measured accuracy/freshness/recovery limits and release sign-off
   remain decisions to make explicitly before adopting changes.

Use the [field acceptance guide](../../qa/FIELD_ACCEPTANCE.md) and
[current issue checklist](https://github.com/notnamansinha/Eki/issues/245) for
execution prerequisites. This report authorizes no new live mutations, provider
load, secure provisioning, physical faults or acceptance sign-off. No checkbox
was checked merely because evidence was archived or a software regression passed.
