# Eki Configuration Reference

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-GEN-005 | 1.2 | Current | 2026-11-01 |

## 1. Purpose

This reference lists every setting that changes Eki's behaviour: backend, frontend, QA and tooling environment variables, firmware definitions, and GitHub deployment secrets. For each setting it states whether it is required, its default, its effect and the source file that reads it. [Getting started](GETTING_STARTED.md) walks through a first local configuration; terms are defined in the [glossary](GLOSSARY.md).

Values in this document are placeholders. Use a separate Firebase project and separate files for local, staging and production environments.

## 2. Configuration files

| File | Created from | Read by | A change takes effect after |
|---|---|---|---|
| `backend/.env` | `backend/.env.example` | The backend process. `backend/src/bootstrap.ts` loads `.env` from the working directory with `dotenv`; workspace scripts run in `backend/`. `npm run seed` loads `backend/.env` by absolute path (`backend/src/seedEnvironment.ts`), so it also works from the repository root. | Backend restart |
| `frontend/.env.local` | `frontend/env.production.example` | The Next.js dev server and build, and the build scripts `scripts/update-csp.mjs` and `scripts/verify-web-backend-contract.mjs` through `scripts/load-frontend-env.mjs` | Dev server restart or rebuild. `NEXT_PUBLIC_*` values are compiled into the browser bundle. |
| `hardware/include/secrets.h` | `hardware/include/secrets.example.h` | The firmware build | Rebuild and reflash |
| Shell environment | `qa/qa.env.example` for the GNSS property run | QA, test and release scripts | Next command |
| GitHub environment secrets and variables | Section 7 | `.github/workflows/deploy.yml` | Next workflow run |

Git ignores `backend/.env`, `frontend/.env*` and `hardware/include/secrets.h`. Never commit a filled copy, and never paste service-account JSON, device secrets, Wi-Fi passwords, bearer tokens or signing keys into an issue, a pull request or a log. Browser Firebase and Maps values are public identifiers: restrict them by hostname and API, and do not treat them as authorization.

## 3. Backend variables

The tables below cover every variable in `backend/.env.example` and every other variable that the backend server and its command-line tools read; test-only variables are in Section 6. "Template" is the value in `backend/.env.example`; "Default" is the value the code uses when the variable is unset. Paths are relative to `backend/src/`.

