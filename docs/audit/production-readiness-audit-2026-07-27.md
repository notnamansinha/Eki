# Eki production-readiness audit — 2026-07-27

> **Status update (2026-07-28):** This is the pre-remediation report. The broad
> RTDB writes and stale hosted frontend described below have since been fixed
> and deployed. Telemetry was redesigned around MQTT QoS 1. See
> [the remediation report](production-readiness-remediation-2026-07-28.md) and
> [the deployment/owner checklist](../MQTT_DEPLOYMENT_AND_OWNER_CHECKLIST.md)
> for the current launch status and remaining university-owned work.

## Launch decision

**NO-GO for a public beta today.** The local source now passes its build, tests,
lint, dependency audit, and Firebase rules compilation, but the deployed system
does not match it:

- the live RTDB rules still grant driver clients broad writes;
- the hosted frontend is an older build that writes trip/session state directly
  and still contains the `test_bus_1` fallback;
- the workspace's frontend production dependency is configured as
  `NEXT_PUBLIC_BACKEND_URL=http://localhost:4000`, and no reachable production
  backend URL is documented;
- the hardened local rules and application changes have not been deployed.

Deploying only one layer is unsafe. The backend, Firestore rules, RTDB rules,
and frontend must be released as one coordinated version.

## System map

### Trust boundaries

1. **Passenger/admin/driver browser → Firebase Auth**
2. **Browser → Firestore** for route/fleet reads, user profiles, passenger
   manifests, chat, feedback, and settings
3. **Browser → RTDB** for authenticated live-bus reads
4. **Browser → Express backend** for shifts, fleet administration, route
   computation/CRUD, admin live overrides, place search, and device-secret
   administration
5. **ESP32 → Express `/api/devices/auth`** using a per-device secret over TLS
6. **ESP32 → RTDB** using a Firebase token for high-frequency telemetry
7. **Express → Firestore/RTDB/Auth Admin SDK**, bypassing client security rules
8. **Express → Google Routes/Places APIs**, a billable upstream boundary
9. **Firebase Hosting → browser**, with a static Next.js export

### Database write paths

| Data | Writer after this audit | Enforcement |
|---|---|---|
| RTDB `activeBuses` telemetry | ESP32 only | device/route-bound RTDB rule |
| RTDB lifecycle, delay, admin overrides | backend Admin SDK | authenticated backend endpoints |
| Firestore routes | backend Admin SDK | admin endpoint + route schema/geometry validation |
| Firestore buses/drivers | backend Admin SDK | admin endpoint + Auth/RTDB synchronization |
| Ride-session lifecycle and stop history | backend Admin SDK | direct client create/lifecycle writes denied |
| Passenger manifest entry | that passenger | UID-keyed rule |
| Chat message + rate record | session member | atomic rule-enforced transaction |
| Feedback + cooldown | authenticated user | atomic rule-enforced transaction |
| Global settings | admin client | Firestore admin rule |

### Cost-triggering paths

- Google Routes API route save/compute
- Google Places text search
- every RTDB telemetry write and live listener
- Firestore listeners, chat writes, feedback transactions, route reads
- backend Firebase Auth revocation checks
- Firebase Hosting bandwidth and Google Maps JavaScript loads

## Gemini report adjudication

| Gemini item | Verdict |
|---|---|
| `driverRouteAssignments` publicly readable | **False locally and by Firebase semantics.** RTDB is deny-by-default. The local rules now also make the deny explicit. |
| Route writes bypass backend validation | **Confirmed, fixed locally.** Route create/edit/delete now use validated admin API operations; Firestore direct route writes are denied. |
| Driver can overwrite `stopsReached` | **Confirmed, fixed locally.** Session lifecycle and stop history are backend-only. |
| Driver can reopen `tripState` under the local rule | **False for the local rule, true against the stale deployed rule.** Equality with existing data is a no-op, but the live deployed rule lacks that restriction. |
| Orphan active ride session | **Confirmed failure window, mitigated locally.** Sessions start as `pending`, activate after the RTDB claim, roll back on failure, and self-heal on resume. A process kill in the cross-database gap still needs an operational sweeper. |
| PassengerMap unstable subscription dependencies | **Partly confirmed, fixed locally.** The subscription now keys only on route ID/resume generation and reads the latest route/target through refs. |
| Completion timeout update after deletion | **Gemini understated it.** RTDB `update()` can recreate a deleted node and could also retire a newer session. Fixed with a session-checked transaction. |
| ETA path lacks rules | **False.** ETA fields are children of `activeBuses`, not a separate `/eta` tree. They are now explicitly schema-validated and client-immutable. |
| `syncRoleClaims` sequential | **Confirmed scalability issue, not an MVP blocker.** |
| Locale-sensitive cache key | **Confirmed, fixed** with `toLowerCase()`. |
| Non-atomic multi-route delay writes | **Confirmed architecture issue, superseded.** Drivers now call one authorized backend boundary; the UI currently permits one active route. |
| Firmware Firebase-ready state survives Wi-Fi loss | **Confirmed, fixed locally.** Link loss resets auth/readiness and forces metadata replay. |
| Forced token refresh inconsistency | **Not a vulnerability.** Firestore SDK refresh behavior is independent; direct route writes were removed anyway. |
| Empty geolocation error handler | **Confirmed UX gap, low severity.** |
| NTP retry polls too aggressively | **Mischaracterized.** `configTime` starts SNTP; the 10-second loop checks local synchronization state. No certificate bypass was found. |

