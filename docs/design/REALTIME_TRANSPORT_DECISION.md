# Realtime transport decision (#195)

Last updated: 2026-10-04 14:20 IST (UTC+05:30).

Date: 2026-10-01. Source baseline: `testing` at `e5d41be`.
Status: retain Firebase SDK listeners; moving/weak-network acceptance remains
pending. This ADR records a decision and an experiment, not a claim that the
field performance gate has passed.

## Current requirement and decision

Signed-in browser clients need live bus locations and bounded ride chat. The
shared `liveBusStore` observes compact RTDB `publicRouteBuses/{routeId}/buses` paths for passengers and the public fleet root for trusted admins. The browser performs an initial sync and then applies child deltas. Route selection reads `liveRouteCatalog/values` counts; raw `activeBuses` is backend-only. Firestore SDK listeners serve messages, settings, routes and history. Admin
feedback review now uses bounded authenticated `GET /api/v2/feedback` reads. Chat reads the latest 200 documents; authenticated HTTP performs
bounded writes. Firebase already supplies authentication, reconnection, and
cross-replica delivery. No current client requires a separate streaming API.

Keep those listeners. First evaluate narrower authorized paths, query bounds,
data shape, and region placement with the existing optimization issues.
Introducing another transport would add token handling, durable replay,
buffers, and replica fan-out without evidence that it fixes the bottleneck.
This change adds opt-in measurement to existing listeners, not another feed.

## Available evidence and its limits

