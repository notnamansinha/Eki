# Story e01s04 — Add accuracy-aware directional GNSS map matching

> status: todo · bcps: 7 · risk: P1 · type: fix · context: firmware + backend + frontend
> delta: MODIFIED · source: issue #149 problem 4 · spec: e01s04-gnss-accuracy-matching.md
> depends_on: e01s02 · decision: firmware + frontend in scope (user-approved)

## Context

The marker renders the accepted raw telemetry coordinate directly: GNSS drift and discrete position
jumps put the bus off-road or on a parallel road. Matching must use direction, heading, continuity,
and confidence — never the opposite-direction geometry.

Verified facts on this branch:

- Firmware already computes fix quality: `hardware/src/main.cpp` checks `gps.hdop.isValid()`,
  `hdop.age()`, `hdop > HDOP_REJECT_THRESHOLD`, and stores `fix.gpsHdop = gps.hdop.hdop()`;
  `telemetry_policy.h` has `hdopValid`/`hdopAgeMs`/`GNSS_FIX_MAX_AGE_MS`.
- Backend telemetry handling shows no `accuracy`/`hdop` passthrough in the grepped service files —
  the quality field may stop at the device layer or in the payload.
- `frontend/src/lib/snapToPolyline.ts` and `liveBusMarkerPosition.ts` exist with test suites but no
  directional/confidence matching per the issue.

**Module purpose (zoom-out):** snapToPolyline projects a raw fix onto a route; liveBusMarkerPosition
decides the rendered marker coordinate. **Callers:** PassengerMap, DashboardPanel. **Contracts:**
pure geometry helpers (existing tests) + marker output shape. Firmware contract: telemetry payload
quality fields must survive to the API.

## Requirements

#### MODIFIED: Telemetry carries fix quality
**Before:** Fix quality (HDOP/accuracy) is computed on device but not necessarily transmitted or
validated end to end.
**After:** The telemetry payload includes accuracy/HDOP when a fix is valid; backend validates and
forwards it; quality-aware fields are documented in the telemetry contract.

#### ADDED: Directional, confidence-gated map matching
**Before:** Marker uses raw accepted coordinates; no heading, continuity, or confidence logic.
**After:** Matching uses the resolved direction's geometry, heading, previous matched segment,
maximum segment jump, distance from route, and monotonic route progress, with a confidence
threshold. Never match against the opposite-direction geometry.

#### ADDED: Low-confidence fixes stay raw with an indicator
**Before:** n/a.
**After:** When matching is ambiguous, render the raw fix with an accuracy indicator instead of a
blind snap.

## Acceptance Criteria

- [ ] Firmware emits fix accuracy/HDOP in the payload (valid fix only).
- [ ] Backend validates and forwards the quality field; contract tests cover it.
- [ ] Matcher considers direction, heading, continuity, max jump, distance-from-route, and
      monotonic progress.
- [ ] Opposite-direction geometry is never a match target.
- [ ] Ambiguous fixes render raw with an accuracy indicator.
- [ ] Slow-3G/offline behavior unchanged (manual gate per docs/operations checklist).

## Out of Scope

- New GNSS hardware or rejection of the current HDOP_REJECT policy (exists; reuse).
- Real-time position smoothing beyond the confidence rule in this issue.

## Risks

- Firmware payload change needs device reflash to observe live; land firmware + tests first so CI
  firmware job proves it, then UAT on a device.
- Matcher tuning is fixture-sensitive: pin divided-road + parallel-road fixtures in tests.

## Files

- `hardware/src/main.cpp` / `hardware/include/telemetry_policy.h` — payload quality field
- backend telemetry validation (`backend/src/services/telemetryRouteService.ts` + payload schema)
- `frontend/src/lib/snapToPolyline.ts`, `frontend/src/lib/liveBusMarkerPosition.ts`,
  `frontend/src/lib/markerHeading.ts` — directional confidence matcher
- `frontend/src/components/maps/PassengerMap.tsx`, `frontend/src/components/admin/DashboardPanel.tsx`
- tests: `frontend/src/lib/snapToPolyline.test.ts`, `liveBusMarkerPosition.test.ts`,
  `markerHeading.test.ts`; firmware native tests; backend telemetry tests

## Verification Script

1. `platformio test --project-dir hardware -e native` green.
2. Backend telemetry contract test green; `npm run verify` green.
3. Manual (UAT): on a divided road, confirm the marker stays on the bus's carriageway and snaps
   forward monotonically; switch off accuracy and confirm the raw-fix + indicator path.
