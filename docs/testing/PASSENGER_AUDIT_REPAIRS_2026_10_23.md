# Passenger audit repairs: 23 October 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-029 | 1.0 | Historical | 2026-10-23 |

Scope: follow-up changes on PR #364, `codex/fix-deployment-readiness`, based on
`75f1333cc47d91e3ce612d3c5099d09eda718302`. The supplied ZIP and two recordings
are evidence to verify, not authorization to change authentication or providers.
Raw recordings, private histories and local environment files are not committed.

## Verified findings and repairs

- Both recordings show **Direction pending** during movement. Existing ETA and
  completed-road rendering deliberately require resolved, authoritative progress.
  Departure recovery now tolerates up to 2.5 m of backstep from its furthest
  accepted first-leg match. It still requires at least three credible samples,
  30 m net travel, fresh timestamps, road alignment and one qualifying direction.
  Mid-route movement cannot invent a service direction or served stops.
- Automatic stop arrival now uses the requested **2.5 m** circle, for both accepted
  fixes and bounded between-fix crossings. Tests distinguish 2.6 m outside from
  2.4 m inside. Origin departure retains its independent 10 m minimum, including
  closely spaced stops. Terminal quality/dwell and ordered-history rules remain enforced.
- ETA stop projection now follows the ordered itinerary on complete configured
  paths. Revisiting a road or the origin no longer projects a later stop onto
  its first visit. Projection work is cached and bounded; partial paths retain
  their fallback. Bus position uses the authoritative active leg so identical
  coordinates/headings on later visits cannot reuse an earlier cumulative position.
  Session, stop progress and itinerary changes invalidate that position cache;
  known partial reroutes use their immutable first required stop. The independent
  UI clock no longer publishes estimates twice.
- The passenger marker is one upright bus icon with a separate heading pointer,
  accessible vehicle/status text, centered anchors and priority above stop pins.
  Missing authoritative progress gets an explicit unavailable label.
- Hosted cross-workspace links were observed stuck in pending navigation while
  direct document navigation worked. After five seconds, a pending same-origin
  workspace link now performs a plain document navigation. Fast transitions,
  cancellation, external links and new-tab links retain their normal behavior.
- Vitest worker counts are bounded using its current configuration API, avoiding
  the supplied audit's reproduced worker exhaustion on this Windows host.

The ZIP contains nine Markdown reports, without the referenced raw traces/logs.
Its Next.js version and project descriptions differ from this checkout. Claims
that guest CTAs require removing the role guard were rejected: authenticated data
access is intentional. Direct ngrok browser interstitials are provider behavior;
application API requests already send the skip-warning header.

## Evidence and its limits

Local evidence lives under the ignored directory
`artifacts/qa/interaction-audit/2026-10-23-75f1333/`, including the source census,
per-action ledger, coverage gate, supplied-report triage, build/test logs and
recording contact sheets. Browser screenshots are in `artifacts/passenger-progress/`.

| Check | Observation | Tier |
| --- | --- | --- |
| Repository script tests | 156 passed; OpenAPI/UI contract checks passed | Deterministic source/configuration checks |
| Backend unit/integration suite | 1,262 passed; 64 opt-in tests skipped | Actual ingestion/lifecycle code with controlled adapters |
| Frontend unit/component suite | 774 passed across all 86 files | Controlled SDK and component dependencies |
| Passenger progress browser suite | 8 passed at 390×844 and 1280×800 | Actual workspace, map and selectors; synthetic Maps/Firebase transport |
| Neighboring UI browser suite | 27 passed at 360, 390 and 1280 px | Synthetic provider/HTTP adapters; delayed data, denied reads, labels, edits, history, throttled CPU |
| Lint and production build | Passed; backend TypeScript, Next export and service worker | Local build; strict deployment contract skipped without root backend URL |
| Actual Next export in Chrome | Production CSP hydrates; unauthenticated passenger URL returns to sign-in; no captured warnings/errors | Real export, guest only |
| Existing Hosting in signed-in Chrome | Six admin sections render; passenger/profile render; live-data reconnect remains and client workspace navigation stalled | Live provider observation, deployed revision not attested |
| QA catalog | Valid configuration/mappings; overall verdict remains NOT_RELEASE_READY | Static catalog, not broad acceptance |

The new workspace replay starts with unresolved direction, runs the production
departure inference, opens the destination dropdown, verifies ETA, applies the
production stop reducer outside/inside the circle, and verifies Passed labels,
gray completed road, future ETA and one bus icon in **both directions**. A separate
scenario verifies telemetry-silence expiry and fresh-fix recovery. No synthetic
positions or rides are written to the live project.

PR review follow-up also tests a moving fix 5 m from an origin whose first two
stops are only 8 m apart: it must not depart. A mounted map regression exercises
two visits with identical bus coordinates/heading, then an authoritative progress
correction back to the first visit. An additional mobile/desktop browser replay
verifies that ETA excludes the completed loop on the second visit.

The complete interaction census has 174 source candidates. Unexecuted controls
remain explicit NOT_RUN/BLOCKED/INCONCLUSIVE rows; the coverage gate is expected
to report incomplete coverage. These scoped results do not certify all controls,
live OAuth/Places, physical GNSS accuracy or a moving vehicle.

The existing Hosting deployment still showed an RTDB reconnect banner after
reload. Read-only checks found ready projections, no active service and a working
server-side WebSocket handshake; these do not establish Chrome RTDB delivery or
identify the cause. Authorization was not relaxed. There is no GNSS device for
moving-route acceptance, and 2.5 m arrival needs a real route trial against receiver
noise and sampling cadence. Deployment of the repaired PR and a fresh live-data
browser check remain necessary before claiming deployed tracking acceptance.