| Evidence | Actual result | What it cannot establish |
|---|---|---|
| [Stationary ESP32 capture](../testing/LIVE_ESP32_LATENCY_RESULT.md) | 63 HTTP 202 requests: HTTP p50 565 ms, p95 1,122 ms; backend p50 416 ms, p95 974 ms. Observer gaps p50 926 ms, p95 1,678 ms. | Moving sample-to-marker, browser paint, chat, or weak-network recovery percentiles. HTTP and observer gaps are different metrics. |
| [RTDB region decision](RTDB_REGION_LATENCY_DECISION.md), probe C | 30 warm Iowa Admin reads: p50 270.1 ms, p95 272.8 ms, p99 650 ms. | Authenticated browser subscription latency or an actual Singapore deployment. Front-door probes are not listener measurements. |
| [#159 field gate](https://github.com/notnamansinha/Eki/issues/159#issuecomment-5916464084) | Instrumentation merged; moving/stopped/reconnect capture still deferred. | Successful real-drive acceptance. |
| [#160 ingestion gate](https://github.com/notnamansinha/Eki/issues/160#issuecomment-5916465326) | Implementation merged; representative multi-replica load capture deferred. | Production contention and capacity bounds. |
| [#169 region findings](https://github.com/notnamansinha/Eki/issues/169#issuecomment-5916258104) | Region probes and migration preparation recorded. | A completed region cutover or measured browser improvement. |
| [#174 partition gate](https://github.com/notnamansinha/Eki/issues/174#issuecomment-5916470391) | Implementation merged; 1,000-sample moving/poor-network/contention gate deferred. | Evidence that a state split or new transport is necessary. |

No comparable message delivery, physical connection count, or same-window
Firebase usage capture is currently archived. These values remain unmeasured;
synthetic tests below validate the measurement code only.

The [October 1 evidence audit](../testing/REALTIME_TRANSPORT_EVIDENCE_AUDIT.md)
recomputed the private bench captures: a longer stationary readiness run has
594 parsed requests (593 accepted), with HTTP p50/p95/p99 of 450/1,065/1,271 ms;
a separate recovery run has 208 requests (194 accepted), at 590/1,443/2,265 ms.
Both record only stopped `device_http` events. The readiness log has one
additional malformed trace line; the recovery window includes injected response
faults. Neither supplies moving/weak-network browser, chat, or Firebase usage
evidence. Separate windows are not pooled to satisfy the field sample gate.

## Preregistered experiment targets

The [October 2 live audit](../testing/LIVE_LATENCY_RECOVERY_AUDIT_2026_10_02.md) adds stationary device, Admin observer and RTDB profiler evidence. It strengthens the case for measuring regional round trips and transport tail gaps, while leaving the browser/chat/billing acceptance gates below pending. The keep-Firebase decision is unchanged.

These are initial evaluation targets, not published service guarantees. Record
any revision before the run, along with the reason. Use the
[measurement runbook](../operations/REALTIME_TRANSPORT_MEASUREMENTS.md).

| Metric | Proposed gate | Qualification |
|---|---|---|
| Moving sample to first marker paint | p95 <= 2 s; p99 <= 5 s | At approximately 1 Hz; report correlation coverage and clock uncertainty. Cross-clock estimates with uncertainty > 100 ms do not establish this gate. |
| New chat HTTP send-start to server-backed listener | p95 <= 1 s; p99 <= 3 s | Same sender tab, HTTP 201 only; cached docs and HTTP 200 retry replays excluded. This is not backend-commit latency or delivery to every recipient. |
| Reconnect after network restoration | Connected and fresh painted sample each <= 5 s | Record restoration time separately. Analyzer false-to-true intervals include the outage and cannot alone prove this target. |
| Payload, connection count, usage | Report by load profile, with an agreed cost ceiling before deployment | Application JSON size and logical watches are estimates; physical RTDB connections/downloads and Firestore reads require Firebase usage evidence. No budget is invented here. |

Collect at least 1,000 accepted moving samples across normal and weak-network
phases, 100 new chat writes per profile, and 10 recovery cycles. Report sample
counts per phase, losses, retries, timeouts, unpaired creates, unclosed outages,
and startup separately. A pooled percentile cannot certify a sparsely sampled
weak-network phase. Compare controlled 1/10/50-tab runs and identify background
traffic in the Firebase usage window. Respect actual chat rate limits.

If targets fail, identify device queueing, HTTP/backend time, RTDB delivery,
rendering, and clock error first. Reuse #159/#160/#169/#174 evidence and fixes;
do not infer that a transport switch fixes ingestion or geography. Coordinate
region and long-lived connection support with [#122](https://github.com/notnamansinha/Eki/issues/122).

## Gates for alternative interfaces

| Interface | Current decision | Requirement and design gate before implementation |
|---|---|---|
| SSE | Defer | A named client needs a server-owned, one-way feed and cannot use the Firebase SDK. Define its permitted data and latency/cost targets. Specify Firebase ID-token validation without secrets in URLs, token refresh, event IDs and retention, Last-Event-ID resume, heartbeats, bounded per-client buffers, slow-client disconnects, and cross-replica fan-out. Verify hosting supports long-lived responses. |
| WebSocket | Defer | A named client requires bidirectional low-latency interaction that bounded HTTP writes cannot meet. Specify token renewal, reconnect/resume, cross-replica synchronization, bounded queues/backpressure, hosting limits, and measured connection cost. Chat alone does not establish this requirement. |
| GraphQL | Defer | Existing bounded queries and HTTP resources satisfy current reads/writes. A concrete query composition requirement must justify authorization, query-cost limits, and another schema; GraphQL does not itself solve realtime delivery. |
| Webhooks | Defer | There is no current external subscriber requiring outbound event delivery. A real integration must define event scope, signed payloads, replay protection, idempotency, durable outbox, bounded retries, and receiver failure handling. |

For an alternative pilot, compare the same authorized data, scenario, sample
count, and deployment. A latency-driven switch should improve failing p95 by
at least 30%, meet the preregistered p99/recovery gates, preserve authorization,
and stay within the agreed cost ceiling. A client compatibility requirement
can justify a separate adapter without replacing Firebase for browser clients.
Neither case authorizes a speculative deployment or region cutover.

## Consequences and closure

The existing SDK connection reuse and query limits remain the production
architecture. Tracing is explicit (`?telemetryTrace=1`), memory bounded, and
does not export message text, coordinates, or tokens. Opt-in metadata callbacks
confirm server-backed Firestore delivery; they may affect local callback work
and must be disclosed when comparing runs. Disabled tracing adds no listener.

Complete #195's measurement checkbox only after archiving the field report,
usage window, exact commit/deployment, and keep/change conclusion. Review this
ADR with those results. The implemented decision and capture tooling do not
close that external gate.