## Prioritized findings

| ID | Severity | Boundary | Finding and failure scenario | Required action |
|---|---|---|---|---|
| PR-01 | **CRITICAL** | deployed browser/RTDB | **Production drift leaves known authorization flaws live.** The retrieved rules allow driver writes without the local field ownership restrictions or route-assignment mirror. The hosted driver bundle directly writes stop/trip/session data and contains `test_bus_1`. | Do a coordinated backend → rules → frontend deployment; retrieve and compare the rules again afterward. |
| PR-02 | **CRITICAL** | browser/backend | **No usable production backend is configured.** A static deployment with `localhost:4000` makes shift start/stop, route save, fleet administration, place search, delay changes, and live overrides fail for real users. | Deploy the backend behind HTTPS, set exact CORS origins and `NEXT_PUBLIC_BACKEND_URL`, rebuild, then smoke-test every privileged workflow. |
| PR-03 | **HIGH** | ESP32/RTDB | **Direct telemetry has no enforceable per-device write rate.** A malfunctioning or physically compromised device can write at network speed and drive RTDB cost plus backend listener work. RTDB rules validate authorization/schema, not rate. | For public beta, put telemetry behind a rate-limited ingestion service or enforce Firebase/GCP budget alerts and per-device anomaly shutdown. App Check cannot simply be enforced on RTDB while the ESP32 lacks an App Check attestation flow. |
| PR-04 | **HIGH** | backend/edge | **No verified WAF/CDN/distributed limiter protects the API.** `express-rate-limit` uses per-process memory; botnets and horizontal instances bypass aggregate budgets. | Put Cloud Armor/Cloudflare/university reverse proxy in front; use a shared rate store; cap backend instances and concurrency. |
| PR-05 | **HIGH** | backend workers | **Every backend instance starts the trip-state listener and timers.** Horizontal scaling duplicates ETA timers, completion work, Firestore writes, and stale sweeps. | Run exactly one worker instance for beta or implement a distributed lease/leader worker before scaling. |
| PR-06 | **HIGH** | Firebase clients | **App Check is absent.** Valid Google-authenticated clients can call Firebase directly from custom scripts. This does not bypass authorization but weakens abuse/billing controls. | Enable App Check for web Firestore/Auth-supported surfaces after staging validation; redesign ESP32 ingestion before enforcing it on RTDB. |
| PR-07 | **HIGH** | device identity | **Extracted device secrets and captured valid tokens permit telemetry spoofing/replay for that bus/route.** There is individual revocation, but no request sequence/signature accepted only once. | Store credentials in ESP32 secure storage where possible; add device disable/rotation runbook; move ingestion server-side with monotonic sequence/idempotency enforcement. |
| PR-08 | **HIGH** | operations/privacy | **No retention, backup/restore test, incident runbook, or alert configuration is present in the repository.** Location trails, passenger manifests, chat, and feedback have no deletion schedule. | Define retention/TTL, scheduled backups, quarterly restore test, billing/error/auth-failure alerts, and token-leak/data-corruption playbooks before collecting beta data. |
| PR-09 | **MEDIUM** | fleet admin | Fleet changes span Firestore, Firebase Auth claims, token revocation, and RTDB without a cross-system transaction. A partial provider failure can leave inconsistent assignments. | Add an operation record/state machine and reconciliation job; alert on failed synchronization. |
| PR-10 | **MEDIUM** | shift start | A shift may start without a current GNSS coordinate; the origin-distance guard only runs when coordinates exist. A bus can therefore appear active without a trustworthy starting fix. | Require a fresh coordinate near the origin, or add an explicit admin override with an audit record. |
| PR-11 | **MEDIUM** | passenger/RTDB | Passenger home and map views can hold overlapping RTDB listeners; the home listener reads the entire fleet. Cost and render work rise linearly with fleet size. | Share one normalized live-bus store, query by active route where possible, and add a fleet-size/load test. |
| PR-12 | **MEDIUM** | APIs/queries | `/api/buses`, `/api/routes-list`, analytics, route preload, settings/routes hooks, and feedback admin reads include unbounded collection reads. | Add limits/pagination and cache versioned route/fleet snapshots. |
| PR-13 | **MEDIUM** | API CPU | `/api/plan` fetches and decodes route geometry per authenticated request under only process-local global limiting. | Cache validated decoded routes and add a dedicated user/IP limiter. |
| PR-14 | **MEDIUM** | browser CSP | The hosting CSP needs `'unsafe-inline'` for the current static Next.js build. This reduces protection if an HTML/script injection is introduced later. | Prefer hash-based CSP during a later hosting pass; keep React escaping and prohibit raw HTML. |
| PR-15 | **MEDIUM** | environments | No distinct staging Firebase project/backend is configured. Rules and workflows therefore cannot be safely exercised against production-like data before release. | Create staging projects, service accounts, budgets, and a promotion checklist. |
| PR-16 | **MEDIUM** | privacy/legal | Driver location, passenger trip association, chat, and feedback are personal data, but there is no privacy notice, purpose/retention record, access audit, or deletion workflow. | University IT/legal should review the DPDP Act/Rules rollout, document lawful purpose and retention, and approve the beta notice. |
| PR-17 | **LOW** | scripts | `syncRoleClaims` processes all users sequentially and performs multiple remote calls per user. | Add bounded concurrency, pagination, checkpointing, and retry/backoff before thousands of users. |
| PR-18 | **LOW** | UX | Passenger geolocation denial is silently ignored, so walking ETA disappears without explanation. | Surface a non-blocking permission/status message. |
| PR-19 | **LOW** | firmware | OTA is disabled and therefore not an active remote-update vulnerability, but there is no signed OTA design for fleet maintenance. | Require signed firmware, authenticated update metadata, rollback, and per-device rollout before enabling OTA. |

