# Environment and configuration reference

Last updated: 2026-10-27 12:00 IST (UTC+05:30).

This page documents configuration names and safe handling rules. Values below
are placeholders. Use separate files and projects for local, staging and
production environments.

## Synthetic QA process controls

`EKI_QA_SEED` is an optional uint32 seed (default 42) for `npm run qa:gnss`.
`EKI_QA_REPLAY_PATH` is an optional generation index to replay a reported
property failure; remove it to run the full campaign. Use process variables as
shown in [the GNSS guide](qa/GNSS_PROPERTIES.md), with [the QA-only template](../qa/qa.env.example).
Neither is a production backend setting or authorization for provider/network
replay. QA reports preserve the exact source SHA, observed assertions and
partial case evidence without claiming live-motion or RF acceptance.

## Stop-arrival policy

The backend stop-arrival radius and initial endpoint direction radius are both
**10 m** (source constants, not environment overrides). Intermediate stops advance
in configured order when accepted raw GNSS reaches/crosses that circle. The
passenger timeline and map use the published stop index. Snapped map markers and
passenger phone location do not decide bus arrival. Final-stop completion also
requires fresh reliable stopped telemetry and distinct samples spanning the
default 2-second confirmation. The separate 75 m return-readiness area applies
only after confirmed completion and the turnaround wait; it cannot complete a trip.
10 m needs validation with the actual NEO-M8N and surveyed stop pins.

## Backend variables

Store these in the ignored `backend/.env` file or inject them through the
runtime secret/configuration system.

