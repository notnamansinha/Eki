# Passenger field ride repairs — 29 October 2026

Scope: defects from the 29 Oct 2026 passenger test ride on deployed `main`
(`c4d47b3`), recorded in a 9 min 40 s screen capture and the
`PASSENGER_TEST_RIDE_CLAUDE_HANDOFF.md` evidence report. Raw video and the
report stay outside the repository.

## What the ride showed, and why

| Symptom | Root cause | Repair |
| --- | --- | --- |
| A was marked only on reaching B; B never, even at C | Arrival needed a fix within 2.5 m of a stop pinned a few metres off the lane, and only the next stop could ever advance the ride | 15 m arrival corridor (fix or bounded segment), ordered; `atStopIndex` published on arrival; origin departure 50 m; a stop missed with telemetry running is credited `passed_unobserved` when one of the next two stops is driven through in the route's direction |
| Marker on the wrong side of a divided road | Out-and-back geometry puts both carriageways in one path; a slow fix drifting into the median matched the far side or fell back to raw | Route matcher penalises along-route progress a fresh neighbour cannot explain, only for shortcut candidates (round a loop or turnaround) |
| "Ride in service" stayed green after GNSS loss and after the backend stopped | Header ignored freshness; silence counted as lost after 90 s on a 15 s clock; the single GNSS-loss packet looked fresh | Shared `liveBusHealth` contract: GPS signal lost at once, updates delayed after 12 s, live tracking lost after 30 s, on a client deadline clock; ETAs, boarding and "Bus is here" withheld while not live |
| End ride early missing on desktop | Expanded fleet cards shrank inside the fixed-height desktop list and clipped the action row with no scrollbar | Cards no longer shrink; End ride also in the live details drawer; admins stop by the ride's durable identity |
| "May be off route" flapped at junctions | `POSSIBLE_OFF_ROUTE` (ambiguous match) was announced as a deviation | Only confirmed `OFF_ROUTE` / `REROUTING` are announced |

## Adversarial review

Three independent break-it passes attacked the change; every confirmed
defect was fixed and kept as a regression test:

- Corridor regressions on divided roads: far-kerb stops credited from the
  outbound lane, parked jitter skipping a turnaround, small loops completing
  at the origin, gap credits beyond what the gap could hide, and 5x slower
  gap processing. Repaired with an offside gate (left-hand traffic), strong
  evidence and gap feasibility for credits beyond the next stop, U-turn pair
  disambiguation, direction-first shared-stop passes and prefix sums
  (`tripStateReducer.adversarial/terminal/dwell/performance.test.ts`).
- Plausibility penalty dragging a braking bus backwards after a gap
  (`routeMatchingGapBraking.integration.test.ts`); admin stop requiring
  current admin authority; cold-cache live retirement; stale confirm dialog.
- One GNSS blip resetting the boarding card and chat; the loss packet
  becoming the plausibility anchor so GPS appeared lost after it returned
  (`PassengerWorkspace.trackingBlip.test.tsx`, `deviceTelemetryOutage.test.ts`).

Review follow-ups on the pull request: the progress bound (and the older
progress window) now use the faster of the previous match speed and the
current speed, so a bus that braked to a stop just past a U-turn stays on the
carriageway it reached (`routeMatchingGapBraking.integration.test.ts`); the
boarding header is green only while live, amber for delayed or GPS lost, red
for lost or offline, and never says "Live" without a health reading.

A 1,500-ride ground-truth simulation (pins up to 12 m off the lane, receiver
noise, GNSS gaps, bad fixes, restarts; divided roads, loops, spurs, dense
stops) found no ride worse than `main`, which failed 1,319 of them, mostly by
never completing. About 0.6 % of rides still credited a stop early, mostly
side-road spurs where both directions share one road and identical pins.

## Not established here

The 15 m corridor, the offside gate and the matcher change are validated on
synthetic tracks only. Physical acceptance needs an instrumented ride with the
production receiver on the same route, including the divided-road U-turn.
