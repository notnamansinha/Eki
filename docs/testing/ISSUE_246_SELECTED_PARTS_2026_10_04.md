# Issue #246 selected-part software evidence: 4 October 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-017 | 1.0 | Historical | 2026-10-04 |

Scope: R24, R26, R27, R28, R29 and R33. The owner deferred R34 to physical
acceptance, including moving-bus testing planned for 5 October. The stationary
connected board was not flashed or used to certify these changes.

Use [issue #246](https://github.com/notnamansinha/Eki/issues/246) for current
merge/checklist status and each PR's exact-head CI. Dated reports retain their
original builds and measurements; this record does not rerun their field work.
The subsequent R01–R11/R25 work is recorded in
[the 5 October priority evidence](ISSUE_246_PRIORITY_PARTS_2026_10_05.md).
That later record includes an installed image containing these earlier firmware
changes, stationary network-fault/recovery windows, heap/stack measurements and
cold/warm HTTPS timings. It supplements this dated software record; controlled
clock injection, secure OTA and moving-route acceptance remain in #245/R34.

| Part | Change and targeted evidence |
|---|---|
| R24, [#248](https://github.com/notnamansinha/Eki/pull/248) | Single-bus progress versus explicit earliest-arrival aggregation; unavailable geometry never silently becomes road ETA. 20 map/geometry regressions passed. |
| R26, [#249](https://github.com/notnamansinha/Eki/pull/249) | Dedicated maintenance worker, protected fresh stopped snapshot and transactional ride/installation exclusion. 25 backend firmware/ride cases and native update-policy tests passed. |
| R27, [#250](https://github.com/notnamansinha/Eki/pull/250) | Corroborated receiver epochs, bounded corrections, peer disagreement gate and a strong pre-application SNTP override verified in the ELF. Clock duplicate/jump/rollover regressions passed. |
| R28, [#251](https://github.com/notnamansinha/Eki/pull/251) | Raw receiver/UART/evaluation/enqueue/send/header/body-drain timing; configured handshake timeout named accurately. 11 trace-analyzer cases passed, including rollover, retry and incomplete responses. |
| R29, [#252](https://github.com/notnamansinha/Eki/pull/252) | Actual ArduinoJson allocation exhaustion/incomplete schemas fail before serialization/send; resource measurement and gated traces. 7 native suites / 67 cases passed. Same-configuration traced/quiet builds passed: quiet saves 2,332 flash bytes and 8 static RAM bytes. |
| R33, [#253](https://github.com/notnamansinha/Eki/pull/253) | One validated build-time canonical origin drives metadata, robots and sitemap; preview indexing can be disabled. 13 configuration/robots/sitemap cases passed. Current API quota/cost/transaction-metric documentation and native suite counts are corrected. |

CI verifies web contracts, lint, unit tests, Firebase authorization rules,
synthetic admin browser scenarios, strict production export/CSP/service worker,
backend container/degraded-health smoke, native firmware and reachable development,
quiet, journal and signed-fleet builds. Builds use fake credentials and an
ephemeral signing key; they are not provisioned device artifacts.

R33's local strict export used `https://canonical-ci.example.invalid` and checked
rendered canonical/Open Graph URLs/images, robots sitemap discovery and XML URLs.
This verifies generated output, not an externally deployed social preview.

## Physical and live evidence still required

[Issue #245](https://github.com/notnamansinha/Eki/issues/245) retains receiver/clock
injection, slow maintenance and physical exclusion, GNSS/moving/parallel-road
captures, brownout/watchdog, signed spare-board/OTA, actual heap/largest-block/stack
and cold/warm transport measurements, and live hosting/security/rollout acceptance.
Binary trace savings do not establish physical heap or latency improvement.
R29 adds measurements before allocation/pool/stack tuning; diagnostics remain
short-lived because the normal five-minute interval exceeds server keep-alive.