| Variable | Required | Meaning | Safe guidance |
|---|---|---|---|
| `PORT` | No | HTTP listener port; defaults to `4000` in local use | Expose through the managed HTTPS runtime in production |
| `NODE_ENV` | Recommended | Set `production` to enable production guards | Production refuses to start without `CORS_ORIGIN` |
| `CORS_ORIGIN` | Production | Comma-separated exact frontend origins | Never use `*` for this credential-free API; do not include paths |
| `TRUST_PROXY` | No | Which reverse proxy may supply `X-Forwarded-For` for pre-auth IP rate-limit buckets: unset = one hop in production and none elsewhere; `false`; `loopback`; or a hop count `0`–`10` | Use `loopback` when a local ngrok agent fronts a development backend, otherwise every tunnelled client shares one bucket. `true`/`all` and any other value refuse startup, so callers cannot choose their own bucket |
| `FIREBASE_SERVICE_ACCOUNT` | Conditional | Server-side Firebase Admin JSON | Prefer Workload Identity/ADC or Secret Manager; never commit or log it |
| `FIREBASE_DATABASE_URL` | Yes for RTDB | Firebase RTDB URL | Use the environment’s URL; no code fallback exists |
| `GOOGLE_MAPS_API_KEY` | Route/places features | Server-side Routes/Places key | Restrict by runtime identity/IP and enabled APIs; keep it different from the browser key |
| `BUS_STALE_MS` | No | Live bus staleness threshold; minimum `90000`, default `300000` | Align the alert/runbook threshold with the deployed value |
| `AUTOMATIC_TURNAROUND_DWELL_MS` | No | Delay after confirmed completion before arming the return; default `30000` ms, minimum `0` | A fresh stopped terminal fix is still required. This wait is separate from terminal-arrival confirmation (`TERMINAL_ARRIVAL_CONFIRMATION_MS`) |
| `TERMINAL_ARRIVAL_CONFIRMATION_MS` | No | How long reliable stopped final-stop fixes must span before a ride completes; default `2000` ms | Values below `1000` or non-numeric fall back to `2000` (they are not clamped); fractions are floored; there is no upper bound, so a large value delays every completion |
| `LIVE_DEPARTURE_ROUTES_ENABLED` | No | Enables the billable departure-time Google Routes traffic calculation (one at arming, reused at departure for five minutes); default enabled | Boolean flag (see below); `false`/`0`/`no`/`off` disables it |
| `HTTPS_DEVICE_RATE_PER_MINUTE` | No | Shared accepted device requests per device per minute; default `90` | Supports 1 Hz moving telemetry with retry headroom across replicas; add an edge/WAF limit |
| `HTTPS_DEVICE_RATE_LIMIT_MODE` | No | Authenticated device limiter mode; defaults to `distributed` | Use `local` only for an explicitly single-instance deployment with `RATE_LIMIT_SHARD_FACTOR=1` |
| `HTTPS_DEVICE_RATE_LIMIT_LEASE_SIZE` | No | Tokens reserved per shared RTDB transaction in distributed mode; default `5`, capped at the minute limit | Larger values reduce transactions but can temporarily strand unused capacity after replica loss |
| `FIRMWARE_RELEASE_VERSION` | OTA set | Signed image version in `s<sequence>-<name>` form | Must exactly match the image descriptor; configure all six fields together or leave all unset |
| `FIRMWARE_RELEASE_SEQUENCE` | OTA set | Strictly increasing positive release number | Must exceed the sequence compiled into the installed image |
| `FIRMWARE_RELEASE_URL` | OTA set | Exact HTTPS URL of the signed application binary | Publish immutable content; never put credentials in the URL |
| `FIRMWARE_RELEASE_ALLOWED_ORIGIN` | OTA set | Exact HTTPS origin permitted to host the release binary | Must match `FIRMWARE_RELEASE_URL`; no path, query, credentials or fragment |
| `FIRMWARE_RELEASE_SHA256` | OTA set | SHA-256 digest of the exact signed binary | Record and verify this from the controlled signing environment |
| `FIRMWARE_RELEASE_SIZE` | OTA set | Exact binary size in bytes (maximum 1,966,080) | Must match both the hosted object and signed release evidence |
| `RATE_LIMIT_SHARD_FACTOR` | No | Expected backend replica count used to divide in-process budgets; default `1` only when unset | Set to the deployed replica count; malformed and over-budget values reject startup |
| `AUTH_REVOCATION_CACHE_MS` | No | Short cache for ordinary passenger Firebase Auth revocation checks; `0` disables it, maximum `60000` | Privileged admin/driver claims receive a fresh check for each HTTP request; admission and route middleware reuse that request's verified token |
| `AUTH_MAX_PENDING_VERIFICATIONS` | No | Maximum distinct Firebase Auth verifications in flight per backend process; default `256`, maximum `2000` | Size for expected concurrency; overflow fails with retryable HTTP 503 instead of growing memory without bound |
| `WORKER_ENABLED` | No | Enables the Firestore-lease background worker; default `true` | Boolean flag (see below). Keep enabled for lifecycle recovery, abandonment and retention jobs; `false`/`0`/`no`/`off` on a replica stops it competing for the lease |
| `WORKER_INSTANCE_ID` | No | Stable diagnostic identity for a runtime instance | Do not use credentials or personal data |
| `ABANDONED_RIDE_THRESHOLD_HOURS` | No | Inactivity before conservative abandoned-ride reconciliation; minimum `1`, default `12`. Undeparted automatic returns receive at least `24` hours for overnight recovery | The hourly sweep protects recent/unknown activity and releases expired sessions' matching locks |
| `RETENTION_SWEEPER_ENABLED` | Required in production | Explicit `true` after trimming/case normalization; development/test remain disabled when omitted | Production refuses to start until the retention schedule is explicitly enforced |
| `LEGACY_RTDB_RETIRED` | No | Enables retired RTDB `users`/`messages` cleanup only after migration verification; default `false` | Review [retention](operations/RTDB_RETENTION.md) and inventory with dry run first |
| `HTTPS_INGRESS_DEVICES_PER_IP` | No | Largest expected fleet behind one public IP; default `100`, maximum `100000` | Telemetry IP pool allows 15 requests/device/10 s; diagnostics and firmware have separate 2/device/10 s pools; all are replica-sharded |
| `RIDE_SESSION_RETENTION_DAYS` | No | Terminal ride-session retention period; default `180` | Set `180` for the approved ride-history schedule; measured from `endTime` |
| `FEEDBACK_RETENTION_DAYS` | No | Feedback retention period | Must match privacy approval |
| `COMPLETED_TRIP_RETENTION_DAYS` | No | Completed-trip projection retention period; default `180` | Set `180` for the approved ride-history schedule; measured from `completedAt` |
| `OPERATION_LOG_RETENTION_DAYS` | No | Operational record retention; default `90` days | Avoid putting secrets or personal data in logs |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Optional | An endpoint enables backend instrumentation | Keep exporter authorization in runtime secrets; local stack uses port `4318` |
| `OTEL_EXPORTER_OTLP_HEADERS` | Optional | Exporter authorization header | Secret; never commit or print it |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Optional | Template uses `http/protobuf` | Match the receiving Collector |
| `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES` | Optional | Service identity and bounded environment/version attributes | Do not include user/device secrets or personal identifiers |
| `OTEL_SDK_DISABLED` | Optional | `true` disables instrumentation | Use as an exporter kill switch |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | Optional | Trace head sampling; when the sampler is unset the backend uses `parentbased_traceidratio` with `0.1` (10% of new root traces, parent decisions respected) | An explicit standard sampler is respected; use `parentbased_always_on` only for short diagnostic sessions. Head sampling cannot guarantee retaining every error trace |
| `LOG_LEVEL` | Optional | Structured application logging level; template `info` | `debug`, `info`, `warn` or `error` |

