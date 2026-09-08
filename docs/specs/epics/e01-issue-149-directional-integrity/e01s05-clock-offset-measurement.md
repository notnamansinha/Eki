# Story e01s05 — Measure device clock offset separately from transport latency

> status: todo · bcps: 3 · risk: P1 · type: fix · context: backend (+ ops)
> delta: ADDED · source: issue #149 problem 5 · spec: e01s05-clock-offset-measurement.md
> decision: measure-first, firmware NTP audit deferred (user-approved; tracked as follow-up)

## Context

Across two recordings `receivedAt - timestamp` stayed at 8.6–9.2 s while updates still arrived
~1 s apart — the signature of device/server clock skew, not 9 s network hops. The fix is to
measure the components separately and drive freshness from server receipt time when skew is known.

Verified facts:

- Telemetry carries a device `timestamp`; the pipeline has a server receipt time (`receivedAt`),
  used today for freshness decisions.
- The ~9 s constant is not explained by transport; per-hop measurement is missing.

**Module purpose (zoom-out):** telemetry ingestion owns the timestamp/receipt contract.
**Callers:** freshness and staleness logic (frontend delivery/freshness libs), ops dashboards.
**Contracts:** device timestamp preserved for ordering and diagnostics; freshness must not lie
when the device clock drifts.

## Requirements

#### ADDED: Separate clock-offset and latency measurement
**Before:** Only `receivedAt - timestamp` is observable; offset and transport latency are conflated.
**After:** The backend tracks per-device clock offset (`receivedAt - deviceTimestamp` distribution)
separately from device-to-server transport latency and backend/RTDB processing latency. Each is
exposed in metrics and diagnosable from logs.

#### MODIFIED: Freshness uses server receipt time when skew is known
**Before:** Freshness decisions can inherit device clock skew.
**After:** Server receipt time drives freshness when device skew is known; the original device
timestamp stays in the record for diagnostics and ordering.

## Acceptance Criteria

- [ ] Per-device clock offset and transport latency are reported as distinct measures.
- [ ] Freshness decisions use server receipt time once skew is established.
- [ ] Original device timestamps remain in telemetry records, unchanged.
- [ ] A regression test proves a device with a synthetic 9 s offset is treated as fresh (updates
      ~1 s apart) while the offset metric records ~9 s.
- [ ] (Tracked follow-up, not this story) firmware NTP sync audit + last-sync reporting.

## Out of Scope

- Firmware NTP/GNSS clock synchronization changes (deferred; decision recorded in ADR-0001).
- Changing the wire telemetry timestamp semantics.

## Risks

- Reversing freshness to receipt time can mask a genuinely stalled device if transport stalls too.
  Bound: receipt-time freshness uses the device timestamp to detect transport stalls separately.
- Metric cardinality: keep per-device offset aggregation bounded (per-device last-N window).

## Files

- backend telemetry ingestion (`backend/src/routes/devicesTelemetry.ts`,
  `backend/src/services/telemetryRouteService.ts`, background failure tracker/metrics libs)
- freshness consumers: `frontend/src/lib/liveBusFreshness.ts`, `liveBusDelivery.ts` (read-only if
  already receipt-based; assert with tests)
- tests: `backend/src/routes/devicesTelemetry.test.ts`, `frontend/src/lib/liveBusFreshness.test.ts`

## Verification Script

1. Backend tests prove offset vs latency separation with a synthetic 9 s skew.
2. `npm run verify`.
3. Manual (UAT): ingest from a real device; confirm dashboard freshness stays green while the
   offset metric reads the true skew, and device timestamps remain intact in the record.
