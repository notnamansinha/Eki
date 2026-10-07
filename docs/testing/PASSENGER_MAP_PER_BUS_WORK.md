# Passenger map per-bus work (R18)

Last updated: 2026-10-06 (IST). This is synthetic source and browser evidence for [issue #246](https://github.com/notnamansinha/Eki/issues/246) R18 and [PR #282](https://github.com/notnamansinha/Eki/pull/282).

## Reproduction and measured work

The pre-fix two-bus regression sent a new fix for bus A while bus B's RTDB value was unchanged. Bus B's marker render count changed from **2 to 4**. The same fixture after the change stays at **2 to 2**. The original failing Vitest output is in the ignored local `temp/r18-baseline.log`; the committed assertion is in `PassengerMap.test.tsx`.

The three-stop ETA counter uses one bus and an unchanged path on two calls. The original calculation projects the bus once and all three stops on each call: **4 + 4 projections**. With route-scoped stop positions and an unchanged bus position, the second call makes **0 projections** after the first call's 4. These are counts of deterministic function calls, not CPU time, browser paint time, moving GNSS data, or billed backend work.

## Reuse and invalidation rules

- The passenger map retains a normalized bus object only when every field, including raw and matched location fields, has the same value. A changed bus gets a new object. `React.memo` then skips unrelated marker work, and unchanged buses skip stop-proximity checks.
- ETA selection and bus path position are reused only for the same bus input or an exactly equal point, heading, path, route version and direction. A moved sample or changed context performs the full polyline search. No narrow segment window is trusted on a loop or parallel road.
- Static stop positions are cached in a map instance under route identity, geometry/version and direction. The cache also checks path identity and the complete ordered stop ID/coordinate signature, so edits with an unchanged version are invalidated. It holds at most 16 entries and clears on route switch or unmount.
- Dynamic reroutes retain each bus's own versioned geometry. ETAs wait for the matching reroute geometry; another bus's path is never substituted. When a bus or stop cannot snap, the prior Haversine fallback remains.
- The removed dwell gate only wrote `lastBuzzedStopIdRef`; that ref had no reader or visible effect.

## Verification and limits

Run the focused tests with `npm exec --workspace=frontend -- vitest run src/components/maps/PassengerMap.test.tsx src/lib/busEta.test.ts src/lib/busEta.cache.test.ts src/lib/passengerLiveBus.test.ts src/hooks/useDynamicRouteGeometries.test.ts --maxWorkers=2`. They cover unrelated and changed bus markers; route version, direction, path, stop edit and cleanup; direct, detour, loop, parallel carriageway and off-road ETA equivalence. The full frontend suite should also use two workers on the current Windows host to avoid unrelated default-parallel five-second timeouts.

The isolated passenger and map browser fixtures exercise mobile and desktop view logic with synthetic RTDB and a synthetic Maps adapter. They do not measure a real Google Maps compositor or moving device. Moving-route road confidence, render p50/p95/p99 and real-device latency remain [#245](https://github.com/notnamansinha/Eki/issues/245) acceptance; R34 stays open.
