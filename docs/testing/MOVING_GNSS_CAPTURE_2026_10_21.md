# 21 October ride evidence and remaining issue work

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-024 | 1.0 | Historical | 2026-10-21 |

The ride has ended and its available evidence is sealed. No complete live or
production acceptance gate passed. The [requirement ledger](MOVING_GNSS_CAPTURE_2026_10_21.json)
accounts for all 64 unchecked rows in #245 (39), #246 (6), #300 (11) and #337 (8).
The sole native subissue relationship is #245 → #300, rechecked after the ride;
historical issue references inside checklist text are not additional subissues.
The ledger is a dated evidence snapshot, not a live issue synchronization service.

## Retained observations

The observed checkout was `a523731295d37c9ecaf1a917cebefa4502b34dab`, older than
the current integration baseline `371eb7d9d07c8a2e43c42125a53cbc12115d28a4`.
Current fixes cannot be judged by the older served application alone.

- Core capture began 20 October 20:29:35 UTC (21 October 01:59:35 IST).
  The owner reported READY at 20:50:03 UTC and DONE at 21:14:19 UTC.
  These are reported boundaries, not calibrated physical movement times.
- At about 20:53:41 UTC, the supervisor raised `PermissionError: WinError 5`
  replacing its status file. Its cleanup stopped all workers by 20:53:45 UTC.
  A replacement recorder was never launched. Later selected foreground reads
  are discontinuous supplementary evidence, not restored full capture.
- Serial retained 18,654,202 exact bytes, dominated by null/binary bursts with
  intermittent readable diagnostics. The physical cause is unproven. Indoor
  acquisition, a local build hash and laptop geolocation do not establish
  independent GNSS truth, installed firmware or receiver identity.
- Core inspector capture plus selected foreground recovery retained 709 unique
  HTTP records: 708 status 202 and one 200. Of 700 telemetry records, 567 reported
  moving and 133 stopped. Bounded inspector retention can omit requests;
  sequence gaps are not a packet-loss measure. HTTP acceptance does not prove
  device acknowledgement, fleet contention or browser paint.
- Backend stdout/stderr became durable after one owner-approved backend-only
  restart before departure. Worker leadership appeared about 14 minutes after
  server startup. This delay is observed; its cause is not established. Current
  source starts coordination in the listen callback and fences lease changes;
  the evidence does not justify weakening lease ownership or forcing leadership.
- Passenger observations remained pending/pre-departure. No verified full
  boarding/chat/completion/feedback/return lifecycle or genuine three-role
  acceptance matrix was obtained.
- Owner-pasted local metrics were LCP 0.16 s, CLS 0.00 and INP 528 ms, with
  218 ms input delay, 96 ms processing and 214 ms presentation delay. No saved
  Performance JSON/JSON.gz, sanitized HAR or app trace from the actual map tab
  was supplied. These metrics do not identify the responsible interaction/code
  or establish field percentiles. Do not infer a root cause from the video.

The verified private ZIP contains 229 evidence files and an embedded SHA manifest
(230 entries). ZIP CRC and every archived file SHA-256 were reopened and checked.
Archive SHA-256: `9a70bba09357e34b98b18077a98765b95b41c14ef41c318eaa30ea2eaca6ed9e`.
The 24m55s original video was retained separately because of unrelated app scenes
and unreviewed audio; its SHA-256 is
`708239f52a854b5a3dfc05b995f36646dd71eb2cc0af3747ae0477c1efa66fd8`.
No off-device backup was established. Private trajectories, IDs, accounts,
raw logs and video are excluded from the repository.

## Implementation disposition

| Work | Disposition |
| --- | --- |
| Recorder status sharing violation and fixed serial ceiling | Maintained END-controlled supervisor and serial mode; regression coverage for sharing failures, reconnects, separate restart segments, real child shutdown, storage stop and unresponsive workers. See [recording guide](../operations/FIELD_CAPTURE.md). |
| Genuine Passenger/Driver local export unavailable | The opt-in trace download now accepts each authenticated role, exports only the existing tab trace and never requests protected health. Mounted role/logout/opt-in regressions cover this boundary; deployed capture still needs verification. |
| Passenger ETA/progress and recovery from missed stopped endpoint | Existing [PR #345](https://github.com/notnamansinha/Eki/pull/345), based on `testing`; avoid duplicating its implementation. Its physical acceptance remains open. |
| Unselected destinations, operator form/layout, archived-message rules and telemetry status | Prior merged software repairs and regression coverage exist on current `testing`; #337 still requires current deployed artifact, identity/claims and genuine role verification. Do not loosen access rules to hide a deployed denial. |
| 528 ms INP, transport errors and startup/leadership delay | Diagnostic leads requiring same-window profiler/dependency/lease evidence. No causal software repair claimed from missing observations. |
| Deployed replicas, real providers, destructive retention/privacy, release cutover and security trials | Execute the exact staged procedures after named owners/environment and scoped permissions are available. Unit tests do not certify these systems. |
| Independent GNSS, installed-image/receiver attestation, dedicated power hardware and secure OTA | Instrument/hardware prerequisites remain unavailable; no synthetic replacement for physical acceptance. |
| Compatibility retirement and optional policy decisions | Preserve the required 90-day/30-day evidence windows and owner decisions. Do not remove adapters or change cadence/signature policy to clear a checkbox. |

## Every remaining requirement

The machine-readable ledger preserves the exact requirement, status, next
experiment and oracle for each item. Status totals are 25 **OBSERVED_PARTIAL**,
23 **NOT_RUN**, 16 **BLOCKED**, and zero complete passes. These statuses describe
this ride's evidence, even where software regressions already pass.

1. #245: execute scoped deployed/physical/release acceptance; keep signing custody,
   hosting/billing, destructive-data approvals and long observation windows as
   separate gates. Do not treat a healthy local server as release sign-off.
2. #246: retain index-first release sweeps, external caller migration, managed
   monitoring, actual image identity and unresolved policy decisions. No cadence
   or metadata-signature policy change was authorized by the ride.
3. #300: obtain independent position/time reference and receiver/image identity;
   witness complete forward/reverse lifecycle and approved coupled recovery,
   then compare against owner-approved accuracy/freshness thresholds.
4. #337: verify deployed archived-message access using the intended account;
   exercise genuine roles and current desktop/390/360 CSS-pixel artifacts, then
   correlate transport/dependency/browser exports and the full armed lifecycle.

The next run needs verified export round trips and fresh stream growth before
departure. Obtain profiling data for the slow interaction and independent truth
before labeling responsiveness or positioning repaired. Record unknown outcomes,
capture gaps and unperformed fault partitions explicitly. No issue is closed by
this report or by a software build.
