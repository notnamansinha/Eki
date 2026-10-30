# Testing issue and PR cross-check: 3 October 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-018 | 1.0 | Historical | 2026-10-04 |

> Historical evidence: original run dates, commits, measurements and limits below remain authoritative for that run. This documentation update does not rerun the test. See [current testing gates](README.md).

Scope: every issue numbered 191 or higher except 204; merge review for actual
PRs numbered 210–226. Issue numbers and PR numbers share a GitHub sequence:
the five actual PRs in that interval are 210, 215, 222, 223 and 226. All five
are merged into `testing`, and their merge commits are ancestors of `48267a4`.
PR236 and PR238 are also merged. The final-head and merged CI checks for these
follow-ups pass. Historical failed runs remain visible and are superseded by
the corrected snapshots; their failures are not rewritten as passes.

## Reviewed issue-to-PR mapping

| Issues | Implementation PRs | Cross-check |
| --- | --- | --- |
| 191 | 197, 199, 200, 201, 203 | Contract parent; remains open for its incomplete rollout/measurement children. |
| 192 | 197, 203 | Shared old/v2 handlers, authorization/validation/rate-limit contracts and caller migration are tested; authenticated testing-preview rollout remains blocked by the exact browser-key referrer restriction. Legacy paths are retained. |
| 193 | 200 | Already closed; versioned lifecycle, boarding, duplicate/uncertain retries, locks and deletion safety remain covered by passing suites. |
| 194 | 200 | Durable operation ownership/status/replay and call-budget regressions pass. Real Google span/usage and latency acceptance remain pending; mocked counts are not billed usage. |
| 195 | 201, 202, 210, 226, 238 | ADR/tooling and stationary/device/RTDB evidence are implemented. Real moving/weak-network browser/chat, same-window physical connection/usage and a final measured decision remain pending. |
| 196 | 199 | Already closed; automated OpenAPI inventory currently covers 59 registered HTTP operations and schemas/policy. |
| 206, 207, 208, 209 | 210, integrated in 226 | All crossed stops/checkpoints, completion after cross-store failure, generated page props and independently discoverable deletion retry jobs. |
| 211, 212, 213 | 215, integrated in 226 | Verified obsolete fields, complete match-context cleanup and invalid geometry fallback/recovery. |
| 214 | 223, integrated in 226 | Protected 180-day legacy/geometry retention, grace/CAS/quarantine and partial-failure/replica tests. No eligible old data exists. The owner confirmed external legacy-consumer usage is unknown; legacy purge stays disabled and this retirement gate remains open. |
| 216, 217, 219, 220, 221 | 222, integrated in 226 | Hidden-view hit-testing/inert controls, bounded acknowledged writes, history dialog/focus, parseable feedback PATCH and in-flight settings draft lock. |
| 218 | 222, 226 | Named controls; the original disabled-unarmed-card proposal was superseded by the user's inspectable-stationary-device requirement and issue228. |
| 224, 225 | 226, 238 | Bounded encrypted checkpoint fault coverage and actual physical cuts; sample-correlated marker arrival traces and labelled/throttled hook simulations. Limits remain explicit. |
| 228, 229, 230, 231, 232, 235 | 226 | Stationary/pending Google Maps preview, selected identity/quiet expiry, operation acknowledgements/creation retries, operator errors/keyboard controls, phone navigation clearance and initial route framing. |
| 233 | 226 | Patched multipart parser and clean runtime audit. |
| 234 | 236 | Removed vulnerable development dependency chain; full audit is also clean. |
| 237 | 238 | Separate legacy IDF build, safe app-only installation, unchanged partition/security configuration and captured physical recovery. |
| 239, 240, 241 | Movement recovery follow-up | Reproduced against merged testing, then fixed and regressed as described below. Close only after that PR's verified testing merge. |

The 24 completed defect issues above were closed with their individual evidence
and merged verification links. Issue204 is excluded from changes. Unmet gates
are retained rather than marked complete solely because an implementation merged.
Feature branch deletion applies only to verified merged commits; open work and
other contributors' forks are preserved.

## Movement findings reproduced and repaired

PR227's report describes an older workspace and is still an open documentation
PR targeting `main`; it was not merged or retargeted during this testing audit.
Its three runtime findings were independently reproduced on testing `48267a4`.
New regressions failed before the changes and pass after them:

- Issue239: a 120-second interruption at30km/h can leave the accepted position
  held until five minutes. Three coherent good-quality fixes now permit early
  reacquisition inside the full 60–300 second travel envelope. Ordinary short-gap
  protection remains. Unknown/poor-quality fixes, too-fast/sparse samples,
  city-scale jumps, inconsistent candidates and malformed evidence cannot
  establish early reacquisition. Repeated/older samples are no-ops. Forward and
  reverse simulations each continue through600fixes after recovery.
- Issue240: the shared untrusted RTDB boundary now enforces speed[0,200] and
  heading[0,360) for top-level and raw-location values. Missing optional legacy
  values remain supported; an invalid snapshot is rejected and a subsequent
  valid snapshot recovers. This does not establish an unauthorized write path.
- Issue241: null/missing/non-finite/negative explicit accuracy retains HDOP
  fallback; only numeric finite nonnegative accuracy overrides it.

The extra RTDB reacquisition field stores only temporary count/start time and
reuses existing raw-location evidence; it clears on acceptance/ineligible fixes.
Removing it would lose corroboration across transactions/replicas and reinstate
the recovery defect. It never authorizes boarding or fabricates crossed stops.

GPS blockage and reflected signals affect received positioning quality
([GPS.gov accuracy guidance](https://www.gps.gov/gps-accuracy-0)). The chosen
corroboration rules are a tested bounded software policy, not proof against
every correlated multipath error. Real-drive performance remains issue195's gate.

Local validation:56script checks,620backend and366frontend tests, lint and backend
TypeScript build pass. Seven emulator cases are skipped in ordinary local runs
and run separately in CI. An initial simultaneous lint/test run hit the existing
five-second diagnostic-IP stress-test timeout; the full isolated rerun passed.
CI on the final PR head and testing merge is required before final completion.

## Firebase console cross-check

Read-only console review showed, for the displayed current billing period
Oct1–Nov1(GMT-7), connections8of100, storage4.05KB, downloads144.53MB,
load peak1%,391rule allows and15denies. Rule errors were shown as no data,
which must not be converted to a measured zero. The chart described daily
aggregation, and its presented time bounds differ from the period label.
These values include other project traffic and do not isolate this audit window,
moving load or chat. Screenshots and the exact visible text are archived privately.
The earlier seven-day overview showed110MBRTDBdownloads and45kFirestore reads;
these differing scopes cannot be pooled. No unexpected deny operation is inferred
from aggregated counts, and no Firebase rules or billing settings were changed.

See [current physical, mobile and deployment acceptance](TESTING_ACCEPTANCE_2026_10_03.md).
Private closure results, merge ancestry, raw logs and readable CSVs stay in the
ignored audit folders. No production deployment or live synthetic GPS writes
were performed.
