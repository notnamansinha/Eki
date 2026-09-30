# Eki audit fixes and physical-test readiness

Updated: 2026-09-14. Implementation commit `c9e5940` is pushed to `testing`; subsequent branch `codex/rtdb-region-decision` adds RTDB region evaluation, same-origin Firebase Auth helper domain resolution, and CSP frame-src contract verification.

## Corrected

- **Firebase Auth / Storage Partitioning:** `resolveFirebaseAuthDomain` enforces same-origin auth helper domain on `web.app` and custom domains to prevent popup/redirect failures in Safari and Firefox. `frame-src 'self'` is enforced in `firebase.json` for `/__/auth/iframe` and verified by `verify-web-backend-contract.mjs`.
- **RTDB Region Selection:** Benchmark approved Singapore (`asia-southeast1`) candidate (67.8% lower front-door latency vs Iowa); staged cutover gate and preflight instance check (`npm run verify:rtdb-instance`) established.
- **Routes:** fresh endpoint inference preserves A→B→A and B→A→B travel; long ordered routes and shared per-bus reroutes retain their existing race/version guards. Route Type was removed from the editor, payload hash, API validation, persistence, model, tests, and data documentation. Legacy documents with the extra field still load.
- **Stop editor:** A…Z, AA… labels now come from one shared helper in Admin and Passenger. Move and Remove controls are always visible, keyboard named, and 44×44 px; reordering keeps stable stop objects and invalidates stale geometry.
- **Ride lifecycle/history:** **End ride early** is a guarded, idempotent server operation. It writes `status=interrupted`, `endTime`, and `manual_end_early`, removes only the matching active ride and bus lock, and retires only the matching RTDB session. Natural completion remains terminal and eligible for automatic return service; interrupted rides do not auto-turn around.
- **Live Ops:** “Arm a ride” is now **Start service** with clearer lifecycle text. A confirmation dialog exposes early termination. The map/sidebar/list use one bounded scroll hierarchy so the fleet list remains reachable.
- **Passenger availability:** a fresh online device with no session appears as **Vehicle available — service not started**. It receives no fabricated service status, direction, ETA, session, chat, or tracking marker. Stopped session-backed services remain eligible for normal tracking and chat.
- **Feedback/Settings:** Feedback uses a compact row/detail structure, shared authenticated API client, two compact filters, and Reset. Settings has one Save action with dirty, saving, and saved announcements.
- **Deployment:** production build now verifies that the exact backend origin exists in CSP `connect-src`. A UI source-contract gate prevents route-type and passenger stop-label regressions. An authenticated Playwright staging suite covers route controls and responsive overflow.
- **Telemetry recovery:** moving and stopped sampling remain 1 Hz. A first transport timeout now retries the retained latest fix after 250–749 ms; repeated failures remain at 1–2 s and explicit server delays still win. TLS reuse, certificate/hostname validation, rate limits, and the 1.5 s HTTP read budget remain intact.

## Verification

- **UNIT/INTEGRATION VERIFIED:** 33 script tests, 446 backend tests passed with 7 skipped, and 215 frontend tests passed (including same-origin Firebase Auth domain resolution). This includes manual termination races/idempotence, the manual-end/completion race, fresh direction inference, 0 km/h chat, passenger availability policy, route save behavior, A/Z/AA labels, CSP contract, and retry timing.
- **UNIT/INTEGRATION VERIFIED:** 35/35 native firmware tests passed. Development ESP32 build passed at 15.3% RAM and 30.5% flash.
- **LIVE RUNTIME VERIFIED:** the new firmware was flashed to the attached ESP32 on COM3 with image hash verification.
- **LIVE RUNTIME VERIFIED:** post-fix three-minute stationary capture: 175 requests, 175 accepted, 0 HTTP failures, 0 retries, 1 TLS connection, 0 reconnects. HTTP p50/p95/p99/max was **567/1,144/1,320/2,032 ms**. Backend-ingress update-gap p50/p95/p99/max was **1,004/1,159/2,003/2,382 ms**; no gap exceeded 5 s. See [POSTFIX_STATIONARY_TRACE.md](POSTFIX_STATIONARY_TRACE.md).
- **STAGING/LIVE RUNTIME VERIFIED:** local frontend, ngrok health, exact-origin CORS preflight, and unauthenticated Places boundary all passed. An authenticated real Places result had already been selected into the route editor through the same tunnel.
- **BROWSER E2E VERIFIED:** authenticated Admin route editor at 360×800 rendered Move/Remove at 44×44 px with opacity 1 and no Route Type. Live Ops, Routes, Feedback, and Settings had no horizontal overflow across 320×700 through 1440×900. Settings exposed one Save action.
- **BROWSER E2E VERIFIED:** Passenger at 360×800 showed the connected stopped bus as **Vehicle available — service not started**, with no horizontal overflow and no false direction/ETA/session.
- **STATICALLY VERIFIED:** production frontend/backend builds, TypeScript, ESLint, CSP/backend contract, and UI contract pass locally.
- **GITHUB VERIFIED:** Production verification passed on exact implementation commit `c9e5940`, including the backend container smoke test, web tests, Firebase rules, strict production build, dependency audit, native/ESP32 firmware builds, and signed fleet build ([run 34772776154](https://github.com/notnamansinha/Eki/actions/runs/34772776154)).
- **RECOVERY VERIFIED:** deliberate backend and ngrok outages caused retryable gaps only while those services were unavailable. The ESP32 retained the latest fix, reconnected without rebooting, and returned to 1 Hz delivery. The tunnel test accepted its first fix 3.336 s after restart. A cold reboot accepted its first fix after 3.696 s; a real read timeout used a 691 ms retry and kept the maximum ingress gap to 4.521 s. See [NON_MOVING_RECOVERY_REPORT.md](NON_MOVING_RECOVERY_REPORT.md).

## Pending physical/deployment proof

- [ ] Run the deferred 30–60 minute moving trace and physically complete A→B→A and B→A→B, including a long route with many stops.
- [ ] Trigger a real off-route change while passengers and Admin are watching, and correlate RTDB callback through marker render on both maps.
- [ ] Exercise End ride early against a disposable real ride, then reload History and confirm the row and details persist.
- [ ] Run a long stationary soak plus deliberate Wi-Fi loss, packet loss/slow radio, and TLS idle expiry on this exact build. Backend and ngrok restart recovery are verified.
- [ ] Validate the signed secure fleet image and OTA path on production-class hardware before deployment.

The three-minute trace establishes that the earlier 4.821 s stationary listener gap did not recur in this window. It does not prove zero latency under every network or tunnel failure: cold TLS retains a separate 10 s safety budget, and the internet, DNS, ngrok, Firebase, and radio can still delay delivery.
