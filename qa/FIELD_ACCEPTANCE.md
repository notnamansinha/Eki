# Witnessed Field Acceptance Package

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-007 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This package defines how to prepare, capture and review witnessed L5 evidence: a tracker in a moving vehicle or on a bench, observed against an independent reference. It performs no drive, flash, provisioning, RF transmission, cloud change or provider experiment by itself. Automated reports from the [QA programme](README.md) never ingest this form or promote it to software acceptance.

[Issue #351](https://github.com/notnamansinha/Eki/issues/351) is the working acceptance checklist. It consolidates the original requirements of issues #245, #246, #300 (GNSS truth and compound recovery during motion) and #337. A checkmark in a software pull request or in this document does not close a field requirement. The [field capture procedure](../docs/operations/FIELD_CAPTURE.md) describes the serial recording and archive steps for a ride.

## 2. Capture identity before a run

Record these facts in a private evidence directory before collecting samples:

| Field | Required observation |
|---|---|
| Software | Full backend and frontend commits, deployed image digest, browser and OS versions, route configuration and geometry versions |
| Tracker | Flashed image SHA-256 and build environment, board pseudonym, receiver MON-VER, antenna and power configuration |
| Session | Pseudonymous bus, device and session identifiers; current assignment and direction; original and replacement ride identities |
| Conditions | UTC start and end, environment category, temperature and power where measured, sky and antenna conditions, network phase |
| Witnesses | Named responsible owner, safe vehicle operator and observing tester; the driver does not operate the test UI while driving |
| Reference | Independent position and time instrument, its calibration, sampling rate and measured uncertainty |
| Clock domains | Device sample and send, backend ingress and response, datastore observation, browser listener, message and paint; synchronisation method and offset uncertainty |
| Limits | Owner-approved accuracy, freshness, ordering, latency and recovery limits, fixed before results are evaluated |

A missing identity, instrument, approved setup or measured uncertainty makes the gate BLOCKED. A software restart is not a GNSS cold start: record the receiver-state setup that the installed receiver firmware and manual require for cold, warm and hot acquisition.

Keep exact captures private and publish redacted summaries only. Exclude bearer tokens, device secrets, credentials, passenger identity and precise personal coordinates from public GitHub logs. Hash private capture files and record their controlled location in the result.

## 3. Motion matrix

| Run | Observation and independent oracle | Evidence required |
|---|---|---|
| Normal forward and reverse | Reference trajectory, ordered and closely spaced stops, origin departure, endpoint completion and a separate empty return ride | Correlated receiver, device, backend, projection and browser samples; durable original and return ride records |
| Stop arrival corridor | Arrival inside the 15 m corridor, the offside gate on a divided road, and stops credited as passed without confirmation | Reference positions of the bus and each stop pin, with the published stop index and passed state at each stop |
| Endpoint direction and turnaround | Pending and resolved direction, zero and approved non-zero dwell, U-turn and wrong-turn behaviour | Source constants and configuration, plus timestamped direction, stop and dwell observations |
| Plausible drift and ambiguity | Gradual bias, adjacent or parallel roads and multipath inside single-step jump limits | Independent along-track and cross-track errors; raw, accepted and matched traces; no false boarding, progress, completion or direction change |
| Acquisition and quality recovery | Correct cold, warm and hot setup; first valid fix distinguished from first usable fix | Receiver-state witness, quality fields, fix age, reference uncertainty and measured recovery time |
| GNSS plus network loss | Representative loss and reconnect phases; unknown acknowledgement distinguished from definite rejection | Queue identity, original sample and send times, retries and drops, last accepted projection |
| Reboot with queued replay | Approved device restart with retained samples; the original assignment and ride are not wrongly resurrected | Flashed source identity, reset reason, queue sequence, stale and duplicate rejection, final ride |
| Backend replica recovery | Owner-approved restart or partition, lease expiry and renewal, delayed writes and results | Image and source identity, leader and lease generation, lock ownership, no duplicate return or overwritten replacement ride |
| Mobile suspension and update | Passenger and admin suspend and resume, and an approved PWA update during an active ride | Browser visibility, network and cache state; restored identity, boarding, chat and history; observed marker freshness and live-health state |

Use safe, owner-controlled drives with prearranged observers, a bounded duration and explicit stop and abort responsibilities. Do not create traffic hazards, change live fleet accounts or transmit RF interference. Receiver vulnerability work belongs in an approved contained bench facility [1], [2].

## 4. Timing and contention evidence

The field gate requires at least 100 accepted moving latency samples and 1,000 moving contention samples, across normal, degraded-network and reconnect phases. Count rejected, stale, dropped and duplicate samples too; do not remove them to improve percentiles.

For each correlation identity retain:

```text
capture identity; source, image and firmware hashes; session and assignment revision
GNSS sample time; device send time; backend ingress and response time
datastore observation and version; browser listener, message and paint time
raw, accepted and matched position; reference position; quality, direction and state
network and visibility phase; queue, retry, drop and duplicate outcome
clock-domain offsets and measured uncertainty; evidence file references
```

Compute p50, p95 and p99 only between defined, comparable boundaries. Report raw counts, measurement resolution, clock uncertainty and missing observations with each statistic. Do not subtract unsynchronised wall clocks and call the result transport latency. A virtual timestamp, an emulator completion or a synthetic marker animation is not a moving-device latency sample.

Compare cloud usage only across matched, approved observation windows with equivalent fleet conditions. Synthetic admission counts and in-memory provider calls are not Firebase or Maps billing observations.

## 5. Bench and provider gates

| Gate | Preparation and witness |
|---|---|
| Power, thermal and watchdog | Dedicated current-limited spare board, supply measurements, measured task and reset behaviour, retained queue integrity |
| Journal and reset recovery | Actual board, environment and storage layout; safe interrupted-write and reset setup; measured loss window for the last useful checkpoint |
| TLS, receiver and network | Correct CA, hostname and clock; receiver firmware and setup; measured connection and fix recovery |
| OTA and protected fleet | Witnessed spare-board procedure and signing-key custody; valid and rejected image boots; active-ride deferral; follow [hardware security provisioning](../docs/security/HARDWARE_SECURITY_PROVISIONING.md) |
| Live OAuth and Maps | Disposable staging access with owner permission, bounded quotas and cost acknowledgement, actual provider and browser evidence (L4, outside unattended CI) |
| Production rollout | Maintainer review, required checks, environment, retention and security ownership, release sign-off |

Native policy tests, host protocol tests and ESP32 builds are L0 and L1 evidence. They cannot establish power, temperature, UART, RF, Wi-Fi, protected boot, eFuse, mobile radio or provider behaviour. This package does not authorise provisioning.

## 6. Result form

Copy this form for each witnessed run. Leave unknown values unknown; never fill it with simulated passes or assumed measurements.

```text
Record status: UNEXECUTED / BLOCKED / FAILED / OBSERVED (choose after the run)
Run identity and scenario:
UTC start and end, and observation time zone:
Full source commits, image digest and flashed firmware hash:
Receiver, board, environment, route and session identity:
Responsible owner, operator and observing witness:
Approved setup, duration, and stop and abort conditions:
Independent reference, measured uncertainty and calibration:
Clock synchronisation method, offsets and uncertainty:
Approved limits and the applicable source and configuration constants:
Expected versus observed state and side effects at each boundary:
Accepted, rejected, stale, dropped and duplicate sample counts:
Latency and contention sample counts, boundaries, and p50, p95 and p99:
Recovery duration, final lock and session identity, residual anomalies:
Private capture hashes and locations, and redacted summary references:
Untested or blocked partitions:
Named owner review and decision, date and reason:
```

An OBSERVED result means evidence exists for that run. It is not a whole-case or fleet release pass. Review failures and uncertainty against the predefined oracle, keep adverse evidence, and update issue #351 only after the owner reviews it. Record the reviewed result as a new evidence record in `docs/testing/` and list it in the [testing index](../docs/testing/README.md).

Software gaps stay software work. The [execution ledger](EXECUTION_EVIDENCE.md) lists every requirement without a reviewed mapping; do not move a software gap into a field gate.

## 7. References

[1] Kognic, "Edge Cases in Autonomous Driving: Detection and Handling Guide," https://www.kognic.com/articles/edge-cases-autonomous-driving. Accessed: 2026-10-30.

[2] Safran Navigation and Timing, "The importance of testing to detect GNSS vulnerabilities in intelligent transportation systems," https://safran-navigation-timing.com/the-importance-of-testing-to-detect-gnss-vulnerabilities-in-intelligent-transportation-systems/.
