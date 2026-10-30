# Cold power and moving-marker follow-up: 2026-10-03

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-010 | 1.0 | Historical | 2026-10-04 |

> Historical evidence: original run dates, commits, measurements and limits below remain authoritative for that run. This documentation update does not rerun the test. See [current testing gates](README.md).

Later acceptance: [physical power cuts, installed journal firmware, merged CI,
phone-width Google Maps and remaining gates](TESTING_ACCEPTANCE_2026_10_03.md).
The measurements and pending statements below describe this earlier capture.

## Scope and review order

The earlier full feature audit was completed first in PR #222, followed by the
legacy/geometry 180-day retention fix in PR #223 (issue #214). PR #226 now
integrates PR #210's durable ride/stop checkpoints, PR #215's RTDB field/geometry
safeguards, PR #222 and PR #223 on one branch targeting `testing`. Local integration
resolved shared feedback headers/labels, test configuration, dependency lockfile,
and retention-worker conflicts. The 180-day ride default and legacy-retirement
gate are both retained. No GitHub PR was merged and nothing was deployed.
The additional follow-up addresses issues #224 (RTC-only cold recovery) and
#225 (underreported/cancelled marker traces).

## Cold recovery

The new bounded flash journal preserves one latest authenticated fix for cold
recovery. Retry sequence is preserved; accepted ride and crossed-stop history
remains in backend transactions and durable checkpoints. A valid warm RTC queue
is authoritative, including an empty acknowledged queue. Authentication rejects
corruption, partial writes and incompatible configuration; freshness is enforced
after clock synchronization. The first committed fix and ten-second checkpoint
scheduling reduce the cold-loss window without claiming lossless per-fix storage.

Native fault injection clears all volatile/RTC state, interrupts records at all
129 byte boundaries, interrupts old-page erase, wraps the ring and generation,
models unknown write outcomes, changes configuration, exhausts failing writes,
and exercises read/codec failure and stale/warm recovery. Ten journal cases plus
52 existing firmware cases pass. The fake native codec tests journal behavior;
the ESP32 builds use mbedTLS AES-256-GCM. Both development and signed fleet builds
pass. The signing key is ephemeral and not a production credential.

The journal is ciphertext-only even in development. Fleet flash encryption adds
another layer. Radio-off credential isolation refuses new encrypted checkpoints
without the expected RNG entropy source. The publisher is notified before flash
work; flash I/O occurs outside the queue critical section. Erases never remove
the last confirmed page; codec failure does not erase flash. OTA app addresses
and sizes are preserved. See [operational limits, wear estimates and stationary
power-cut procedure](../hardware/COLD_POWER_RECOVERY.md).

## Moving-marker tracing and simulation

Marker traces now distinguish a held previous target, a React snapshot, and
current-target arrival within 5 cm. The arrival timestamp is taken on the next
animation frame after state reaches that tolerance; it includes that diagnostic
frame delay and does not establish Google Maps compositor paint time. Same-sample
entry replacement cannot permanently cancel a trace: deduplication commits inside
the scheduled callback. Correlation stays within the same browser run, node and
ride session. Disabled tracing skips the additional distance calculation.

The isolated loopback fixture uses the actual position-selection, smoothing and
trace hooks. Scenarios cover current/delayed matching, a stalled matcher and its
bounded raw fallback, bursts, a delivery interruption, and ride-context replacement.
The delivery interruption is not a Firebase physical reconnect test. System
reduced-motion mode is preserved in the real application; a fixture-only option
also exercises normal animation. Captures include raw phase records, loopback
delivery intervals, visibility, reduced-motion flags and frame-gap statistics.
No fabricated fixes are written to Firebase or sent from the real board.

The browser runs exhibit approximately one-second frame-gap p95, including when
visibility reports `visible`. The OS prefers reduced motion. Those facts preclude
an honest smoothing-duration performance claim. The production default remains
250 ms. Controlled hook tests exercise both 120/250 ms completion, reduced motion,
disappearance, callback cancellation, held/older context exclusion and disabled
tracing. See [fixture instructions](../e2e/motion/README.md).

## Validation and limits

Combined local validation: 595 backend tests, 309 frontend tests, 52 script
checks, lint, strict production export/SW/CSP checks, zero production dependency
audit findings, 62 native firmware cases, and both firmware build environments.
Seven Firebase rule tests are separately exercised by CI; the ordinary local
backend suite skips emulator-dependent cases.
Integration regressions also verify that an RTDB outage after completed Firestore
deletion does not resurrect its retry job, and that geometry cleanup runs while
legacy roots remain gated until retirement is declared.

Private raw logs, all browser captures, screenshots and SHA-256 evidence are
kept in ignored `temp/live-audit-2026-10-02/validation/cold-power-motion` in the
primary checkout. Build placeholders and synthetic data are kept separate from
the earlier real device/network/RTDB audit. No live records were deleted, no PRs
merged, no board flashed, and no security fuses changed.

Unsent fixes after the last successful checkpoint can still be lost. Capture
cadence, flash timing, radio isolation and write failures can widen that window.
Complete physical power-cut behavior, actual flash endurance/UART continuity,
foreground unthrottled timing, mobile networks and road GNSS require acceptance
on the relevant hardware/environment. These tests provide bounded evidence,
not a claim that every possible edge case or vulnerability has been eliminated.

## Recorded standard-animation browser run

Synthetic loopback data; system reduced motion enabled, fixture override active. Frame throttling limits comparison. Values are milliseconds; arrivals can be fewer than samples when targets are superseded.

| Profile | Duration | Samples | Arrivals | Loopback p95 | Arrival p50 | Arrival p95 | RAF gap p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| matched | 250 | 12 | 11 | 4 | 576.8 | 1001.7 | 1015.9 |
| delayed | 250 | 12 | 4 | 2 | 821.3 | 1540.4 | 1016 |
| stalled | 250 | 12 | 10 | 3 | 547.8 | 984.2 | 1015.9 |
| burst | 250 | 12 | 1 | 3 | 711.4 | 711.4 | 1015.9 |
| disconnect | 250 | 12 | 12 | 3 | 458.7 | 699.1 | 1015.9 |
| context | 250 | 12 | 11 | 3 | 704.5 | 1191.8 | 1015.9 |
| matched | 120 | 12 | 10 | 3 | 471.5 | 996.9 | 1015.9 |
| delayed | 120 | 12 | 6 | 2 | 754.9 | 1115 | 1015.9 |
| stalled | 120 | 12 | 8 | 3 | 374 | 983.2 | 1015.9 |
| burst | 120 | 12 | 1 | 3 | 277.1 | 277.1 | 1032.5 |
| disconnect | 120 | 12 | 9 | 2 | 940.1 | 2099.2 | 1015.9 |
| context | 120 | 12 | 10 | 3 | 455.9 | 987.7 | 1015.9 |
