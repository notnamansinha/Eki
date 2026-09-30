# Adaptive GNSS trace validation

Status: **blocked pending the #159 recorded-trace attachment**.

Issue #162 requires the proposed 15–50 m adaptive envelope to be evaluated
against the real-drive traces from issue #159 before merge. The current #159
issue has capture requirements but no attached trace files or downloadable
dataset, and this checkout contains no trace fixtures. The results below are
therefore intentionally not presented as real-drive evidence.

## Executable checks available in this checkout

`backend/src/lib/telemetryMotion.test.ts` covers the envelope bounds, missing
HDOP, stationary multipath rejection, short-gap plausibility, and the exact
five-minute reacquisition boundary. The corresponding firmware policy tests
cover the same 15–50 m bounds and transition behavior.

## Required trace report before merge

Replay the #159 samples with the proposed policy and attach the raw trace plus
a result table containing, for each sample, the envelope, accepted/held
decision, display decision, route decision, and reacquisition state. Summarize
at minimum:

| Scenario | Required observation |
|---|---|
| Stationary multipath | noisy fixes are held and do not move display/route state |
| Short and long gaps | short gaps remain bounded; a gap over five minutes permits reacquisition |
| Intersections | ambiguous competing geometry is held rather than blindly snapped |
| Parallel carriageways | heading/continuity preserve the correct carriageway or hold the fix |

No real-drive accepted/held counts or scenario outcomes can be claimed until
the #159 traces are supplied and replayed.
