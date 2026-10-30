# Realtime transport evidence audit (#195)

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-045 | 1.0 | Historical | 2026-10-04 |

> Historical evidence: original run dates, commits, measurements and limits below remain authoritative for that run. This documentation update does not rerun the test. See [current testing gates](README.md).

Audited on 2026-10-01 against `testing` at `6be2a75`. This report verifies
existing captures; it does not record a new field experiment or complete #195.
The transport decision remains to retain Firebase SDK listeners.

New evidence: the [October 2 live audit](LIVE_LATENCY_RECOVERY_AUDIT_2026_10_02.md) adds a 20-minute stationary serial/network capture and a 90-second RTDB profiler window. It reports a 26.692-second failure gap, clock-qualified Admin observer latency and verified database region. Browser paint/chat, physical connection peaks and billed usage remain unmeasured; these results do not complete #195.

## Verified captures

The ignored hardware archive in the primary checkout contains the September
12–13 stationary bench and recovery captures. The results below were recomputed
from their parsed `[TelemetryTrace]` records on October 1. Percentiles use
nearest rank and include failed HTTP requests unless stated otherwise.

| Capture | Parsed requests | HTTP 200/202 | Not accepted | HTTP p50 / p95 / p99 (ms) | Observed motion |
| --- | ---: | ---: | ---: | --- | --- |
| Original bench (`esp-final-bench.log`) | 63 | 63 | 0 | 565 / 1,122 / 1,863 | stopped |
| Readiness (`stationary-readiness.log`) | 594 | 593 | 1 | 450 / 1,065 / 1,271 | stopped |
| Recovery (`final-recovery.log`) | 208 | 194 | 14 | 590 / 1,443 / 2,265 | stopped |

The readiness log has one additional malformed trace line, excluded from parsed
request counts. It cannot establish a complete response/failure count. The
recovery window includes reboot, tunnel interruption, and injected response
faults; its percentile must not be described as uninterrupted steady state.
Windows are separate experiments and are not pooled into a larger sample.

All parsed records above are `device_http` events. None is a browser listener,
marker render, chat write, or Firebase usage record. HTTP round-trip duration
cannot be substituted for sample-to-marker or chat delivery latency. The
response delay/drop experiment is not radio packet loss or bandwidth emulation.

The existing [bench report](LIVE_ESP32_LATENCY_RESULT.md) describes the recovery
experiment, clock qualifications, fault timing, and raw-capture privacy boundary.
The readiness aggregate also records 176 RTDB observer events and observer-gap
p50/p95/p99 of 980/1,661/1,953 ms. These are callback gaps, not browser marker
latency, physical connections, or Firebase billed usage.

Raw logs remain outside Git. SHA-256 references let an operator identify the
exact files without publishing their device identifiers or location data:

| Capture | Raw-file SHA-256 |
| --- | --- |
| Original bench | `7458ff0596e44086658ed92cc725b4c11ef44c6cab9c4718852ce3728a32c563` |
| Readiness | `d9985371feaa01c7af3539577fd5a0ddda5a6f866e0456d3d1491b3f974ae662` |
| Recovery | `429a3d41ba68716c41fb58ced37eb6a5e91606db2d18f68c02e13b7bddbce3aa` |

## Remaining evidence

| Requirement | Available evidence | Still needed |
| --- | --- | --- |
| Moving sample-to-marker p50/p95/p99 | Stationary device HTTP and RTDB observer timings only | Correlated device, browser listener, and first marker-paint exports across normal and weak-network phases; at least 1,000 accepted moving samples overall, phase-specific counts and clock uncertainty |
| Message-write-to-listener p50/p95/p99 | Instrumentation and analyzer tests | At least 100 new HTTP 201 chat creates per network profile with server-backed listener delivery, losses/retries reported separately, and a second recipient tab |
| Disconnect recovery | Stationary tunnel/backend response faults | At least 10 browser offline/recovery cycles with independently recorded network-restoration times, reconnection and fresh marker paints |
| Listener payload size | Instrumentation and analyzer tests | Real uncached bus/chat callback captures by network and tab-count profile; disclose metadata-callback overhead |
| Physical connections and Firebase usage | No matching usage capture found | Same-window peak RTDB connections, downloaded bytes, Firestore reads, evidence reference, aggregation scope/delay, and agreed cost ceiling |
| Final measured transport decision | ADR with existing bench/region evidence and proposed gates | Compare the field results with the preregistered targets, diagnose failures, and update the keep/change conclusion |

The source findings remain linked in the ADR: #159's real-drive gate, #160's
representative ingestion load, #169's region comparison, and #174's contention
measurement. Their historical issue closure does not establish that deferred
field measurements occurred. Hosting constraints remain coordinated with #122.

## Capture readiness on October 1

Readiness was checked directly rather than inferred from the historical docs.
A read-only query of `activeBuses` in the RTDB instance configured in the
primary checkout returned zero records at `2026-10-01T09:47:21Z`. This is a
point-in-time availability check, not a latency/usage benchmark or proof about
other deployments. Both inspected frontend environment files configured the
same test-backend origin; that configuration alone does not establish what a
remote deployment is currently running.

The inspected machine exposed no serial device, no local backend listener on
the documented ports, and no signed-in Eki app tab. Its configured test-backend
health URL returned HTTP 404. Searches of the project captures, Downloads,
Documents/Codex, and accessible Drive metadata did not find a browser trace or
matching Firebase usage capture for this experiment. This is a finding about
the inspected sources, not proof that no archive exists elsewhere.

To complete the experiment, use a moving device, an available authenticated
backend and signed-in browser, and access to the measured Firebase project's
usage view. Follow the [capture runbook](../operations/REALTIME_TRANSPORT_MEASUREMENTS.md)
and record the actual deployed commits and environment; a local source commit
alone does not identify what ran in a historical capture.

Produce the telemetry and realtime reports from those real captures, archive
their raw evidence privately, publish aggregate results, and update the
[ADR](../design/REALTIME_TRANSPORT_DECISION.md). Close #195 only after the
measurement and measured-decision rows above are complete. Synthetic fixtures
verify analysis code and must remain labeled as tests.
