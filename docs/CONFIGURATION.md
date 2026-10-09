# Environment and configuration reference

Last updated: 2026-10-05 17:45 IST (UTC+05:30).

This page documents configuration names and safe handling rules. Values below
are placeholders. Use separate files and projects for local, staging and
production environments.

## Backend variables

Store these in the ignored `backend/.env` file or inject them through the
runtime secret/configuration system.

| Variable | Required | Meaning | Safe guidance |
|---|---|---|---|
| `PORT` | No | HTTP listener port; defaults to `4000` in local use | Expose through the managed HTTPS runtime in production |
| `NODE_ENV` | Recommended | Set `production` to enable production guards | Production refuses to start without `CORS_ORIGIN` |
| `CORS_ORIGIN` | Production | Comma-separated exact frontend origins | Never use `*` for this credential-free API; do not include paths |
| `API_APPCHECK_MODE` | No | `off` (compatibility default) or `enforce`: additional attestation for browser mutations and high-cost reads | Stage after consumer/provider verification; does not replace ID-token/RBAC or device authentication. See [browser API security](operations/BROWSER_API_SECURITY.md) |
| `FIREBASE_SERVICE_ACCOUNT` | Conditional | Server-side Firebase Admin JSON | Prefer Workload Identity/ADC or Secret Manager; never commit or log it |
| `FIREBASE_DATABASE_URL` | Yes for RTDB | Firebase RTDB URL | Use the environment’s URL; no code fallback exists |
| `GOOGLE_MAPS_API_KEY` | Route/places features | Server-side Routes/Places key | Restrict by runtime identity/IP and enabled APIs; keep it different from the browser key |
| `BUS_STALE_MS` | No | Live bus staleness threshold; minimum `90000`, default `300000` | Align the alert/runbook threshold with the deployed value |
| `AUTOMATIC_TURNAROUND_DWELL_MS` | No | Optional delay after completion before arming the return; minimum/default `0` | A fresh stopped terminal fix is still required. Set a positive delay only when the service schedule requires it |
| `HTTPS_DEVICE_RATE_PER_MINUTE` | No | Shared accepted device requests per device per minute; default `90` | Supports 1 Hz moving telemetry with retry headroom across replicas; add an edge/WAF limit |
| `HTTPS_DEVICE_RATE_LIMIT_MODE` | No | Authenticated device limiter mode; defaults to `distributed` | Use `local` only for an explicitly single-instance deployment with `RATE_LIMIT_SHARD_FACTOR=1` |
| `HTTPS_DEVICE_RATE_LIMIT_LEASE_SIZE` | No | Tokens reserved per shared RTDB transaction in distributed mode; default `5`, capped at the minute limit | Larger values reduce transactions but can temporarily strand unused capacity after replica loss |
| `FIRMWARE_RELEASE_VERSION` | OTA set | Signed image version in `s<sequence>-<name>` form | Must exactly match the image descriptor; configure all five fields together or leave all unset |
| `FIRMWARE_RELEASE_SEQUENCE` | OTA set | Strictly increasing positive release number | Must exceed the sequence compiled into the installed image |
| `FIRMWARE_RELEASE_URL` | OTA set | Exact HTTPS URL of the signed application binary | Publish immutable content; never put credentials in the URL |
| `FIRMWARE_RELEASE_SHA256` | OTA set | SHA-256 digest of the exact signed binary | Record and verify this from the controlled signing environment |
| `FIRMWARE_RELEASE_SIZE` | OTA set | Exact binary size in bytes (maximum 1,966,080) | Must match both the hosted object and signed release evidence |
| `RATE_LIMIT_SHARD_FACTOR` | No | Expected backend replica count used to divide in-process budgets; default `1` | Set to the deployed replica count; values above the smallest in-process budget are rejected |
| `AUTH_REVOCATION_CACHE_MS` | No | Short cache for ordinary passenger Firebase Auth revocation checks; `0` disables it, maximum `60000` | Privileged admin/driver claims receive a fresh check for each HTTP request; admission and route middleware reuse that request's verified token |
| `AUTH_MAX_PENDING_VERIFICATIONS` | No | Maximum distinct Firebase Auth verifications in flight per backend process; default `256`, maximum `2000` | Size for expected concurrency; overflow fails with retryable HTTP 503 instead of growing memory without bound |
| `WORKER_ENABLED` | No | Enables the Firestore-lease background worker; default `true` | Keep enabled for lifecycle recovery, abandonment and retention jobs |
| `WORKER_INSTANCE_ID` | No | Stable diagnostic identity for a runtime instance | Do not use credentials or personal data |
| `ABANDONED_RIDE_THRESHOLD_HOURS` | No | Age before conservative abandoned-ride reconciliation; minimum `1`, default `12` | Obtain privacy/operations approval before changing it |
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
| `LOG_LEVEL` | Optional | Structured application logging level; template `info` | `debug`, `info`, `warn` or `error` |

