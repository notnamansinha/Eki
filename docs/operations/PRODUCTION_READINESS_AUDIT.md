# Production readiness audit

Audit completed: 2026-08-08. Scope: every tracked project source/configuration/documentation file across firmware, backend, Firebase, frontend, build/deploy and CI. Generated dependencies/build output were validated through their manifests/builds rather than treated as maintained source. The pre-existing untracked `eki_production_codex_prompt.md` was not modified.

## Outcome

The modular-monolith/RTDB/Firestore design is appropriate for the current university fleet. Live telemetry is already push-based: ESP32 pushes HTTPS; Firebase pushes `onValue`/`onSnapshot` changes. REST commands already use native `fetch`. Switching “polling to fetch” would be conceptually wrong; the only misleading `fetchETAs` function was local math, was renamed, and its redundant timer was removed.

No known production npm vulnerability remains in required dependencies. All current linters/tests/builds pass, including real firmware compilation. The repository cannot, by itself, certify radio/GNSS/power behavior or configure university infrastructure; those remain explicit acceptance work.

## Issues corrected in this audit

| Area | Problem | Resolution |
|---|---|---|
| Service worker/security | Network-first cache could store authenticated Firebase/backend responses by URL and replay them across accounts | Firebase/Auth and unknown/API requests are `NetworkOnly`; only explicit public/static resources cache |
| Retention safety | Unset env enabled destructive cleanup | Exact opt-in `RETENTION_SWEEPER_ENABLED=true`, with tests |
| Route planner | Reverse/via slicing could create empty/wrong segments and unordered stops | Pure direction-safe segment builder, via constraint and four behavior tests |
| Settings reliability | Listener could attach before Auth, receive permission denied and never recover | Wait for first auth state, coalesce start, guard stale generations and retry transient errors |
| Ride concurrency | Same bus could start two different route nodes | Transactional deterministic `_active_bus_locks/{busId}`; conditional release/reconciliation |
| Completion race | Delayed old completion could update/delete newer state | Firestore and RTDB completion operations compare session ID transactionally |
| Device provisioning | CLI did not enforce API-equivalent uniqueness/active conflict | Transactional bus/route/device/ride/lock checks; one-time scrypt secret |
| Seed integrity | Maps failure could persist empty route geometry; service-account JSON was unnecessarily mandatory | Fail seed without geometry; support ADC or JSON through shared Admin setup |
| Telemetry observability | Only counts/timestamps; no transmission/write latency evidence | Rolling average/p50/p95/p99 processing, device-to-server and RTDB write metrics plus cache rate |
| Hardware reliability | Unpinned platform/libs, no watchdog, local-only `.clangd`, SSID log | Pinned dependencies, 15 s task watchdog, portable config, no SSID, HTTPS fail-closed |
| Hardware latency | Default Wi-Fi power behavior added burst latency | Vehicle-powered modem sleep disabled, fast strongest-AP selection; retry/timeout/buffer retained |
| UI performance | Every visited admin tab stayed mounted with listeners/maps/timers | Mount only active tab; chunks remain browser-cached |
| ETA correctness/performance | Timer recomputed arrival timestamps from unchanged positions and hid countdown | Recompute only on pushed route/bus change; local 15-second countdown remains |
| Accessibility | Custom listbox keyboard gaps; dialogs lacked complete focus behavior; clickable divs | Native select, reusable top-dialog focus trap/restore/Escape/scroll lock, semantic tabs/collapsibles/cards |
| Motion accessibility | JS map interpolation ignored reduced-motion preference | Immediate target update under `prefers-reduced-motion` |
| Coordinate correctness | Truthiness rejected valid zero coordinates | Shared numeric coordinate validation |
| Metadata | Nonexistent/private routes were indexed; protected pages inherited public metadata | Deterministic root-only sitemap, private robots exclusions and per-workspace no-index titles |
| Production configuration | Production build could silently embed an empty/local backend | Strict required-variable and non-local HTTPS validation |
| Documentation | Auth scheme, NTP, env vars, tenancy, paths and data model were incomplete/outdated | Rewritten README/API/hardware/frontend docs plus HLD, LLD, data dictionary, telemetry and test strategy |

## Verification record

- `npm run lint`: passed frontend and backend.
- Backend Vitest: 91 passed, four Firebase emulator cases skipped locally because Java/the Firebase emulators were unavailable.
- Frontend Vitest: 43 passed.
- Native firmware policy: four passed.
- Backend TypeScript build: passed.
- Next.js 16.2.12 static production build: passed during final verification. The stricter deployment build correctly failed closed because the local environment does not define `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY`; provision every value in `frontend/env.production.example` before release.
- Workbox/CSP generation: passed; authenticated/default network cache removed.
- `npm audit --omit=dev --omit=optional`: zero vulnerabilities.
- PlatformIO 6.1.19, Espressif32 7.0.1 firmware build: passed; 47,292/327,680 bytes RAM (14.4%), 934,665/3,145,728 bytes flash (29.7%).
- Secret-pattern review: no committed device/service secrets; templates/placeholders only.
- Dead-code/dependency scan: no actionable orphan application module; build-entry/optional-runtime tooling explains reported false positives. Admin dormant mounting and custom select code were removed.

The four skipped rule integration cases require Java/Firebase emulators and are run in configured CI/should be run before release. No physical bus test was claimed.

## Architecture conclusions

- Keep the brokerless HTTPS ingestion boundary. A broker/microservice/Redis split adds operational failure modes without current scale evidence.
- Keep RTDB as latest-state push and Firestore as durable state. Do not duplicate every coordinate into Firestore.
- Keep server-only ordered lifecycle truth. Do not make browser, driver or dead-reckoned positions authoritative.
- Keep one lease-owned worker across API replicas; alert on lease/readiness and use edge/global limits in multi-instance deployment.
- Use stored polyline/local ETA for predictable cost; clearly treat ETA as heuristic.

## Residual/open production work

These require external authority or physical evidence and were not fabricated as software fixes:

1. Run Firestore/RTDB emulator integration in a Java-enabled environment and archive output.
2. Conduct the complete physical test matrix in [Test strategy](../testing/TEST_STRATEGY.md) and [Live demo runbook](LIVE_DEMO_RUNBOOK.md), including power, GNSS, coverage, CA and concurrent-session faults.
3. Deploy managed backend TLS/DNS near Firebase, WAF/global rate limits, structured logs/alerts, uptime checks and dashboards for `/health` percentiles/rejections/worker lease.
4. Restrict Firebase/Maps keys, enforce App Check after staged validation, use Workload Identity/Secret Manager and rehearse secret/CA rotation.
5. Approve retention/privacy policy, configure backups/export and prove restore.
6. Design signed OTA/rollback and key custody; test Secure Boot V2/flash encryption on spare boards before irreversible eFuse provisioning.
7. Validate automotive enclosure, power/EMI/antenna installation and assign maintenance/incident owners.
8. Establish quantified p95/p99 acceptance targets from the real route rather than a laptop/emulator.

Until these are completed, call the repository software-verified and deployment-ready for controlled acceptance—not physically or institutionally certified production.