The exact defaults and comments are maintained in [`backend/.env.example`](../backend/.env.example).
Configuration is loaded before Firebase initialization; changing it requires a
backend restart. `backend/src/envDocumentation.test.ts` fails when a template
variable is missing from the table above.

Boolean flags `WORKER_ENABLED` and `LIVE_DEPARTURE_ROUTES_ENABLED` are trimmed
and case-insensitive: `true`/`1`/`yes`/`on` enable, `false`/`0`/`no`/`off`
disable, and unset or blank uses the default. Any other value refuses startup
with an error naming the variable, so a typo cannot silently leave a feature
on. `RETENTION_SWEEPER_ENABLED` keeps its stricter rule (only `true` enables
destructive cleanup) and `LEGACY_RTDB_RETIRED` still requires the exact value
`true`.

The `*_RETENTION_DAYS` values must be whole numbers of at least `1`; missing,
blank, fractional or nonpositive values use the default (`180`, or `90` for
operation logs). Values above `36500` are capped at `36500` days so a
"keep forever" setting cannot abort the daily retention sweep.

## Frontend variables

Store these in the ignored `frontend/.env.local` file for local use or inject
them into the frontend build environment. `NEXT_PUBLIC_*` values are bundled
into the browser and should be treated as public identifiers.

| Variable | Required | Meaning | Safe guidance |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Custom frontend origin | Build-time origin for canonical/social metadata, robots and sitemap | HTTPS origin only; no credentials/path/query/fragment. Omission retains `https://bustrack-be165.web.app`; set for other Hosting sites/custom domains |
| `NEXT_PUBLIC_SITE_INDEXING` | Preview/staging | Set `false` to disable indexing and sitemap discovery | Rebuild to change; use `false` for preview/staging and `true` only for the intended public site |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes | Browser Firebase API identifier | Restrict by host and Firebase APIs; it is not a service-account secret |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | Firebase Auth domain | Use the matching environment. The project's primary Firebase Hosting site resolves to its live hostname at runtime. Set this explicitly to the frontend hostname for secondary sites and custom domains, and add `https://<frontend-hostname>/__/auth/handler` to the Google OAuth client's authorized redirect URIs. |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | Yes | Browser RTDB URL | Use the matching environment |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes | Firebase project identifier | Do not mix staging and production projects |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | Firebase Storage bucket identifier | Use the matching environment |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes | Firebase messaging identifier | Use the matching environment |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Yes | Firebase web app identifier | Use the matching environment |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | Optional | Analytics measurement identifier | Enable only if analytics/privacy approval exists |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Maps UI | Browser Maps JavaScript key | Restrict by approved hostnames and Maps APIs |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | Maps UI | Cloud map style identifier | Use the matching environment |
| `NEXT_PUBLIC_BACKEND_URL` | Yes | HTTPS backend origin used by REST mutations | Use an origin only—no `/api` suffix, path or query string |
| `NEXT_PUBLIC_SERVICE_TIME_ZONE` | Optional | Display timezone; default template is `Asia/Kolkata` | Use an IANA timezone name |
| `NEXT_PUBLIC_PASSENGER_BUS_START_TIME` | Optional | Passenger display default for service start | This is presentation configuration, not a dispatch rule |
| `NEXT_PUBLIC_BUS_EXPIRY_MS` | Optional | Client-side stale-display threshold | Keep consistent with the operational stale-state policy |

The complete tracked template is [`frontend/env.production.example`](../frontend/env.production.example).
The strict production build fails when mandatory values are missing or when the
backend URL is local/non-HTTPS. The root build's `scripts/update-csp.mjs` and
`scripts/verify-web-backend-contract.mjs` load `frontend/.env*` with
`@next/env` exactly as `next build` does (production mode, shell values win),
so the Hosting CSP `connect-src` always names the backend origin compiled into
the bundle. The contract check is skipped only when neither the shell nor any
`frontend/.env*` file sets `NEXT_PUBLIC_BACKEND_URL`.