The exact defaults and comments are maintained in [`backend/.env.example`](../backend/.env.example).
Configuration is loaded before Firebase initialization; changing it requires a
backend restart.

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
| `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` | Production/App Check | Firebase App Check browser site key | Use the matching environment; enforcement is configured in Firebase |
| `NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN` | Local development only | Registered Firebase App Check debug token; `true` requests a generated debug token that still requires registration | Ignored by production runtime; never include it in a production build or commit it |
| `NEXT_PUBLIC_FIREBASE_APPCHECK_DISABLED` | Unenforced development only | Explicit `true` opt-out when no provider key/debug token is configured and `NODE_ENV=development` | Does not disable Firebase Console enforcement; ignored in test/staging/production modes |
| `NEXT_PUBLIC_BACKEND_URL` | Yes | HTTPS backend origin used by REST mutations | Use an origin only—no `/api` suffix, path or query string |
| `NEXT_PUBLIC_SERVICE_TIME_ZONE` | Optional | Display timezone; default template is `Asia/Kolkata` | Use an IANA timezone name |
| `NEXT_PUBLIC_PASSENGER_BUS_START_TIME` | Optional | Passenger display default for service start | This is presentation configuration, not a dispatch rule |
| `NEXT_PUBLIC_BUS_EXPIRY_MS` | Optional | Client-side stale-display threshold | Keep consistent with the operational stale-state policy |

The complete tracked template is [`frontend/env.production.example`](../frontend/env.production.example).
The strict production build fails when mandatory values are missing or when the
backend URL is local/non-HTTPS.

Before an RTDB migration or release, expose the backend and frontend database
URLs only as environment variables and run `npm run verify:rtdb-instance`.
Optionally set `RTDB_EXPECTED_REGION` to the approved region. The preflight
prints only the verified region and fails if the two instance hosts differ;
it never prints configuration URLs or credentials. See the
[RTDB region decision](design/RTDB_REGION_LATENCY_DECISION.md).

## Local App Check and Auth setup

Choose one App Check path for the development build:

| Firebase project | Frontend configuration |
|---|---|
| Enforced, provider works on your hostname | Configure `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY`; register the hostname for the provider |
| Enforced, local debug workflow | Register a debug token in Firebase Console; set it only in ignored `.env.local`. The debug provider also works without a site key |
| Unenforced development project | With no site key/debug token, set `NEXT_PUBLIC_FIREBASE_APPCHECK_DISABLED=true`; this works only when `NODE_ENV=development` |
| Staging/production | Valid provider key and enforced Firebase services; no local opt-out or debug token |

Do not leave a placeholder site key active while expecting the missing-key
opt-out: a configured key selects the provider path. Restart the frontend after
editing these values.

`ensureAppCheck()` waits up to 10 seconds for a valid token. One pending SDK
token acquisition remains shared until it settles, even after the caller's
deadline; repeatedly clicking retry cannot start unbounded acquisitions.
Authentication refreshes the ID token and verifies trusted role claims before
publishing the user and enabling protected
Firestore/RTDB listeners. Provider, token, role and timeout failures keep access
closed. Account changes and sign-out invalidate earlier pending verification.

For an administrator, Auth custom claims must contain both `role: "admin"`
and `admin: true`. A Firestore profile or remembered role alone cannot authorize
the admin workspace. Synchronize claims through the existing trusted admin
procedure after changing a profile; do not grant privileges in browser code.

If fleet/routes/drivers report `permission-denied`, use the panel's **Retry**.
Permission retries and **Try again** on the verification screen share one
fresh App Check/Auth verification, hide protected data while it runs, and
subscribe again only after successful verification. Other transient listener
errors reconnect without an extra security-token refresh. A permanently
rejected SDK token requires repairing local enrollment and restarting the
frontend; the retry does not disable Console enforcement or register tokens.

For localhost diagnosis, first confirm the frontend and backend use the same
Firebase project and an enrolled provider/debug token for that project's web
app. Restart after changing ignored `.env.local`, then sign in and open Fleet
and Routes. An Auth admin claim does not bypass enforced App Check. Record
only redacted success/error codes; never paste debug or bearer tokens into an
issue. Actual account/provider acceptance remains #204/#245 until observed
in the affected browser.

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
- App Check configured and enforced for Firestore and RTDB in Firebase Console.
  Security Rules handle identity, role and data authorization; they cannot read
  an App Check token.

The checked-in rules are default-deny for sensitive data. The Admin SDK bypasses
Firebase client rules, so backend identity, deployment credentials and runtime
network controls remain critical.

## Configuration by environment

| Concern | Local development | Staging | Production |
|---|---|---|---|
| Firebase project | Dedicated developer/test project | Isolated non-production project | Separate university-owned production project |
| Backend credentials | Local ADC or ignored `.env` | Secret manager/GitHub environment | Workload Identity or Secret Manager |
| CORS | Local frontend origin plus configured test origins | Exact staging frontend origin(s) | Exact approved university frontend origin(s) |
| App Check | Debug token only when needed | Enforced after validation | Enforced and monitored |
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
4. Check backend `/health` and the browser’s App Check/Auth state.
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

Passenger geometry reads are cached and read-only; explicit versioned admin saves perform legacy repair through bounded computation. See [geometry read/repair contract](../operations/ROUTE_GEOMETRY_READS.md) for fixed bounds, independent quotas and staging limits.