## Local fixes completed in this audit

- Device-only, route-bound, schema-closed RTDB telemetry writes with explicit
  root and server-only path denies.
- Backend-mediated driver delays and admin live overrides; no browser RTDB
  mutation remains.
- Backend-validated route create/edit/delete; client route/fleet direct writes
  denied.
- Backend-only ride-session lifecycle and stop history.
- Atomic Firestore chat rate enforcement: 3-second cooldown, 60/hour, and
  200-message listener cap.
- Old driver principal is demoted/revoked when a driver record changes Auth UID.
- Session startup uses pending/activate/rollback semantics and resume repair.
- Completion cleanup compares session identity and cannot recreate a deleted
  node or retire a replacement session.
- Health probes are cached; HTTP request/header/keep-alive limits are explicit.
- Firmware resets Firebase authentication state after Wi-Fi loss.
- Locale-stable place cache key.

## Verification evidence

### Passed

- `npm run lint`
- `npm test`: backend 35 tests, frontend 15 tests
- `npm run build`: backend TypeScript + 12-page static Next.js export
- Firebase dry-run: RTDB syntax valid; Firestore rules compiled successfully
- `npm audit --omit=dev --omit=optional`: 0 vulnerabilities
- Full `npm audit`: no high/critical findings; moderate findings are in the
  optional Firebase Storage chain, which this application does not use; one
  low development-only `esbuild` issue
- Current and historical tracked-secret pattern scan: no real credential
  matched; real `.env`, firmware secrets, keys, and service-account files are
  ignored
- Live Firebase Hosting headers: CSP, HSTS, frame deny, MIME sniffing deny,
  referrer policy, permissions policy, and no-store app pages are present
- Firmware review: HTTPS required by default, CA certificate installed with
  `setCACert`, no `setInsecure`, NTP required before credential exchange
- Local cached-health load test: 57k requests in 5.02 seconds; 195 successful
  responses and 56,725 controlled 429 responses; average latency 10.47 ms; no
  database-read amplification per request
- No `dangerouslySetInnerHTML`, `eval`, user-controlled shell execution, SSR
  route, or user-controlled backend URL fetch was found

### Could not verify

- Live Firestore rules retrieval; the CLI exposes RTDB rules but not an
  equivalent read command used in this audit
- Semantic Firebase emulator tests; Java is not installed in this environment
- Production backend scan/ZAP test; no production backend URL is configured
- Safe ingestion load/replay test; telemetry writes directly to production
  RTDB, so flooding it during an audit would be harmful
- Firmware compilation/hardware-in-loop; `hardware/include/secrets.h` is
  intentionally absent
- Firebase App Check enforcement, Auth domain policy, Google API key
  restrictions, billing budgets, quotas, alert policies, backups, and restore
  capability; these are console/operations settings
- TLS certificate renewal, reverse-proxy/WAF behavior, process isolation, SSH
  hardening, and failover on the future university server
- A real multi-device reconnect/chaos test

## Release gate

Before beta access:

1. Deploy a real HTTPS backend and set its exact frontend URL/CORS origin.
2. Deploy backend code first, then Firestore/RTDB rules, then the rebuilt
   frontend in a short coordinated window.
3. Verify the deployed RTDB rule no longer contains a driver/admin write grant.
4. Sign in as one passenger, one driver, and one admin and test every workflow.
5. Test a denied cross-role write, message flood, invalid route, stale/replayed
   telemetry, shift conflict, backend restart, and device reconnect.
6. Configure budgets/alerts/backups and record the restore procedure.
7. Keep the trip-state worker at one instance until distributed leadership is
   implemented.
8. Obtain university approval for the privacy notice and beta retention policy.

Official legal references for university review:

- India Code: https://www.indiacode.nic.in/handle/123456789/22037
- MeitY DPDP Rules 2025 and enforcement notifications:
  https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa
