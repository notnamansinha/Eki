# Staging backend runtime configuration

Last verified: 2026-10-24 against `testing` at `6b2d8e4`. Tracks issue #370 of the
[ngrok removal and managed backend migration](NGROK_REMOVAL_AND_FIREBASE_BACKEND_MIGRATION.md).

This is the environment contract for running the backend container
(`backend/Dockerfile`) as **staging** on `bustrack-be165`, which holds test data
only. It is host-independent: the same variables apply to Cloud Run or a VPS. The
credential row is the only host-specific one. Never commit real values; secrets
belong in the host's secret store, not in an image or a `NEXT_PUBLIC_*` variable.

## Verified facts

| Item | Value | Source |
|---|---|---|
| Firebase project | `bustrack-be165` (number `449313371438`, display name Eki-AhdUni) | `firebase projects:list` |
| RTDB instance | `bustrack-be165-default-rtdb`, `us-central1`, only instance | `firebase database:instances:list --json` |
| RTDB URL | `https://bustrack-be165-default-rtdb.firebaseio.com` | same |
| Hosting origins | `https://bustrack-be165.web.app`, `https://bustrack-be165.firebaseapp.com` | Firebase default domains |

`FIREBASE_DATABASE_URL` must equal the frontend's `NEXT_PUBLIC_FIREBASE_DATABASE_URL`;
a mismatch gives empty data or invalid identities rather than an error.

## Variables

Startup fails closed in production when a required value is missing or malformed.

| Variable | Staging value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables the fail-closed checks below and `trust proxy`. |
| `PORT` | host-provided | Cloud Run injects it; the image defaults to `8080`. |
| `CORS_ORIGIN` | the two Hosting origins, comma-separated | **Required**; empty list refuses startup. Frontend origins, not the backend URL. Localhost is only added outside production. |
| `FIREBASE_DATABASE_URL` | the RTDB URL above | **Required** in production (`backend/src/lib/firebaseAdmin.ts`). |
| `GOOGLE_MAPS_API_KEY` | secret | Server-side key for Routes and Places. Separate from the browser key. A missing key does not block startup; Places returns 503 and the route-polyline endpoint returns 502/503. |
| `RETENTION_SWEEPER_ENABLED` | `true` after a dry run | **Production refuses `false`** (`retentionSweeper.ts`). Shipping `.env.example` unchanged therefore fails startup. |
| `LEGACY_RTDB_RETIRED` | `false` | Keep false until every legacy consumer is retired. |
| `RIDE_SESSION_RETENTION_DAYS`, `FEEDBACK_RETENTION_DAYS`, `COMPLETED_TRIP_RETENTION_DAYS` | `180` | Deletions begin as soon as the sweeper is active. |
| `OPERATION_LOG_RETENTION_DAYS` | `90` | Same. |
| `WORKER_ENABLED` | `false` for smoke tests, `true` after handoff | Disables only the coordinator, not the HTTP server or route watcher. |
| `WORKER_INSTANCE_ID` | revision or host name | Optional label in the lease owner id; helps identify the leader. |
| `HTTPS_DEVICE_RATE_LIMIT_MODE` | `distributed` | `local` additionally requires `RATE_LIMIT_SHARD_FACTOR=1` or startup fails. |
| `HTTPS_DEVICE_RATE_PER_MINUTE` | `90` | Default; `HTTPS_DEVICE_RATE_LIMIT_LEASE_SIZE` default `5` is capped at the limit. |
| `RATE_LIMIT_SHARD_FACTOR` | max expected instances | Defaults to 1 when unset; malformed values block startup. Divides each in-memory limiter budget by N. With `max-instances` = 1 keep it at `1`. |
| `HTTPS_INGRESS_DEVICES_PER_IP` | `100` | Per-IP device cap; see the proxy risk below. |
| `BUS_STALE_MS`, `AUTOMATIC_TURNAROUND_DWELL_MS`, `TERMINAL_ARRIVAL_CONFIRMATION_MS`, `LIVE_DEPARTURE_ROUTES_ENABLED`, `ABANDONED_RIDE_THRESHOLD_HOURS`, `AUTH_REVOCATION_CACHE_MS`, `AUTH_MAX_PENDING_VERIFICATIONS` | as in `.env.example` | Behavioural tuning; keep defaults for staging. |
| `LOG_LEVEL` | `info` | |
| `OTEL_*` | leave unset, or `OTEL_SDK_DISABLED=true` | Tracing starts only when an OTLP endpoint is configured (`instrumentation.ts`). Do not point it at localhost. |
| Credentials | see below | |

### Credentials

- **Cloud Run:** attach a runtime service account and set nothing. The backend falls back to
  Application Default Credentials (`applicationDefault()`).
- **VPS or other host:** set `FIREBASE_SERVICE_ACCOUNT` to the service-account JSON (secret).
  It must parse as a JSON object or startup fails.

Do not set any `*_EMULATOR_HOST` variable in a cloud runtime.

### Variables the code reads that `.env.example` does not list

`FIREBASE_SERVICE_ACCOUNT`, `WORKER_INSTANCE_ID`, and the OTA release variables
`FIRMWARE_RELEASE_URL`, `FIRMWARE_RELEASE_VERSION`, `FIRMWARE_RELEASE_SEQUENCE`,
`FIRMWARE_RELEASE_SHA256`, `FIRMWARE_RELEASE_SIZE`, `FIRMWARE_RELEASE_ALLOWED_ORIGIN`.
The OTA variables are needed only to serve firmware updates. The `EKI_QA_*`, `FIRESTORE_RULES_PATH`,
`FIREBASE_RULES_TEST`, `EKI_STRICT_PRODUCTION_BUILD`, `RTDB_LATENCY_SAMPLES` and emulator-host
variables are test or tooling only and must not be set in staging.

## Retention before enabling the sweeper

Because production forces `RETENTION_SWEEPER_ENABLED=true`, review
[RTDB_RETENTION.md](RTDB_RETENTION.md) first. `npm run retention:rtdb -- --dry-run`
inventories only the documented RTDB scope; it is not a Firestore dry run. Staging holds test
data only, so enabling it is low risk, but take a Firestore and RTDB backup first (issue #374).

## Known risk: client IP behind Hosting

`backend/src/server.ts:82` sets `trust proxy` to `1`, and rate limits key on `req.ip`
(`backend/src/lib/rateLimitIdentity.ts`). Behind Firebase Hosting in front of Cloud Run there
is more than one proxy hop, so `req.ip` may resolve to a Hosting address shared by all clients,
which would collapse per-IP limits (including `HTTPS_INGRESS_DEVICES_PER_IP`) into one bucket.
This is not yet tested. Verify on a deployed staging service through the real Hosting path and
with a direct service URL (issues #373 and #377), and test spoofed `X-Forwarded-For` headers
before changing the value.

## Maps keys

Use one browser key (referrer-restricted) and one server key. Enable the APIs the backend
actually calls (Routes and Places New). An IP-restricted server key must match the address
Google sees from the host. A workstation allowlist does not carry over to a cloud runtime.