Before an RTDB migration or release, expose the backend and frontend database
URLs only as environment variables and run `npm run verify:rtdb-instance`.
The Deploy workflow requires an environment-scoped `FIREBASE_DATABASE_URL`
secret containing the backend's actual deployed RTDB origin. It compares that
secret with `NEXT_PUBLIC_FIREBASE_DATABASE_URL` before either release target.
Optionally set `RTDB_EXPECTED_REGION` to the approved region. The preflight
prints only the verified region and fails if the two instance hosts differ;
it never prints configuration URLs or credentials. See the
[RTDB region decision](design/RTDB_REGION_LATENCY_DECISION.md).

<a id="local-app-check-and-auth-setup"></a>

## Local Auth setup

App Check has been removed. The browser does not initialize an attestation
provider or send an App Check header; the API requires Firebase ID tokens
and trusted role claims. No reCAPTCHA site key or App Check debug token is needed.

Before deploying the new browser, disable App Check enforcement for Firestore
and Realtime Database in the selected Firebase project. Staging and production
deployment workflows run `scripts/disable-appcheck-enforcement.mjs --project
<project-id> --disable` before publishing the app. For a manual rollout, use the
same command with an authorized `FIREBASE_TOKEN`, or disable enforcement in
Firebase Console. Code changes alone do not change an already deployed project.

Authentication refreshes ID tokens and verifies trusted role claims before
publishing the user or opening protected listeners. Administrators require both
`role: "admin"` and `admin: true`; a profile or remembered role cannot grant access.
Account changes and sign-out invalidate pending verification. Permission retries
share a fresh Auth verification and hide protected data until it succeeds.

For local diagnosis, confirm that frontend/backend use the same Firebase project,
the signed-in account has the intended trusted role claims, and database rules
authorize the operation. Never paste bearer tokens into an issue.

For Firebase Auth, the resolver uses the browser hostname automatically only
on the project's primary `<project>.web.app`/`<project>.firebaseapp.com` sites.
Configure custom/secondary Hosting domains explicitly, including authorized
domains and the OAuth redirect URI `https://<frontend-host>/__/auth/handler`.
Do not point the Auth helper at a frontend tunnel that cannot serve Firebase's
`/__/auth/` helper routes. Keep the Hosting CSP auth frame policy generated by
the build. See [domain setup](operations/DNS_AND_DOMAINS.md).

## Firmware configuration

Firmware has a separate ignored file, [`hardware/include/secrets.h`](../hardware/include/secrets.example.h)
created from the tracked template. It must define exactly these device inputs:

| Definition | Source | Reflash when changed? |
|---|---|---|
| `WIFI_SSID`, `WIFI_PASS` | Vehicle hotspot/Wi-Fi | Yes |
| `DEVICE_ID`, `DEVICE_SECRET` | Backend device provisioning command | Yes; update the backend registry first |
| `BACKEND_URL` | Deployed backend HTTPS origin | Yes |
| `BACKEND_ROOT_CA` | Issuing root CA for that backend hostname | Yes when the issuer/chain changes |

The firmware validates SSID/password lengths, safe device-ID/secret characters,
an origin-only backend URL, and the PEM CA format. Fleet builds additionally
require HTTPS, Secure Boot V2, release-mode flash encryption, ROM-download
lockdown, signed binaries, and an ECO3-or-newer ESP32. Route IDs, bus IDs,
route geometry, stops, drivers, delays, service settings and passenger data are
backend records—not firmware configuration. See the complete [hardware setup
guide](../hardware/README.md) for the provisioning order, build commands,
route-specific changes, and post-flash checks.

## Firebase and infrastructure configuration

Worker clocks must stay within the fixed 2-second skew allowance. A configured
instance label always receives a process UUID. The lease's generation survives
release and must not be reset during failover. See [worker leadership](operations/WORKER_LEADERSHIP.md)
for independent expiry, destination checks and dispatched Auth/deletion limits.

The application expects these separately managed resources:

- Firebase Authentication for identity and custom role claims.
- Firestore for configuration, durable ride state, locks, sessions, messages,
  feedback, requests, and internal worker/privacy state.
- RTDB for backend-only `activeBuses` authority, compact `publicRouteBuses` client views, `liveRouteCatalog` availability and server-managed assignment mirrors.
- Firebase Hosting for the static Next.js export and security headers.
- A managed HTTPS runtime for the Express backend, with monitoring, backups,
  WAF/global rate limits, and a single effective worker lease owner.