The template is a production template. Copied unchanged, it sets `NODE_ENV=production` with `RETENTION_SWEEPER_ENABLED=false`, and the backend refuses to start. [Getting started](GETTING_STARTED.md#4-configure-the-backend) lists the local values.

### 3.1 Server and network

| Variable | Required | Default | Effect | Read in |
|---|---|---|---|---|
| `PORT` | No | `4000` (template `8080`) | HTTP listen port. | `server.ts` |
| `NODE_ENV` | No | Unset (template `production`) | `production` makes `CORS_ORIGIN`, `FIREBASE_DATABASE_URL` and `RETENTION_SWEEPER_ENABLED=true` mandatory at startup, trusts one proxy hop by default and stops adding `http://localhost:3000` to the CORS list. | `server.ts`, `lib/firebaseAdmin.ts`, `lib/trustProxy.ts`, `services/retentionSweeper.ts` |
| `CORS_ORIGIN` | In production | Empty | Comma-separated exact browser origins, without paths. Outside production `http://localhost:3000` is always added. Never use `*`. | `server.ts` |
| `TRUST_PROXY` | No | One hop in production, none elsewhere | Which reverse proxy may supply `X-Forwarded-For` for pre-authentication IP rate limits: `false`, `loopback`, or a hop count from `0` to `10`. Any other value, including `true`, refuses startup. Use `loopback` behind a local ngrok agent so tunnelled clients do not share one bucket. | `lib/trustProxy.ts` |
| `LOG_LEVEL` | No | `info` | Structured log threshold: `debug`, `info`, `warn` or `error`. | `lib/logger.ts` |

### 3.2 Firebase and Google Maps

| Variable | Required | Default | Effect | Read in |
|---|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | No | Unset | Firebase Admin service-account JSON object. When unset, the backend uses Application Default Credentials [1]. Malformed JSON refuses startup. Prefer Workload Identity or a secret manager in production. | `lib/firebaseAdmin.ts` |
| `FIREBASE_DATABASE_URL` | In production | None | Realtime Database (RTDB) origin for Firebase Admin. Outside production a missing value lets the process start, but every RTDB feature fails. Must name the same instance as `NEXT_PUBLIC_FIREBASE_DATABASE_URL`. | `lib/firebaseAdmin.ts` |
| `GOOGLE_MAPS_API_KEY` | For route geometry | None | Server key for the Google Routes API (`computeRoutes`: route geometry, reroutes and departure traffic) and Places API (New) Text Search (admin place search). Without it, route computation and place search fail and `npm run seed` stops. Keep it different from the browser key, and restrict it to the server's IP addresses and to these two APIs. | `lib/googleMaps.ts`, `routes/polyline.ts`, `routes/places.ts` |

### 3.3 Ride lifecycle and live state

| Variable | Required | Default | Effect | Read in |
|---|---|---|---|---|
| `BUS_STALE_MS` | No | `300000` | Age after which the worker removes a live bus record from `activeBuses`, or marks it `offline` if it carries an active ride. Values below `90000` or non-numeric values use the default. | `services/tripStateEngine.ts`, `services/staleBusSweeper.ts` |
| `AUTOMATIC_TURNAROUND_DWELL_MS` | No | `30000` | Wait after a confirmed completion before a fresh stopped fix at the terminal can arm the opposite direction. `0` is allowed; negative or non-numeric values use the default. | `services/tripStateEngine.ts` |
| `TERMINAL_ARRIVAL_CONFIRMATION_MS` | No | `2000` | Time that reliable stopped fixes at the final stop must span before the ride completes. Values below `1000` or non-numeric values use the default; there is no upper bound. | `services/tripStateReducer.ts` |
| `LIVE_DEPARTURE_ROUTES_ENABLED` | No | `true` | Enables the billable departure-time Google Routes traffic calculation: one request at arming, reused at departure for up to five minutes. Boolean flag (Section 3.9). | `services/telemetryRouteService.ts`, `lib/booleanEnv.ts` |
| `ABANDONED_RIDE_THRESHOLD_HOURS` | No | `12` | Inactivity after which the worker ends a `pending`, `armed` or `active` session as `interrupted`. Values below `1` use the default. An automatic return that has not departed gets at least 24 hours. | `services/abandonedRideReconciler.ts`, `services/abandonedRideReconciliationLogic.ts` |

### 3.4 Rate limits and authentication

| Variable | Required | Default | Effect | Read in |
|---|---|---|---|---|
| `HTTPS_DEVICE_RATE_PER_MINUTE` | No | `90` | Accepted device requests per device per minute; in distributed mode the budget is shared by all replicas. Non-positive or non-numeric values use the default. | `services/deviceRateLimiter.ts` |
| `HTTPS_DEVICE_RATE_LIMIT_MODE` | No | `distributed` | `distributed` keeps device budgets in RTDB; `local` keeps them in process memory and requires `RATE_LIMIT_SHARD_FACTOR=1`. Any other value refuses startup. | `services/deviceRateLimiter.ts` |
| `HTTPS_DEVICE_RATE_LIMIT_LEASE_SIZE` | No | `5` | Tokens reserved per RTDB transaction in distributed mode, capped at the per-minute limit. Larger values mean fewer transactions but more stranded capacity after a replica stops. | `services/deviceRateLimiter.ts` |
| `HTTPS_INGRESS_DEVICES_PER_IP` | No | `100` | Largest fleet expected behind one public IP. Per IP and 10 s window, telemetry allows 15 requests per device; diagnostics and firmware each allow 2. Must be an integer from `1` to `100000`, otherwise the backend does not start. | `routes/devices.ts` |
| `RATE_LIMIT_SHARD_FACTOR` | No | `1` | Expected replica count. Every in-memory limiter divides its budget by this number. A value that is not a positive decimal integer, or that exceeds the smallest in-process budget (10 per minute), refuses startup. | `lib/rateLimitShard.ts`, `services/deviceRateLimiter.ts` |
| `AUTH_REVOCATION_CACHE_MS` | No | `15000` | Cache lifetime for Firebase Auth revocation checks of passenger tokens. `0` disables the cache; values above `60000` are capped. Admin and driver tokens are always checked fresh. | `services/authTokenVerifier.ts` |
| `AUTH_MAX_PENDING_VERIFICATIONS` | No | `256` | Distinct Firebase Auth verifications in flight per process; overflow returns a retryable HTTP 503. Values above `2000` are capped; non-positive values use the default. | `services/authTokenVerifier.ts` |

### 3.5 Worker and data retention

| Variable | Required | Default | Effect | Read in |
|---|---|---|---|---|
| `WORKER_ENABLED` | No | `true` | Lets this process compete for the worker lease. `false` keeps a replica out of leader election. Boolean flag (Section 3.9). | `services/workerCoordinator.ts`, `lib/booleanEnv.ts` |
| `WORKER_INSTANCE_ID` | No | `worker` | Diagnostic label for the lease owner. The backend always appends a process UUID. Do not put credentials or personal data in it. | `services/workerCoordinator.ts` |
| `RETENTION_SWEEPER_ENABLED` | In production | Disabled | Only `true` (trimmed, any case) enables the daily destructive retention sweep. In production any other value refuses startup. Keep it disabled locally. | `services/retentionSweeper.ts`, `server.ts` |
| `LEGACY_RTDB_RETIRED` | No | `false` | Exactly `true` lets the retention sweep and `npm run retention:rtdb` remove the retired RTDB `users` and `messages` trees. See [RTDB retention](operations/RTDB_RETENTION.md) first. | `services/retentionSweeper.ts`, `rtdbRetentionCli.ts` |
| `RIDE_SESSION_RETENTION_DAYS` | No | `180` | Age, from `endTime`, after which terminal ride sessions are deleted. | `services/retentionSweeper.ts` |
| `FEEDBACK_RETENTION_DAYS` | No | `180` | Age after which feedback records are deleted. | `services/retentionSweeper.ts` |
| `COMPLETED_TRIP_RETENTION_DAYS` | No | `180` | Age, from `completedAt`, after which completed-trip records are deleted. | `services/retentionSweeper.ts` |
| `OPERATION_LOG_RETENTION_DAYS` | No | `90` | Age after which operational records are deleted. | `services/retentionSweeper.ts` |

Retention periods require approval by the university privacy owner before production use.

### 3.6 Signed firmware release

Set all six variables together to offer a signed firmware update, or leave all six unset to disable updates. A partial or malformed set makes the firmware endpoint return HTTP 503. The backend withholds the update while the device's bus has an active ride. See [hardware security provisioning](security/HARDWARE_SECURITY_PROVISIONING.md).

| Variable | Required | Default | Effect | Read in |
|---|---|---|---|---|
| `FIRMWARE_RELEASE_VERSION` | With the set | Unset | Release name `s<sequence>-<name>`; the sequence must equal `FIRMWARE_RELEASE_SEQUENCE`. | `services/firmwareRelease.ts` |
| `FIRMWARE_RELEASE_SEQUENCE` | With the set | Unset | Positive release number; it must exceed the sequence of the installed image. | `services/firmwareRelease.ts` |
| `FIRMWARE_RELEASE_URL` | With the set | Unset | HTTPS URL of the signed application binary. | `services/firmwareRelease.ts` |
| `FIRMWARE_RELEASE_ALLOWED_ORIGIN` | With the set | Unset | HTTPS origin that must host `FIRMWARE_RELEASE_URL`. | `services/firmwareRelease.ts` |
| `FIRMWARE_RELEASE_SHA256` | With the set | Unset | SHA-256 digest of the signed binary, 64 hexadecimal characters. | `services/firmwareRelease.ts` |
| `FIRMWARE_RELEASE_SIZE` | With the set | Unset | Binary size in bytes, at most `1966080`. | `services/firmwareRelease.ts` |

### 3.7 OpenTelemetry

Instrumentation starts only when an OTLP endpoint is set and `OTEL_SDK_DISABLED` is not `true`. The backend exports traces, metrics and logs over OTLP/HTTP with JSON encoding. The local Collector in `observability/` listens on port `4318`. Variables marked "SDK" are read by the OpenTelemetry Node SDK or its exporters [2].

| Variable | Required | Default | Effect | Read in |
|---|---|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Unset | OTLP endpoint for all signals. Setting it, or the traces endpoint, enables instrumentation. | `instrumentation.ts`, SDK |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | No | Unset | Trace-only endpoint; also enables instrumentation. | `instrumentation.ts`, SDK |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | Unset | Exporter headers, for example an authorization header. Secret: keep it in a secret manager. | SDK |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | No | Template `http/protobuf` | No effect on export: `telemetrySdk.ts` passes explicit OTLP/HTTP JSON exporters to the SDK. | SDK |
| `OTEL_SERVICE_NAME` | No | `eki-backend` | Service name on all telemetry. | `telemetrySdk.ts` |
| `OTEL_RESOURCE_ATTRIBUTES` | No | Unset | Comma-separated resource attributes such as `deployment.environment`. No personal data or secrets. | SDK |
| `OTEL_TRACES_SAMPLER` | No | `parentbased_traceidratio` | Trace sampler. When unset, the backend sets this sampler with argument `0.1`. | `instrumentation.ts`, SDK |
| `OTEL_TRACES_SAMPLER_ARG` | No | `0.1` when the sampler is unset | Sampler argument; `0.1` keeps 10 % of new root traces. | `instrumentation.ts`, SDK |
| `OTEL_SDK_DISABLED` | No | `false` | `true` turns instrumentation off even when an endpoint is set. | `instrumentation.ts` |

### 3.8 Command-line tools

| Variable | Required | Default | Effect | Read in |
|---|---|---|---|---|
| `RTDB_LATENCY_SAMPLES` | No | `30` | Sample count for `npm run measure:rtdb --workspace=backend`. Must be an integer from `10` to `500`. The server does not read it. | `measureRtdbLatency.ts` |

### 3.9 Parsing rules

- `WORKER_ENABLED` and `LIVE_DEPARTURE_ROUTES_ENABLED` are boolean flags. After trimming and lowercasing, `true`, `1`, `yes` and `on` enable; `false`, `0`, `no` and `off` disable; unset or blank uses the default. Any other value refuses startup with an error that names the variable (`lib/booleanEnv.ts`).
- The `*_RETENTION_DAYS` values must be whole numbers of at least `1`; other values use the default. Values above `36500` are capped at `36500`.
- The backend reads configuration at startup. Restart it after every change.

## 4. Frontend variables

All frontend variables are `NEXT_PUBLIC_*` values: Next.js compiles them into the browser bundle, so anyone can read them. Paths are relative to `frontend/`. `npm run build:production` fails unless every variable marked "Yes" is set, and fails if `NEXT_PUBLIC_FIREBASE_DATABASE_URL` or `NEXT_PUBLIC_BACKEND_URL` is not a non-local HTTPS URL (`next.config.ts`).

| Variable | Required | Default | Effect | Read in |
|---|---|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes | None | Firebase web API key. Restrict it to the frontend hosts and Firebase APIs. | `src/lib/firebaseCore.ts` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | None | Firebase Auth helper domain. On the project's own `<project-id>.web.app` or `<project-id>.firebaseapp.com` host the browser hostname replaces it. For a custom or secondary domain, set it to the frontend hostname (Section 8). | `src/lib/firebaseCore.ts`, `src/lib/firebaseAuthDomain.ts` |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | Yes | `https://<project-id>-default-rtdb.firebaseio.com` | Browser RTDB origin. Must name the same instance as the backend's `FIREBASE_DATABASE_URL`. | `src/lib/firebaseCore.ts` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes | `eki-build-placeholder` | Firebase project ID. The placeholder only lets a build without configuration render. | `src/lib/firebaseCore.ts` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | None | Firebase web app configuration value. | `src/lib/firebaseCore.ts` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes | None | Firebase web app configuration value. | `src/lib/firebaseCore.ts` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Yes | None | Firebase web app ID. | `src/lib/firebaseCore.ts` |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | No | None | Passed to the Firebase configuration. The app does not load Firebase Analytics, so it has no runtime effect. | `src/lib/firebaseCore.ts` |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Yes | Empty | Browser key for the Maps JavaScript API. Restrict it by HTTP referrer. | `src/config/maps.ts` |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | Yes | Empty | Cloud map ID used for map styling and advanced markers. | `src/config/maps.ts` |
| `NEXT_PUBLIC_BACKEND_URL` | Yes | None | Backend origin for all HTTP commands, without a path or query. HTTP is accepted only for `localhost`, `127.0.0.1` and `[::1]`. The build writes this origin into the Hosting CSP `connect-src`. | `src/lib/apiClient.ts` and callers, `scripts/update-csp.mjs` |
| `NEXT_PUBLIC_SITE_URL` | No | `https://bustrack-be165.web.app` | Canonical origin for metadata, `robots.txt` and the sitemap. Must be an origin without path, query, fragment or credentials. HTTP is accepted only for `localhost`, `127.0.0.1` and `[::1]` outside production builds. | `src/lib/siteMetadata.ts` |
| `NEXT_PUBLIC_SITE_INDEXING` | No | Enabled | `false` disables search indexing and sitemap discovery; any other value enables them. Use `false` for preview and staging builds. | `src/lib/siteMetadata.ts` |
| `NEXT_PUBLIC_SERVICE_TIME_ZONE` | No | `Asia/Kolkata` | IANA time zone for ride history timestamps. | `src/components/admin/RideHistoryPanel.tsx` |
| `NEXT_PUBLIC_PASSENGER_BUS_START_TIME` | No | `8:00 am` | Service start time shown to passengers when no bus is running and the admin setting is empty. | `src/config/passenger.ts` |
| `NEXT_PUBLIC_BUS_EXPIRY_MS` | No | `300000` (template `3600000`) | How long a silent bus stays on the passenger map and route list; Live Ops never removes it. The passenger "Live tracking lost" threshold is the smaller of 30 s and half this value; "Updates delayed" is the smaller of 12 s and that threshold. | `src/lib/liveBusFreshness.ts` |

`scripts/update-csp.mjs` and `scripts/verify-web-backend-contract.mjs` load `frontend/.env*` with `@next/env` in production mode, and shell values take precedence, as in `next build`. The contract check is skipped only when neither the shell nor a `frontend/.env*` file sets `NEXT_PUBLIC_BACKEND_URL`.

## 5. Firmware definitions

`hardware/include/secrets.h` must define these six macros. `hardware/src/main.cpp` reads them and validates their format at boot. Route, bus, stop and driver data are backend records, not firmware configuration. The [hardware guide](../hardware/README.md) covers provisioning order, builds and post-flash checks.

| Definition | Source of the value | Effect | Reflash after a change |
|---|---|---|---|
| `WIFI_SSID` | Vehicle hotspot or Wi-Fi network | Network name | Yes |
| `WIFI_PASS` | Vehicle hotspot or Wi-Fi network | Network password | Yes |
| `DEVICE_ID` | `npm run provision-device --workspace=backend` | Device identity in the device registry | Yes; update the registry first |
| `DEVICE_SECRET` | Printed once by the provisioning command | Credential sent as `Authorization: Device <secret>` | Yes; update the registry first |
| `BACKEND_URL` | Deployed backend HTTPS origin | Telemetry destination. Fleet builds require HTTPS. | Yes |
| `BACKEND_ROOT_CA` | Issuing root certificate of the backend hostname | TLS trust anchor | Yes, when the certificate chain changes |

## 6. QA, test and tooling variables

These variables are set in the shell or by the scripts themselves. None belongs in `backend/.env` or a production environment.

| Variable | Effect | Read in |
|---|---|---|
| `EKI_QA_SEED` | Seed for `npm run qa:gnss`, an integer from `0` to `4294967295`; default `42`. Listed in `qa/qa.env.example`. | `scripts/qa/run-gnss.mjs` |
| `EKI_QA_REPLAY_PATH` | Replays one generated GNSS property case, an integer from `0` to `399`. Remove it to run the full campaign. Listed in `qa/qa.env.example`. | `scripts/qa/run-gnss.mjs` |
| `EKI_QA_BASE_SHA` | Full 40-character base commit for `npm run qa:budget`. | `scripts/qa/coverage-budget.mjs` |
| `EKI_QA_CAMPAIGN_DAY` | Date label for `npm run qa:nightly` campaign artifacts; default today in UTC. | `scripts/qa/campaign.mjs` |
| `EKI_QA_RESEARCH_DIR` | Private snapshot directory for the catalog builder. | `scripts/qa/build_catalog.mjs` |
| `EKI_QA_BASE_URL` | Loopback backend root checked by the QA safety preflight. | `scripts/qa/safety-preflight.mjs` |
| `EKI_QA_PORT` | Port of the Vite test fixture server; default `3100`. | `e2e/fixtures/vite.config.mts`, `playwright.passenger-layout.config.ts` |
| `EKI_QA_BROWSER_SCOPE`, `EKI_QA_CONFIRM_DISPOSABLE`, `EKI_QA_EXTERNAL_PROVIDERS`, `FIREBASE_RULES_TEST`, `FIRESTORE_RULES_PATH`, `DATABASE_RULES_PATH`, `GCLOUD_PROJECT` | Set by `scripts/run-rules-emulator.mjs`. Emulator tests refuse to run unless they target the disposable `demo-eki-qa` project on loopback ports with mocked providers. | `scripts/run-rules-emulator.mjs`, `backend/src/test-support/emulatorIsolation.ts`, `backend/src/rulesIntegration.test.ts` |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_DATABASE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `FIREBASE_CONFIG` | Set by `firebase emulators:exec`, which `scripts/run-rules-emulator.mjs` starts. The QA runners remove the generated `FIREBASE_CONFIG` before the tests run. | `backend/src/test-support/emulatorIsolation.ts`, `scripts/qa/emulator-environment.mjs` |
| `PYTHON` | Python interpreter for the script tests that run Python tools; default `python` on Windows and `python3` elsewhere. | `scripts/field-capture.test.mjs`, `scripts/interaction-audit.test.mjs` |
| `JAVA_HOME` | Java installation used by the Firebase emulators. | `scripts/qa/emulator-process.mjs` |
| `EKI_E2E_BASE_URL` | Base URL for `npm run test:e2e`; default `http://127.0.0.1:3000`. | `playwright.config.ts` |
| `EKI_E2E_STORAGE_STATE` | Saved admin session for `npm run test:e2e`; the responsive admin test is skipped without it. | `playwright.config.ts`, `e2e/admin-responsive.spec.ts` |
| `EKI_ADMIN_ACCESS_SRC` | Another checkout's `frontend/src` (with `node_modules` reachable from it) for the admin access fixture, to run the same checks against a committed revision as an A/B baseline; default this checkout's `frontend/src`. | `e2e/admin-access/vite.config.mts` |
| `EKI_MAPS_ENV_FILE` | Environment file with a real Maps key for the opt-in live Maps replay. | `e2e/routing/live-maps/vite.config.mts` |
| `EKI_STRICT_PRODUCTION_BUILD` | Set to `true` by `npm run build:production`; turns on the required-variable and HTTPS checks. | `scripts/build-production.mjs`, `frontend/next.config.ts`, `scripts/verify-web-backend-contract.mjs` |
| `EKI_RUNTIME_SMOKE` | `1` makes `npm run verify:web-backend-contract` probe the live backend. | `scripts/verify-web-backend-contract.mjs` |
| `EKI_FRONTEND_ORIGIN` | Frontend origin used by that probe. | `scripts/verify-web-backend-contract.mjs` |
| `RTDB_EXPECTED_REGION` | Region that `npm run verify:rtdb-instance` requires. This command reads `FIREBASE_DATABASE_URL` and `NEXT_PUBLIC_FIREBASE_DATABASE_URL` from the shell only, not from `.env` files. | `scripts/rtdb-instance-config.mjs` |
| `FIREBASE_TOKEN` | Firebase CLI token for the App Check and Firestore index scripts. Secret. | `scripts/disable-appcheck-enforcement.mjs`, `scripts/verify-firestore-indexes.mjs` |
| `EKI_BENCHMARK_ADMIN_TOKEN` | Optional admin ID token that lets `npm run telemetry:load` read `/api/health`. Secret. | `scripts/benchmark-telemetry-ingestion.mjs` |
| `R19_BENCH_CASE`, `R19_BENCH_SAMPLES` | Case filter and repetition count (default `300`) for the route-matching benchmark. | `scripts/benchmark-route-matching.mjs` |
| `R31_DIST` | Backend build directory for the profiler; default `backend/dist`. | `scripts/profile-r31.mjs` |
| `EKI_DEVTOOLS` | `true` shows the Next.js development indicator. | `frontend/next.config.ts` |
| `CI`, `GITHUB_RUN_ID`, `GITHUB_STEP_SUMMARY` | Set by GitHub Actions; scripts use them for retries and job summaries. | `playwright.config.ts`, `scripts/qa/` |

## 7. CI and deployment secrets

`.github/workflows/deploy.yml` reads these names from the `staging` and `production` GitHub environments. No other workflow reads secrets or variables.

| Name | Kind | Used for |
|---|---|---|
| `FIREBASE_TOKEN` | Secret | Firebase CLI deploys, App Check enforcement check and Firestore index verification |
| `FIREBASE_DATABASE_URL` | Secret | RTDB instance that the deployed backend uses; compared with the frontend value by `npm run verify:rtdb-instance` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Secret | Strict production build |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Secret | Strict production build |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | Secret | Strict production build and RTDB preflight |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Secret | Strict production build |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Secret | Strict production build |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Secret | Strict production build |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Secret | Strict production build |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Secret | Strict production build |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | Secret | Strict production build |
| `NEXT_PUBLIC_BACKEND_URL` | Secret | Strict production build and live backend check |
| `RTDB_EXPECTED_REGION` | Variable | Optional region check in the RTDB preflight |
| `CLOUD_RUN_REGION` | Variable | Region of the Cloud Run service and of the Artifact Registry repository `eki`; read only by the manual `deploy-backend-staging` job |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Variable | Workload identity provider that the `deploy-backend-staging` job authenticates with |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | Variable | Service account that the `deploy-backend-staging` job impersonates |

The release flow is described in [CI, deployment and releases](operations/CI_CD_AND_RELEASES.md).

<a id="local-auth-setup"></a>
<a id="local-app-check-and-auth-setup"></a>

## 8. Local authentication setup

Eki signs users in with Google through Firebase Authentication. Firebase App Check is not used: the browser sends no App Check token, and the backend relies on Firebase ID tokens and trusted role claims.

1. In the Firebase console of the development project, enable the Google sign-in provider. `localhost` is an authorized domain by default; add any other host you open the app from.
2. Use the same Firebase project in `backend/.env` and `frontend/.env.local`. A token issued by one project is rejected by a backend configured for another.
3. If App Check enforcement was ever enabled for Firestore or RTDB in the project, disable it. Otherwise every browser read fails with a permission error. The Deploy workflow runs `node scripts/disable-appcheck-enforcement.mjs --project <project-id> --disable` with `FIREBASE_TOKEN`; without `--disable` the script only verifies. Changing code does not change a deployed project.
4. Roles come from custom claims that only the backend writes. A first sign-in creates a passenger profile. To make an account an administrator, set `role` to `admin` in its `users/<uid>` Firestore document, run `npm run sync-role-claims --workspace=backend`, then sign out and in again. Admin access needs `role: "admin"`, `admin: true` and a current `authorizationVersion`; editing the profile or Auth claims by hand grants nothing. See [privileged database authorization](security/PRIVILEGED_DATABASE_AUTHORIZATION.md).
5. Operators receive the `driver` role when an administrator saves them in **Fleet & People** with their Firebase Auth UID.

For a custom or secondary Hosting domain, set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to the frontend hostname, add the domain to Firebase Auth authorized domains, and add `https://<frontend-hostname>/__/auth/handler` to the OAuth client's authorized redirect URIs. Do not point the Auth domain at a tunnel that cannot serve Firebase's `/__/auth/` routes. See [DNS and domains](operations/DNS_AND_DOMAINS.md).

When sign-in or a protected view fails, check in this order: both apps use the same project, the account has the intended claims, the current `firestore.rules` and `database.rules.json` are deployed, and App Check enforcement is off. Never paste ID tokens into an issue.

## 9. Environment separation

| Concern | Local development | Staging | Production |
|---|---|---|---|
| Firebase project | Dedicated development project | Separate non-production project | Separate university-owned project |
| Backend credentials | Application Default Credentials or `FIREBASE_SERVICE_ACCOUNT` in `backend/.env` | Secret manager | Workload Identity or secret manager |
| `NODE_ENV` | `development` | `production` | `production` |
| `CORS_ORIGIN` | Local frontend origin | Exact staging origins | Exact approved origins |
| `RETENTION_SWEEPER_ENABLED` | `false` | `true` with an approved test schedule | `true` with approved retention periods |
| `NEXT_PUBLIC_SITE_INDEXING` | Not relevant | `false` | `true` |
| Firmware | `esp32dev` build | Signed `esp32dev-secure` build after acceptance | Signed, protected per-device artifact |

After a configuration change, confirm that each value belongs to the intended environment, restart the affected service, check `/health`, and sign in again. For a frontend release, run `npm run build:production`. For a device change, follow the post-flash checks in the [hardware guide](../hardware/README.md).

## 10. Fixed values

These values are source constants, not environment variables. Changing one is a code change with tests.

| Value | Constant | Source |
|---|---|---|
| Stop arrival corridor: 15 m | `STOP_ARRIVAL_GEOFENCE_M` | `backend/src/services/tripStateReducer.ts` |
| Origin departure radius: at most 50 m, shortened on a short first leg ([rule](design/TRACKING_ALGORITHMS.md#73-origin-departure)) | `ORIGIN_DEPARTURE_M`, `MIN_ORIGIN_DEPARTURE_M` | `backend/src/services/tripStateReducer.ts` |
| GNSS gap: more than 10 s without a fix | `GNSS_GAP_MS` | `backend/src/services/tripStateReducer.ts` |
| Endpoint radius for direction inference: 10 m | `ENDPOINT_GEOFENCE_M` | `backend/src/lib/automaticRideDirection.ts` |
| Passenger boarding radius: 150 m | `JOIN_RADIUS_M` | `backend/src/services/boardingPolicy.ts` |
| Maximum HDOP for automatic service: 4 | Inline check | `backend/src/services/automaticServiceAdmission.ts` |
| Worker lease: 45 s, renewed every 15 s | `LEASE_DURATION_MS`, `RENEW_INTERVAL_MS` | `backend/src/services/workerCoordinator.ts` |
| Worker clock skew allowance: 2 s | `WORKER_CLOCK_SKEW_MS` | `backend/src/lib/workerFence.ts` |
| Telemetry body limit: 512 bytes | Inline check | `backend/src/routes/devices.ts` |
| Passenger route schedules: at most 50 routes, 24-hour `HH:mm` stop times | `MAX_PASSENGER_ROUTES`, `STOP_TIME_PATTERN` | `backend/src/routes/settings.ts`, `frontend/src/lib/passengerRouteSchedule.ts` |
| Slow sign-in restoration notice: 8 s | `AUTH_RESTORE_SLOW_MS` | `frontend/src/hooks/useAuth.ts` |
| Navigation wait before the service worker serves cached HTML: 2.5 s | `NAVIGATION_NETWORK_BUDGET_MS` | `frontend/src/sw.js` |

The [tracking algorithms](design/TRACKING_ALGORITHMS.md) document explains the ride thresholds. Queue, deadline and cache bounds are documented in [telemetry deadlines](operations/TELEMETRY_DEADLINES.md), [work admission](operations/WORK_ADMISSION.md), [operation resources](api/OPERATION_RESOURCES.md), [reconciliation](operations/RECONCILIATION.md), [privacy deletion](operations/PRIVACY_DELETION.md), [route catalog](operations/ROUTE_CATALOG.md) and [worker leadership](operations/WORKER_LEADERSHIP.md).

## 11. References

[1] Google, "How Application Default Credentials works," cloud.google.com/docs/authentication/application-default-credentials. Accessed: 2026-10-30.

[2] OpenTelemetry, "Environment Variable Specification," opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/. Accessed: 2026-10-30.
