# Realtime Transport Decision

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-ADR-001 | 1.0 | Current | 2026-10-30 |

## 1. Context

Decision date: 2026-10-01. Source baseline: `testing` at `e5d41be`. Issue: [#195](https://github.com/notnamansinha/Eki/issues/195).

Signed-in browser clients need live bus locations and bounded ride chat. The browser receives them as follows:

| Data | Delivery |
|---|---|
| Live buses | The shared `liveBusStore` (`frontend/src/lib/liveBusStore.ts`) listens to `publicRouteBuses/route:{routeId}/buses` for passengers and to the `publicRouteBuses` root for current administrators. It performs an initial sync and then applies child deltas. Raw `activeBuses` is backend-only |
| Route selection | `liveRouteCatalog/values` counts and `clientProjectionStatus/public` |
| Messages | Firestore listener on the latest 200 documents; writes go through authenticated HTTP |
| Settings, routes, ride history | Firestore SDK listeners and reads |
| Feedback | One-shot Firestore reads of the latest 200 records and transactional writes from the browser (`frontend/src/lib/feedbackStore.ts`); no listener and no backend call |

Firebase already supplies authentication, reconnection and delivery across backend replicas. The question is whether a separate streaming or query interface should replace or complement these listeners.

## 2. Decision

Keep the Firebase SDK listeners. Before considering another transport, evaluate narrower authorized paths, query bounds, data shape and region placement. Another transport would add token handling, durable replay, buffers and fan-out across replicas without evidence that it removes a bottleneck. The change that recorded this decision added opt-in measurement to the existing listeners, not another feed.

## 3. Status

Accepted on 2026-10-01 and in force. The field performance gate in Section 6.2 has not passed: moving and weak-network acceptance remains pending. Review this decision when those results exist.

## 4. Consequences

1. SDK connection reuse and query limits remain the production architecture.
2. Tracing is explicit (`?telemetryTrace=1`), memory bounded, and does not export message text, coordinates or tokens. When tracing is on, metadata callbacks confirm server-backed Firestore delivery; they can add local callback work, so disclose them when comparing runs. Disabled tracing adds no listener.
3. The measurement checkbox in #195 is completed only after the field report, the Firebase usage window, the exact commit and deployment, and the keep or change conclusion are archived. The implemented decision and capture tooling do not close that gate.

## 5. Alternatives considered

| Interface | Decision | Requirement and design gate before implementation |
|---|---|---|
| Server-Sent Events (SSE) | Defer | A named client needs a server-owned, one-way feed and cannot use the Firebase SDK. Define its permitted data and latency and cost targets. Specify Firebase ID-token validation without secrets in URLs, token refresh, event IDs and retention, `Last-Event-ID` resume, heartbeats, bounded per-client buffers, slow-client disconnects and cross-replica fan-out. Verify that hosting supports long-lived responses |
| WebSocket | Defer | A named client requires bidirectional low-latency interaction that bounded HTTP writes cannot meet. Specify token renewal, reconnect and resume, cross-replica synchronization, bounded queues and backpressure, hosting limits and measured connection cost. Chat alone does not establish this requirement |
| GraphQL | Defer | Existing bounded queries and HTTP resources satisfy current reads and writes. A concrete query composition requirement must justify authorization, query-cost limits and another schema. GraphQL does not itself solve realtime delivery |
| Webhooks | Defer | No external subscriber needs outbound event delivery. A real integration must define event scope, signed payloads, replay protection, idempotency, a durable outbox, bounded retries and receiver failure handling |

A pilot of any alternative shall compare the same authorized data, scenario, sample count and deployment. A latency-driven switch shall improve the failing p95 by at least 30%, meet the preregistered p99 and recovery gates, preserve authorization and stay within the agreed cost ceiling. A client compatibility requirement can justify a separate adapter without replacing Firebase for browser clients. Neither case authorizes a speculative deployment or region cutover.

## 6. Evidence

### 6.1 Available evidence and its limits

| Evidence | Recorded result | What it cannot establish |
|---|---|---|
| [Stationary ESP32 capture](../testing/LIVE_ESP32_LATENCY_RESULT.md) | 63 HTTP 202 requests: HTTP p50 565 ms, p95 1,122 ms; backend p50 416 ms, p95 974 ms. Observer gaps p50 926 ms, p95 1,678 ms | Moving sample-to-marker, browser paint, chat or weak-network recovery percentiles. HTTP and observer gaps are different metrics |
| [RTDB region decision](RTDB_REGION_LATENCY_DECISION.md), probe C | 30 warm Iowa Admin reads: p50 270.1 ms, p95 272.8 ms, p99 650 ms | Authenticated browser subscription latency or an actual Singapore deployment. Front-door probes are not listener measurements |
| [#159 field gate](https://github.com/notnamansinha/Eki/issues/159#issuecomment-5916464084) | Instrumentation merged; moving, stopped and reconnect capture deferred | Successful real-drive acceptance |
| [#160 ingestion gate](https://github.com/notnamansinha/Eki/issues/160#issuecomment-5916465326) | Implementation merged; representative multi-replica load capture deferred | Production contention and capacity bounds |
| [#169 region findings](https://github.com/notnamansinha/Eki/issues/169#issuecomment-5916258104) | Region probes and migration preparation recorded | A completed region cutover or measured browser improvement |
| [#174 partition gate](https://github.com/notnamansinha/Eki/issues/174#issuecomment-5916470391) | Implementation merged; 1,000-sample moving, poor-network and contention gate deferred | Evidence that a state split or new transport is necessary |

No comparable message delivery, physical connection count or same-window Firebase usage capture is archived. These values remain unmeasured; the synthetic tests validate the measurement code only.

The [October 1 evidence audit](../testing/REALTIME_TRANSPORT_EVIDENCE_AUDIT.md) recomputed the private bench captures. A longer stationary readiness run has 594 parsed requests (593 accepted), with HTTP p50/p95/p99 of 450/1,065/1,271 ms. A separate recovery run has 208 requests (194 accepted), at 590/1,443/2,265 ms. Both record only stopped `device_http` events. The readiness log has one additional malformed trace line; the recovery window includes injected response faults. Neither supplies moving or weak-network browser, chat or Firebase usage evidence. Separate windows are not pooled to satisfy the field sample gate.

The [October 2 live audit](../testing/LIVE_LATENCY_RECOVERY_AUDIT_2026_10_02.md) adds stationary device, Admin observer and RTDB profiler evidence. It strengthens the case for measuring regional round trips and transport tail gaps, and leaves the browser, chat and billing gates below pending. The decision is unchanged.

### 6.2 Preregistered experiment targets

These are evaluation targets, not published service guarantees. Record any revision, with its reason, before the run. Use the [measurement runbook](../operations/REALTIME_TRANSPORT_MEASUREMENTS.md).

| Metric | Gate | Qualification |
|---|---|---|
| Moving sample to first marker paint | p95 <= 2 s; p99 <= 5 s | At approximately 1 Hz; report correlation coverage and clock uncertainty. Cross-clock estimates with uncertainty > 100 ms do not establish this gate |
| New chat HTTP send-start to server-backed listener | p95 <= 1 s; p99 <= 3 s | Same sender tab, HTTP 201 only; cached documents and HTTP 200 retry replays excluded. This is not backend commit latency or delivery to every recipient |
| Reconnect after network restoration | Connected and fresh painted sample, each <= 5 s | Record restoration time separately. Analyzer false-to-true intervals include the outage and cannot alone prove this target |
| Payload, connection count, usage | Report by load profile, with a cost ceiling agreed before deployment | Application JSON size and logical watches are estimates; physical RTDB connections and downloads and Firestore reads require Firebase usage evidence. No budget is set here |

Collect at least 1,000 accepted moving samples across normal and weak-network phases, 100 new chat writes per profile, and 10 recovery cycles. Report sample counts per phase, losses, retries, timeouts, unpaired creates, unclosed outages and startup separately. A pooled percentile cannot certify a sparsely sampled weak-network phase. Compare controlled 1, 10 and 50-tab runs and identify background traffic in the Firebase usage window. Respect the chat rate limits.

If targets fail, first separate device queueing, HTTP and backend time, RTDB delivery, rendering and clock error. Reuse the #159, #160, #169 and #174 evidence and fixes; do not infer that a transport switch fixes ingestion or geography. Coordinate region and long-lived connection support with [#122](https://github.com/notnamansinha/Eki/issues/122).