- Google Maps Routes/Places APIs with separate server and browser keys.
- App Check enforcement disabled for Firestore and RTDB. Security Rules retain
  identity, role and data authorization.

The checked-in rules are default-deny for sensitive data. The Admin SDK bypasses
Firebase client rules, so backend identity, deployment credentials and runtime
network controls remain critical.

## Configuration by environment

| Concern | Local development | Staging | Production |
|---|---|---|---|
| Firebase project | Dedicated developer/test project | Isolated non-production project | Separate university-owned production project |
| Backend credentials | Local ADC or ignored `.env` | Secret manager/GitHub environment | Workload Identity or Secret Manager |
| CORS | Local frontend origin plus configured test origins | Exact staging frontend origin(s) | Exact approved university frontend origin(s) |
| App Check | Not used | Enforcement disabled | Enforcement disabled |
| Retention sweeper | Disabled | Explicitly approved test schedule | Explicitly enabled and privacy-approved; startup requires enforcement |
| Device firmware | `esp32dev` for bench work | Signed fleet build after acceptance | Signed, protected device-specific artifact only |
| Deployment | `npm run dev` | CI verified build and controlled deploy | Approval-gated deployment plus backend/runtime rollout |

## Secret and public-data rules

Never put these in Markdown, source control, issue comments, screenshots or
normal logs:

- Firebase service-account JSON or access tokens;
- device secrets, Wi-Fi passwords, App Check debug tokens or bearer tokens;
- Secure Boot signing keys, unencrypted firmware artifacts or private CA keys;
- private hostnames, tunnel credentials, internal addresses or unredacted
  passenger/driver/location data.

Device secrets are generated by the provisioning command, stored server-side as
salted verifiers, and embedded only inside the controlled protected firmware
build. A credential change requires a backend rotation/disablement workflow and
a corrected reflash. Browser Firebase/Maps values are public identifiers, but
they must still be restricted and are never a substitute for backend
authorization.

## Configuration verification

After changing configuration:

1. Confirm the value belongs to the intended environment and contains no secret
   pasted into a public file.
2. Run `npm run lint` and the relevant workspace tests.
3. Run `npm run build:production` for frontend environment changes.
4. Check backend `/health` and the browser’s Auth state.
5. For device changes, build the intended PlatformIO environment, verify the
   device-specific artifact in the controlled process, and perform the physical
   acceptance checks in [Hardware telemetry](hardware/HARDWARE_TELEMETRY.md).

Telemetry response/dependency budgets are fixed in software: 8 seconds for
validated service calls, at most 5 seconds per dependency stage, 2 seconds
waiting and 8 active/32 waiting pipelines per process (1 waiting/device).
Replicas multiply these execution ceilings. See
[telemetry deadlines](operations/TELEMETRY_DEADLINES.md); these limits do not
replace body/header receipt timeouts or the shared per-device quota.

Preview/fleet operation bounds are fixed software defaults: 2 active executors,
8 queued, 2-second queue age; admission and control pools each allow 16 raw
fills, 32 coalesced waiters/fill and 3-second response budgets. Fleet locks and
recovery use unique process UUIDs independent of `WORKER_INSTANCE_ID`.
See [operation resources](api/OPERATION_RESOURCES.md) before recovering an
unknown claim; retention includes terminal claims and audited lock recoveries.

Reconciliation uses fixed software bounds: 100-record pages, four abandoned-session pipelines and ten fleet Auth pipelines per batch. Worker cursors are durable and lease-fenced. Fleet legacy/admin admission is two active/eight waiting with a two-second queue age; no new environment variable or retention/privacy policy changes. See [reconciliation](operations/RECONCILIATION.md).

Privacy queue software bounds are fixed: twenty-record pages every minute, one raw execution/twenty waiting, two-second queue age, thirty-second dispatch budget and five consecutive failures with exponential jittered retry capped at one hour. No new environment variable or retention policy is introduced. See [privacy deletion](operations/PRIVACY_DELETION.md).

The telemetry route catalog uses fixed 1000-entry LRU data/generation bounds and five-minute monotonic positive/negative freshness. Pending directions share per-route fills; watcher failure invalidates data, with existing 1–30 second reconnect backoff. No new environment variable/provider policy is introduced. See [route catalog](operations/ROUTE_CATALOG.md).

Passenger geometry reads are cached and read-only; explicit versioned admin saves perform legacy repair through bounded computation. See [geometry read/repair contract](operations/ROUTE_GEOMETRY_READS.md) for fixed bounds, independent quotas and staging limits.
