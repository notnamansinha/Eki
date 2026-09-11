# Reroute latency simulation (2026-09-10)

This is deterministic pre-deployment evidence, not a substitute for the real-drive run in `LIVE_DEMO_RUNBOOK.md`. The cases are executable in `routeMatching.test.ts`, `latestPendingScheduler.test.ts`, `googleMaps.test.ts`, and `telemetryRouteService.test.ts`.

## Validated policy

| Scenario | Expected/observed decision in the deterministic suite |
|---|---|
| Measured deviation at least 120 m | Confirm on the first reliable moving fix |
| Ordinary measured deviation over 60 m | Confirm on the second consecutive reliable moving fix |
| Missing route match | Possible deviation only; never strong confirmation |
| Parallel carriageways | Heading selects the matching travel direction |
| Crossing/U-turn-like backward candidate | Previous progress penalizes the backward segment |
| Stationary or unverified-HDOP noise | Does not increment confirmation count |

The false-reroute result for the three ambiguous/noise fixtures (parallel carriageway, missing match, stationary noise) is 0/3. This is a regression-fixture result, not a field false-positive rate.

## Latency bound

Moving hardware publishes once per second. With no queue backlog, strong deviation detection begins on the current accepted sample and ordinary detection on the next reliable sample (nominally one second later). Live routing uses `TRAFFIC_AWARE` with a measured/tested 3.5-second abort deadline. Therefore the code-path bound before the final RTDB activation transaction is:

- strong measured turn: 3.5 seconds plus ingestion/transaction/network propagation;
- ordinary measured turn: 4.5 seconds plus ingestion/transaction/network propagation.

The scheduler retains one in-flight and only the newest pending fix per bus. Its load test schedules three fixes while one is blocked and processes `[first, latest]`, proving queue depth is bounded at two and stale middle fixes cannot add an unbounded latency tail. Admin `/api/health` reports coalesced count and last/max queue age for deployment measurement.

## Field acceptance still required

Record at least the straight-to-left, parallel-road, safe U-turn, and stationary-noise drives. Capture fix receive time, off-route confirmation, reroute request/completion, browser geometry visibility, queue age, Routes duration, and false triggers. Keep or revise the 120 m / two-sample / 3.5-second policy from those distributions; do not tune from this small deterministic fixture set alone.
