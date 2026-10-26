# Passenger map and disconnect verification

Updated 2026-10-26 (Asia/Calcutta). Branch: `codex/gnss-auto-service`, PR #381.

The reported failures were reproduced in signed-in Chrome against the actual
Next.js app at localhost:3000 before changes. Attached screenshots and historical
audit claims were evidence to investigate, not proof of correctness.

## Changes

- Tracking uses a full-height map behind its controls. At the reported 440×956
  viewport the map previously began at y=217; it now begins at y=0 and is 956px
  high. Measured header insets position map notices/camera controls and pad the
  overview. Opaque notices remain readable over light Google map tiles.
- Hidden screen transitions cannot scroll the tracking frame upward. Browser
  testing found and reproduced a separate 32px clipping case before this fix.
  Short screens also use a smaller minimum home illustration spacer.
- New route and bus choices require fresh online telemetry. A durable session
  does not advertise availability after GPS silence or explicit device loss.
  Catalog receipts expire independently per bus, even without another event.
  Conservative 30s receipt buckets expire 60–90s after the last fix and bound
  ordinary catalog heartbeat changes to two per minute per bus.
- Existing tracking retains the selected bus and last location through a gap,
  displays “Live tracking paused”, and suppresses boarding, chat and live ETAs.
  Returning telemetry restores the same view. Detail-read errors hide choices
  without detaching the listener required for recovery. No completion/feedback
  is invented from a disconnect.
- New selections prefer a fresh bus when another bus on the same route is
  stale. Existing viewers keep their selected identity until explicitly switching.
  Overview includes the bus even when it is outside the configured route, and
  subsequent fixes do not repeatedly override manual framing.

## Browser observations

The user's real stationary receiver was unplugged and reconnected with network,
npm and ngrok left running. After the fix, the open map showed paused tracking
and its last location; a separate passenger tab offered no stale route. On
reconnection both views recovered automatically without refresh. The receiver
was left connected. A separate earlier recovery delay was caused by the tracking
board's network being off; it was not treated as a software pass.

Interactive isolated browser checks covered explicit offline status, silent
telemetry, passenger disconnection, retry/permission failure, one fresh bus among
stale buses, dropdown selection, expanded sheet, recovery, and small/short screens.
This is a before/after functional comparison, not a statistical A/B experiment.

The real stationary service is direction-pending. Numeric stop ETAs require a
confirmed travel order; a fabricated direction/arrival time was not published.
In isolated actual-component browser replays, credible movement through the real
backend direction/reducer functions produced 1/2/3-minute destination ETAs in
both directions. A fix outside 2.5m left the stop upcoming; a fix inside marked
it passed, retained covered road in gray, and updated later ETAs to 1/2 minutes.
Detour/rejoin and repeated-road itinerary cases were also exercised.

## Automated validation

- Full primary run: 159 script checks, 1,283 backend tests and 800 frontend tests
  passed (2,242 total). Emulator-only tests are separately excluded from unit runs.
- Subsequent focused checks passed: 43 map/recovery tests and 48 workspace tests.
  These overlap the primary count and are not added to it.
- 30 layout browser executions passed across 360×800, 390×844, 440×956,
  1280×585 and 1280×800. Ten ETA/progress/detour browser executions passed.
- Lint, strict production export/SW/CSP/backend contract checks, OpenAPI (71
  operations), static QA checks and the changed-source coverage budget passed.
- All 44 Firebase browser integration executions passed on the final full run,
  using real disposable Auth/Firestore/RTDB and
  backend HTTP. Its seed now calls the actual availability producer, replacing
  its obsolete hard-coded catalog shape. An earlier full run passed 43 cases
  with one timeout loading the sign-in fixture before application interaction;
  the complete rerun passed without concurrent build/lint work.

Private screenshots/logs are under ignored `artifacts/qa/passenger-browser-fixes-2026-10-26/`
in the live worktree; automated logs are in the isolated audit worktree.
Location screenshots and historical ZIP contents are not published in the PR.

## Limits and rollout

Physical moving-road acceptance, real departure/arrival accuracy, field network
handover and live provider latency remain distinct from stationary hardware and
synthetic movement evidence. The broad historical acceptance catalog still
reports `NOT_RELEASE_READY`; this targeted fix does not certify every case.
Deploy the backend catalog producer with the frontend: an old publisher without
active receipts fails closed until its compatible backfill. No Firebase read
permissions were widened. Existing CodeRabbit findings were rechecked against
the source and regressions; that is not a claim of a fresh bot approval.
