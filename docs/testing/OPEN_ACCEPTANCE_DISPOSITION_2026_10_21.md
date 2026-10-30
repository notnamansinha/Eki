# Open issue disposition after the Downloads evidence review

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-028 | 1.0 | Historical | 2026-10-21 |

This review uses integration baseline
`9b81d826e55d2eae27c3adef0df4beae0caa8189` and the files available in Downloads.
It covers all four open issues and the native #245 → #300 subissue relationship.
The [64 original requirements and oracles](MOVING_GNSS_CAPTURE_2026_10_21.json)
remain authoritative. None of their complete field/release gates is established
by the additional data. The issues must remain open; a software regression
result completes only its stated software sub-oracle.

## Evidence rechecked

- All four field/evidence ZIPs in Downloads passed ZIP CRC validation. The two
  supplied SHA-256 sidecars match. The public package and private 18:18 capture
  overlap; they are not two independent rides.
- All 61 loose `eki-telemetry-*.json` exports parsed successfully. Canonical
  whole-record deduplication within each export run produced six distinct runs
  and 30,007 records. Each run's largest export contains its full observed
  union: repeatedly downloaded snapshots add no independent samples.
- Unique records per anonymous run are 1,657; 1,716; 1,114; 1,131; 11,187;
  and 13,202. Event counts are not counts of physical GNSS fixes.
- Reanalysis with the repository telemetry/realtime analyzers finds zero
  message-attempt/write events in these six runs. They cannot establish chat
  delivery latency. Last two runs contain three and two same-tab RTDB
  disconnect-to-connect intervals, with maxima about 5.743 s and 26.638 s.
  These intervals do not prove backend ingestion, fresh marker recovery or
  physical paint. Application JSON sizes do not measure billed traffic.
- No loose HAR, compressed Performance export or Chrome trace JSON was found
  in Downloads. No HAR/compressed profile is inside the four ZIPs; the named
  browser-trace JSON files are application telemetry, not Chrome profiles.
- The 21 October GPS audit concerns an older captured application. Its ETA,
  direction/progress and marker repairs are already merged in #345. The
  production-readiness audit's confirmed UI repairs are in #344. The audit's
  suggested geofence bypass and turning the acceptance catalog green are not
  valid substitutes for proximity enforcement or executed acceptance.
- The later stopped capture/video and reported LCP/CLS/INP remain covered by
  the [sealed-ride report](MOVING_GNSS_CAPTURE_2026_10_21.md). No missing profiler
  breakdown or independent GNSS truth can be reconstructed from those values.

Raw coordinates, account/session identities, ZIP contents and private analysis
remain local. Public evidence is limited to aggregate observations. Earlier
[19 October](MOVING_GNSS_CAPTURE_2026_10_19.md) and
[20 October](MOVING_GNSS_CAPTURE_2026_10_20.md) measurements retain their original
scope and served/flashed-image limitations.

## Software patch from this review

An access-verification network failure could leave a signed-in account on the
error screen after connectivity returned until the user clicked retry or
reloaded. `useAuth` now performs bounded retries for transient network/deadline
failures, pauses offline/hidden work and resumes on online/visible events.
The current verification flight is shared with manual retries. Fresh trusted
claims are mandatory before publishing access; permission/claim failures are
not automatically retried. Account changes, sign-out and late completions
remain fenced. See [exact retry bounds](../operations/RTDB_RECONNECT_RECOVERY.md).

This addresses software recovery portions of `245-36`, `300-10`, `337-03` and
`337-08`. It does not identify the unrecorded request behind the historical
authentication error or prove a deployed/physical recovery gate.

Focused validation: 27 mounted Auth cases and 32 mobile/desktop browser cases
pass, including the ten-minute virtual-clock offline/online regression.
Firebase SDK/claims are synthetic in these cases; HTTP feedback requests are
intercepted. This is not a ten-minute real Firebase outage experiment.
Two recovery assertions fail against the old baseline and pass with the patch.
Retained synthetic recovery screenshots: [mobile](assets/access-recovery-2026-10-21/mobile.png)
and [desktop](assets/access-recovery-2026-10-21/desktop.png).

## Disposition of every remaining requirement

Every row below remains unchecked. The last column states the next evidence
or decision needed, rather than replacing the full linked requirement.

