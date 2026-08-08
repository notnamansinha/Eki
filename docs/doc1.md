 Scope: Full repo scan via 4 recon scouts + 4 design reviewers (2 completed by subagents, 2 synthesized by me after
 provider 403s). All findings verified against source.

 Overall verdict: The architecture is fundamentally sound and, in places, genuinely excellent. The core telemetry
 pipeline (ESP32 → backend → RTDB → client) is a model of clean, server-authoritative design. The system's real risks
 are concentrated in three places: (1) a live authorization gap in session chat/manifest, (2) firmware that loses data
 and can't be updated in the field, and (3) a single backend instance as a SPOF.

 ────────────────────────────────────────────────────────────────────────────────

 🎯 Top 3 Priorities (cross-tier)

 ┌───┬──────────┬─────────────────────────────────────────────────────────────────────────────────────┬───────────────┐
 │ # │ Severity │ Issue                                                                               │ Tier          │
 ├───┼──────────┼─────────────────────────────────────────────────────────────────────────────────────┼───────────────┤
 │ 1 │ HIGH     │ Passenger self-join to any active session — any signed-in user can read sessionId   │ Data/Security │
 │   │          │ from public activeBuses, inject themselves into any session's passenger manifest,   │               │
 │   │          │ then read/post chat for a bus they're not on                                        │               │
 ├───┼──────────┼─────────────────────────────────────────────────────────────────────────────────────┼───────────────┤
 │ 2 │ CRITICAL │ No store-and-forward + blocking TLS in GNSS loop — every connectivity blip          │ Hardware      │
 │   │          │ permanently loses telemetry; worst-case TLS stall is ~2× the RX buffer, silently    │               │
 │   │          │ dropping fixes                                                                      │               │
 ├───┼──────────┼─────────────────────────────────────────────────────────────────────────────────────┼───────────────┤
 │ 3 │ HIGH     │ Single backend instance = SPOF — one container; if it dies, ingestion stops and     │ Backend       │
 │   │          │ live state goes stale                                                               │               │
 └───┴──────────┴─────────────────────────────────────────────────────────────────────────────────────┴───────────────┘

 ────────────────────────────────────────────────────────────────────────────────

 1️⃣ BACKEND — Fundamentally sound; most disciplined tier

 What's designed WELL

 - Server-authoritative boundary actually holds. Closed 6-field telemetry schema enforced on raw bytes; 512-byte parser
   only on the telemetry route (server.ts:130-134). Scrypt + timingSafeEqual + dummy-hash prevents user-enumeration
   timing oracles.
 - Trip lifecycle computed OUTSIDE the request path. Ingest is just an RTDB transaction (timestamp-guarded idempotency
   → 200 dup / 202 new). A leader-elected background engine (Firestore lease, 45s TTL / 15s renew) runs the state
   machine. Correct separation.
 - Pure reducer + feedback loop. tripStateReducer.ts is pure; strictly sequential stop progression with
   segment-crossing interpolation (≤250m anti-teleport guard) and hasDepartedOrigin persisted to survive restarts.
 - Layered idempotency: RTDB transaction rejects stale timestamps at ingest; fingerprint maps + per-key write queues
   ensure only lifecycle changes hit Firestore; completion uses a 3-op batch + 30s delayed cleanup guarded on
   sessionId.
 - Cost control is deliberate: no per-fix Firestore writes — only on lifecycle transitions.
 - Operational maturity: graceful shutdown with 8s drain, all timers unref'd, bounded caches on auth/scrypt path,
   sensible rate limiters.

 Findings

 - H1 — Single backend instance = SPOF. Firestore lease makes workers single-leader (good), but one container by
   design. Fix: 2+ replicas behind LB — lease already makes workers safe; only in-memory rate limiters/caches don't
   scale horizontally.
 - M1 — tripStateEngine.ts is a 551-line god module. The serialized change-only writer pattern is duplicated 3× (fleet,
   activeRide, telemetry). Fix: extract one generic SerializedChangeWriter.
 - M2 — Unbounded in-memory maps (processedTelemetry, persistedFleetState, completedTimeouts, routeStopsCache —
   verified tripStateEngine.ts:6-19). Fix: LRU caps like the credential cache (max 1000).
 - M3 — Fire-and-forget writes swallow errors to console.warn (trackBackgroundTask, scheduleDurableRideRestore). No
   metrics/alerting on persistent failure.
 - L1 — scrypt on request path on cache miss, no concurrency cap (mitigated by 60s cache).
 - L2 — Dead analytics check: analytics.ts reads motionState from bus_locations docs that never persist that field —
   signalLost undercounts.
 - L3 — Timestamp trust: skewed-but-accepted device clock can wedge a node (future timestamp blocks newer fixes until
   stale sweep). Mitigated by +10s clamp.
 - L4 — Health probe: single boolean for both stores — one flapping store flaps all of /health.

 ────────────────────────────────────────────────────────────────────────────────

 2️⃣ FRONTEND — Sound, with one structural contradiction

 What's designed WELL

 - RTDB singleton store (liveBusStore.ts) — one refcounted listener shared by all consumers. Best architecture in the
   codebase.
 - Client never writes to RTDB — telemetry trust boundary holds without exception.
 - Reconnection lifecycle — handles mobile backgrounding, .info/connected, generation counters. Real design.
 - Maps cost strategy — tiles + backend-proxied Places only; no expensive APIs. Deliberate and documented.
 - Auth — single observer, claims-first, race-aware with generation counters.
 - Stale-data handling — degrades to "signal lost" banners rather than lying.

 Findings

 - C1 — "Server-authoritative" has 6 exceptions. Chat (MessagingPanel), feedback (FeedbackModal), boarding
   (PassengerBoardingView), settings, user bootstrap all write directly to Firestore from the client. Anti-abuse logic
   lives in the client it constrains. (Partially mitigated — see Data/Security: chat rate-limit IS enforced in rules.)
   Fix: move message-send and feedback-submit behind Express endpoints.
 - H1 — Role gating is client-side only; cached role in localStorage can briefly lie after demotion. Fix: fail closed
   for privileged roles on claims-fetch failure.
 - H2 — Two useActiveBuses hooks with divergent filter semantics — Dashboard and Fleet panels show different fleet
   states. Fix: one shared hook + one shared ActiveBusEntry type.
 - H3 — 7+ hand-rolled fetch call sites, zero timeouts/retries. Fix: single apiClient.ts with
   AbortSignal.timeout(10_000).
 - H4 — Service worker update can hard-reload a driver mid-shift. Fix: defer activation while a shift is active.
 - M1 — useSmoothPosition re-renders per rAF frame per bus (60/sec/marker) — battery/frame problem at 20+ buses.
 - M2 — useCollection cache key ignores where constraints — future dev gets silently wrong cached data.
 - M3 — Errors swallowed into "empty" — "data failed" vs "no data" render identically.
 - M4 — PassengerBoardingView writes on every selection change, no debounce.
 - L1-L5 — comment mojibake, dead prop, hardcoded fallback coordinate, two theme sources of truth, secrets hygiene
   clean.

 ────────────────────────────────────────────────────────────────────────────────

 3️⃣ HARDWARE — Sound prototype, not yet a fleet architecture

 What's designed WELL

 - Adaptive publish triggers (5m / 15° / 5 km/h, 30s/60s heartbeats) — well-tuned for campus buses.
 - Motion hysteresis (3 consecutive readings, 1.5–2.5 km/h deadband) — prevents flapping.
 - Jittered exponential backoff — fleet-safe, anti-thundering-herd.
 - Stale-buffer drop is contract-aware — firmware drops at 55s because backend rejects at 60s. Excellent
   firmware/backend alignment.
 - Defensive details — setRxBufferSize before begin, static_assert on secret length, WiFi.persistent(false),
   wraparound-safe millis().

 Findings

 - C1 — No store-and-forward. Single-slot buffer, overwritten on failure, dropped at 55s. A 3-min WiFi dead zone =
   permanent 3-min hole in route history. Fix: ring buffer in RTC RAM/SPIFFS (120 samples ≈ 6–10 min), drain
   newest-first within backend's 60s window.
 - C2 — Blocking TLS in GNSS loop silently drops fixes. 8KB buffer covers one 7s stall, but worst-case is connect (7s)
   + TLS handshake + read (7s) ≈ 14–16s ≈ 13–15KB NMEA — 2× the buffer. Overflow = silent byte discard, checksum fail,
   fix dropped with no log. Fix: move HTTPS publish to a separate FreeRTOS task; add overflow counters.
 - H1 — No watchdog/brownout/crash recovery. A TLS hang = permanent outage until physical power-cycle. Fix: register
   loop task with esp_task_wdt (~30s), feed only after successful cycle.
 - H2 — Time sync depends entirely on NTP-over-WiFi; GNSS UTC parsed but never used. Perfect GPS fix + blocked NTP =
   never publishes. Fix: use GNSS UTC as primary (settimeofday from gps.date/gps.time), NTP as cross-check.
 - H3 — No OTA. Field updates need physical USB reflash of every bus; huge_app.csv partition makes OTA impossible
   without repartitioning. Fix: OTA-capable partition + signed OTA before fleet rollout (hard gate).
 - M1 — 401/429/5xx handled identically; 401 retries forever with doomed credential. Fix: branch on status; add
   Retry-After on backend 429.
 - M2 — Device secret compiled into plaintext firmware; no flash encryption/secure boot; no rotation story. Fix: flash
   encryption + Secure Boot V2 as hard pre-fleet gate; move secret to NVS.
 - M3 — WiFi failure loops forever, no escalation/config mode/LED fault code.
 - M4 — All config compile-time; no provisioning or remote diagnostics channel.
 - L1-L3 — Arduino String heap fragmentation, delay(5) (folded into C2), 200 km/h clamp publishes glitches instead of
   rejecting.

 ────────────────────────────────────────────────────────────────────────────────

 4️⃣ DATA & SECURITY — Well-crafted rules with one real gap

 What's designed WELL

 - Default-deny everywhere. devices and active_rides are read/write: if false — device secrets unreachable by clients.
 - Chat rate-limit enforced IN RULES (rollingMessageRateAdvanced, verified firestore.rules:46-97) — 60 msg/hr + 3s gap,
   rolling window + legacy migration. This is the real enforcement; client-side is just UX.
 - passenger_requests well-locked: doc ID = uid, strict shape, lat/lng bounds, drivers only touch their assigned bus.
 - Users can't self-escalate: create only with role == 'passenger', update/delete: if false.
 - No secrets committed — verified; env-injected service account with ADC fallback.
 - CI runs rules tests against emulators.

 Findings

 - H1 — Passenger self-join to ANY active session (the real gap). Verified firestore.rules:190-215: passenger adds
   themselves to any armed/active session's passengers map with only userId == auth.uid — no check they belong on that
   bus. sessionId is in the public activeBuses RTDB node (verified shifts.ts:230), readable by any authenticated user
   (database.rules.json:6). → enumerate sessionIds, self-inject, pass isSessionPassenger, read/post chat. Fix:
   server-issued join token, or gate on driver-approved passenger_requests, or don't expose sessionId publicly.
 - M1 — "Backend is the only writer" is overstated. Clients directly write passenger_requests,
   ride_sessions.passengers[uid], messages, feedbacks, and admins write settings/global from the browser. True
   invariant: "backend is the only writer of live GNSS and lifecycle data." Fix: correct the doc or move writes behind
   Express.
 - M2 — No App Check enforcement in rules. Client initializes it; rules never check request.app; enforcement
   console-side and deferred.
 - M3 — Rules get() amplification = cost/DoS-adjacent. Chat create does up to 2 session get()s + 2 rate-limit
   get()/getAfter(); feedback create does 3 session get()s. Firestore bills these.
 - M4 — Single project / single region. One Firebase project for dev/test/prod, no staging, no deploy job in CI. Fix:
   staging project + deploy workflow.
 - L1 — Dual admin claims (role: 'admin' + admin: true) and dual bus-route fields (assignedRoutes[] + legacy
   assignedRouteId) — migration residue.
 - L2 — Dead config: RTDB messages/users rule blocks + write-only driverRouteAssignments mirror (read by nothing) are
   vestigial.
 - L3 — Unindexable privacy-deletion query on ride_sessions/passengers.{uid}.userId — full collection scan per
   deletion.
 - L4 — completed_trips.completedAt stored as ISO string while others use Timestamp.
 - L5 — Stale "PUBLIC read" comments on routes/bus_locations (rules actually stricter).
 - L6 — No explicit catch-all deny block in Firestore rules. Add match /{document=**} { allow read, write: if false; }.
 - L7 — CSP hash fragility: ~40 build-specific sha256 hashes in firebase.json; forgetting update-csp.mjs breaks deploys
   (mitigated: npm run build runs it).

 ────────────────────────────────────────────────────────────────────────────────

 Summary by severity

 ┌──────────┬───────┬─────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ Severity │ Count │ The ones that matter most                                                                       │
 ├──────────┼───────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Critical │ 3     │ Hardware C1 (no store-and-forward), Hardware C2 (blocking TLS drops fixes), Frontend C1 (client │
 │          │       │ writes)                                                                                         │
 ├──────────┼───────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ High     │ 8     │ Data/Sec H1 (passenger self-join — the only live authz bypass), Backend H1 (SPOF), Hardware     │
 │          │       │ H1/H2/H3, Frontend H1/H2/H3/H4                                                                  │
 ├──────────┼───────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Medium   │ 12    │ God module, unbounded maps, App Check, rules get() amplification, single project, firmware      │
 │          │       │ 401/OTA/secrets                                                                                 │
 ├──────────┼───────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Low      │ ~20   │ Polish, dead code, inconsistencies                                                              │
 └──────────┴───────┴─────────────────────────────────────────────────────────────────────────────────────────────────┘

 The one-sentence answer to "is the design good?": Yes — the core telemetry architecture is excellent and
 production-grade in its discipline; your immediate work is (1) close the passenger self-join gap, (2) make the
 firmware survive connectivity loss and be updatable, and (3) remove the single-backend SPOF before you scale beyond a
 pilot.
