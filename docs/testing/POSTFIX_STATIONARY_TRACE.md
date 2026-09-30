# Telemetry latency baseline

Generated: 2026-09-13T17:37:07.019Z

Clock offset uses the four HTTP timestamps. The uncertainty column is half of the network-only round trip; cross-clock latency values should be read with that bound.
Use one device per input. Capture gaps describe accepted samples, not the underlying GNSS sampling cadence. Missing or malformed records limit gap and failure counts.

## Correlation coverage

- Accepted device samples: 175
- Missing browser listener correlation: 175
- Missing marker-render correlation: 175
- Missing clock estimate: 1

## Delivery and connection counts

- requests: 175
- malformedTraceLines: 1
- httpFailures: 0
- retries: 0
- tlsConnectionAttempts: 1
- tlsReconnects: 0
- clockDiscontinuities: 1
- Gaps >2 s: 4
- Gaps >5 s: 0

## Every gap >2 seconds (largest first)

| Sequence | Scenario | Stage | Gap ms |
|---|---|---|---:|
| 55 | unclassified | backendIngressUpdateGapMs | 2382 |
| 3 | unclassified | captureUpdateGapMs | 2351 |
| 178 | unclassified | captureUpdateGapMs | 2005 |
| 178 | unclassified | backendIngressUpdateGapMs | 2003 |

## TLS connection timing (ms)

| Metric | Samples | Average | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|
| DNS | 1 | 65 | 65 | 65 | 65 | 65 |
| TCP/TLS | 1 | 958 | 958 | 958 | 958 | 958 |
| Key preparation | 1 | 355 | 355 | 355 | 355 | 355 |

## Overall latency (ms)

| Metric | Samples | Average | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|
| Device queue | 175 | 36.2 | 8 | 186 | 246 | 363 |
| HTTP round trip | 175 | 660.1 | 567 | 1144 | 1320 | 2032 |
| Clock offset estimate | 174 | -52 | -53 | -29.5 | -20 | 50.5 |
| Clock uncertainty | 174 | 62.1 | 60 | 84.5 | 110.5 | 151.5 |
| Device send → backend ingress | 174 | 62.1 | 60 | 84.5 | 110.5 | 151.5 |
| Backend request | 175 | 531 | 440 | 1010 | 1049 | 1190 |
| Backend ingress → RTDB commit | 0 | — | — | — | — | — |
| RTDB commit → browser listener | 0 | — | — | — | — | — |
| Browser listener → first marker render | 0 | — | — | — | — | — |
| Capture → first marker render | 0 | — | — | — | — | — |
| Capture gap between accepted samples | 174 | 1021.1 | 1000 | 1026 | 2005 | 2351 |
| Backend ingress update gap | 174 | 1010.4 | 1004 | 1159 | 2003 | 2382 |
| Browser listener update gap | 0 | — | — | — | — | — |
| Browser marker-render update gap | 0 | — | — | — | — | — |

## Additional clock-adjusted intervals (ms)

| Metric | Samples | Average | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|
| Sample to backend (offset estimate) | 174 | 97.9 | 72.5 | 249 | 366.5 | 411.5 |
| Backend to browser | 0 | — | — | — | — | — |

## Scenario: unclassified (ms)

| Metric | Samples | Average | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|
| Device queue | 175 | 36.2 | 8 | 186 | 246 | 363 |
| HTTP round trip | 175 | 660.1 | 567 | 1144 | 1320 | 2032 |
| Clock offset estimate | 174 | -52 | -53 | -29.5 | -20 | 50.5 |
| Clock uncertainty | 174 | 62.1 | 60 | 84.5 | 110.5 | 151.5 |
| Device send → backend ingress | 174 | 62.1 | 60 | 84.5 | 110.5 | 151.5 |
| Backend request | 175 | 531 | 440 | 1010 | 1049 | 1190 |
| Backend ingress → RTDB commit | 0 | — | — | — | — | — |
| RTDB commit → browser listener | 0 | — | — | — | — | — |
| Browser listener → first marker render | 0 | — | — | — | — | — |
| Capture → first marker render | 0 | — | — | — | — | — |
| Capture gap between accepted samples | 174 | 1021.1 | 1000 | 1026 | 2005 | 2351 |
| Backend ingress update gap | 174 | 1010.4 | 1004 | 1159 | 2003 | 2382 |
| Browser listener update gap | 0 | — | — | — | — | — |
| Browser marker-render update gap | 0 | — | — | — | — | — |