| ID | Remaining proof or decision |
|---|---|
| 245-01 | Witness full forward/reverse lifecycle, all roles and retained history. |
| 245-02 | Collect role/network paint and real message timing, matched usage; approve transport budgets. |
| 245-03 | Exercise deployed route editing, genuine Places failures and publication/conflict boundaries. |
| 245-04 | Witness actual radio/GNSS/TLS/network failure and fresh-only recovery. |
| 245-05 | Obtain a spare board/current-limited supply and witness stalls/brownouts. |
| 245-06 | Name runtime/billing owners; deploy and exercise regional replicas/rollback. |
| 245-07 | Approve owned DNS/TLS/cutover and retire tunnel/debug credentials. |
| 245-08 | Approve key custody/replacement before witnessed secure provisioning. |
| 245-09 | Deploy operational controls; approve incident/privacy/erasure and restore evidence. |
| 245-10 | Inventory real legacy consumers; approve cutoff and protected purge rehearsal. |
| 245-11 | Measure deployed admission/provider/database load and moving recovery. |
| 245-12 | Attest stopped owner, real claims/revocation/mirrors and unknown-ack replica recovery. |
| 245-13 | Exercise real Auth, beyond-cap deployed fleets/backlogs/indexes and stopped-owner recovery. |
| 245-14 | Quiesce actual clients/executors; witness Auth/privacy unknown-effect recovery with owners. |
| 245-15 | Exercise deployed route propagation, real provider correctness and replica billing/load. |
| 245-16 | Exercise authorized legacy repair and cross-replica saturation/provider budgets. |
| 245-17 | Deploy matching projection/schema/backfill/rules/browser artifacts; measure moving egress. |
| 245-18 | Deploy timestamp index; witness beyond-cap cursor failure/session replacement/reacquisition. |
| 245-19 | Inventory/migrate callers; observe 90-day compatibility and 30 traffic-free days; approve retirement. |
| 245-20 | Deploy collector and measure real sampled profiles/resource use under sustained load. |
| 245-21 | Witness real provider outage/recovery across all replica circuits and stranded reroutes. |
| 245-22 | Witness physical plausibility/reacquisition and lifecycle/history/orphan boundaries. |
| 245-23 | Capture same-attempt transport/backend acknowledgements through controlled outages. |
| 245-24 | Witness physical credential rotation/rejection/reflash and secure-fleet discovery/recovery. |
| 245-25 | Independently attest installed image/receiver/security state and physical first-boot/power loss. |
| 245-26 | Witness signed OTA rejection/interruption/validation-loss/rollback on approved secure hardware. |
| 245-27 | Execute seven query shapes and retention/recovery sweeps in the real release environment. |
| 245-28 | Attest deployed secrets/claims/restrictions/rules/CSP/CORS and genuine operator views. |
| 245-29 | Separately stop crashed/hung Auth executors; inspect unknown effects before privacy retry. |
| 245-30 | Exercise process/replica restore with more than 1,016 concurrent distinct rides. |
| 245-31 | Stop owner at retirement/completion/lease boundaries and observe the actual replacement. |
| 245-32 | Inventory legacy timestamps/oversized data; approve backfill/quarantine/erasure rehearsal. |
| 245-33 | Collect 1,000 moving contention samples with matched clocks/cloud usage. |
| 245-34 | Witness full direction/matching/reroute ambiguity and completion/dwell behavior. |
| 245-35 | Measure physical cadence/retries/backlog/bandwidth and capacity before cadence policy changes. |
| 245-36 | Patch adds bounded Auth recovery; real mobile/PWA/provider/active-ride suspension remains. |
| 245-37 | Named release owner must sign actual source/image/hosting/DNS/rollback/usage evidence. |
| 245-38 | Perform saved-token offboarding/reassignment/demotion on approved staging with deployed backfill. |
| 245-39 | Witness Device-only signed OTA ownership/interruption/exclusion on stopped secure hardware. |
| 246-01 | Deploy indexes first; execute real retention/deletion/recovery with approved release data. |
| 246-02 | Same caller inventory, observation windows and retirement approval as 245-19. |
| 246-03 | Deploy managed collector/alerts; witness redacted credential-rejection/device-silence alert. |
| 246-04 | Complete physical/deployed acceptance and independently attest installed firmware/receiver. |
| 246-05 | Owner must choose heartbeat/cost/code-lifetime/offline-shell policy after measured trials. |
| 246-06 | Owner must decide whether separate metadata signatures are required; implement if adopted. |
| 300-01 | Independent position/time reference and uncertainty, attested setup, forward/reverse drive. |
| 300-02 | Correctly establish receiver cold/warm/hot setup and measure acquisition/reacquisition. |
| 300-03 | Compare real drift/multipath/parallel roads against independent truth. |
| 300-04 | Witness combined GNSS/Wi-Fi/reboot/backend/browser recovery and same-session correlation. |
| 300-05 | Compare controlled degraded/recovered field phases with seeded oracles and drive/abort notes. |
| 300-06 | Agree measured accuracy/freshness/recovery limits and a named acceptance owner. |
| 300-07 | Witness full forward/reverse/return lifecycle, ambiguity and preserved passenger history. |
| 300-08 | Same moving contention/paint/message/usage evidence as 245-33. |
| 300-09 | Witness moving owner/replica failover, queued/unknown writes and delayed reroute fencing. |
| 300-10 | Patch adds Auth recovery; real mobile all-role active-ride/PWA/network/provider matrix remains. |
| 300-11 | Named owner must accept measured thresholds; arrange actual provider/reference/drive access. |
| 337-01 | Investigate real deployed archived-message rules/claims/blocked resources with intended Admin. |
| 337-02 | Exercise current deployed artifact at desktop and exact 390/360 CSS-pixel widths. |
| 337-03 | Patch adds recovery; genuine-role full control/state/provider/permission coverage remains. |
| 337-04 | Complete actual boarding, ETA, chat, completion/feedback, restore/history and automatic return. |
| 337-05 | Obtain missing same-attempt internal backend/HTTP/device/clock evidence for transport gaps. |
| 337-06 | Capture all-role Chrome profiles/HAR and independent paint/target/visibility/clock correlations. |
| 337-07 | Same physical truth/setup/acquisition/compound-recovery evidence as #300. |
| 337-08 | Execute remaining real offline/timeout/race/fix-loss/multiple-bus/provider/role partitions. |

No source change can supply a missing independent instrument, elapsed
observation window, historical profiler trace or named owner's decision.
Synthetic replay is useful regression evidence and remains labelled as such.
