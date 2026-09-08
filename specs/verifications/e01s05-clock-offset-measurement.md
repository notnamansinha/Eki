# Verify evidence — e01s05 clock offset vs transport latency

Finding: e01s05 is substantially ALREADY implemented on origin/main.

Backend ingestion already measures components separately
(backend/src/services/deviceTelemetryService.ts):
- networkLatencySamples = serverReceivedAt - sample.deviceSentAt  (true device->server transport, isolated from wall-clock)
- deviceToServerLatencySamples = Date.now() - sample.timestamp    (reveals device clock skew; 24h plausibility guard)
- deviceQueueLatencySamples = deviceSentAt - sample.timestamp
- rtdbWriteLatencySamples + processingLatencySamples
- Live record keeps backendReceivedAt (server receipt) alongside device sampledAt.

Frontend freshness (liveBusFreshness.ts): isLiveBusTimestamp allows up to
10 s forward device-clock skew (observed ~9 s from issue #149 p5 is inside
that tolerance) and BUS_EXPIRY_MS staleness; device timestamp stays the
ordering key (sample.timestamp) for diagnostics.

Residual, optional: make live freshness prefer backendReceivedAt when skew >
tolerance. Not changed: current 10 s tolerance already covers observed skew,
and switching the freshness source is a behavior change with limited upside.

Decision: verified-done (no new code warranted). Firmware NTP audit remains a
tracked follow-up (deferred per ADR-0001). Dev-clock offset is separately
measurable by comparing networkLatency vs deviceToServerLatency samples.
