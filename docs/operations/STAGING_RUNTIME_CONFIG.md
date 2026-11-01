# Staging Runtime Configuration

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-029 | 1.0 | Proposed | 2026-11-01 |

## 1. Purpose

This reference lists the values that run the backend container (`backend/Dockerfile`) as the staging service on Cloud Run in the Firebase project `bustrack-be165`. That project holds test data only. The document becomes Current when the staging service is deployed with these values. Every variable has a full definition in the [configuration reference](../CONFIGURATION.md#3-backend-variables); this document lists only the values that staging sets and the decisions behind them.

Never commit real values. Secrets belong in Secret Manager, not in an image, a manifest or a `NEXT_PUBLIC_*` variable.

## 2. Project facts

These values were read from the live project on 2026-10-31.

| Item | Value | How it was read |
|---|---|---|
| Firebase project | `bustrack-be165` (project number `449313371438`, display name Eki-AhdUni) | `firebase projects:list` |
| RTDB instance | `bustrack-be165-default-rtdb`, region `us-central1`, the only instance | `firebase database:instances:list --json` |
| RTDB URL | `https://bustrack-be165-default-rtdb.firebaseio.com` | same |
| Hosting origins | `https://bustrack-be165.web.app` and `https://bustrack-be165.firebaseapp.com` | `firebase hosting:sites:list`, Firebase default domains |
| Runtime service account | `eki-backend-runtime@bustrack-be165.iam.gserviceaccount.com` | `gcloud iam service-accounts list` |

`FIREBASE_DATABASE_URL` shall equal the frontend's `NEXT_PUBLIC_FIREBASE_DATABASE_URL`. A mismatch produces empty data or invalid identities instead of an error.

## 3. Values

| Variable | Staging value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables the fail-closed startup checks and the one-hop `trust proxy` default. |
| `PORT` | Set by Cloud Run | The image defaults to `8080`. |
| `CORS_ORIGIN` | The two Hosting origins, comma-separated | Required: an empty list refuses startup. Use frontend origins, not the backend URL. |
| `FIREBASE_DATABASE_URL` | The RTDB URL in Section 2 | Required in production. |
| `GOOGLE_MAPS_API_KEY` | Secret `google-maps-server-key` | Server key, separate from the browser key. Section 6 describes the key. |
| `RETENTION_SWEEPER_ENABLED` | `true` | Production refuses any other value, so the `.env.example` default of `false` fails startup. Read Section 5 first. |
| `LEGACY_RTDB_RETIRED` | `false` | Keep `false` until every legacy consumer is retired. |
| `RIDE_SESSION_RETENTION_DAYS`, `FEEDBACK_RETENTION_DAYS`, `COMPLETED_TRIP_RETENTION_DAYS` | `180` | The `.env.example` values. Deletion starts as soon as the sweeper runs. |
| `OPERATION_LOG_RETENTION_DAYS` | `90` | The `.env.example` value. |
| `WORKER_ENABLED` | `false` for the first deployment, `true` after the worker handoff | `false` keeps the instance out of leader election. It does not stop the HTTP server. |
| `HTTPS_DEVICE_RATE_LIMIT_MODE` | `distributed` | `local` also requires `RATE_LIMIT_SHARD_FACTOR=1`. |
| `RATE_LIMIT_SHARD_FACTOR` | `1` with a maximum of one instance | Set it to the maximum instance count if that count grows. |
| `TRUST_PROXY` | Unset | Unset means one trusted hop in production. Section 7 describes the open question. |
| `OTEL_SDK_DISABLED` | `true`, or leave the OTLP variables unset | Tracing starts only when an OTLP endpoint is configured. |

Do not set `FIREBASE_SERVICE_ACCOUNT` or any `*_EMULATOR_HOST` variable in the cloud runtime. The `EKI_QA_*`, rules-test and tooling variables are for tests only.

## 4. Credentials and secrets

Cloud Run attaches the runtime service account, and the backend falls back to Application Default Credentials. The account holds these project roles:

| Role | Reason |
|---|---|
| `roles/datastore.user` | Firestore reads and writes |
| `roles/firebasedatabase.admin` | RTDB reads, writes and transactions |
| `roles/firebaseauth.admin` | `getUser`, `setCustomUserClaims`, `revokeRefreshTokens` and `deleteUser` |
| `roles/logging.logWriter` | Log entries |

Each secret grants `roles/secretmanager.secretAccessor` to the runtime account individually, not project-wide.

| Secret | Variable | Required |
|---|---|---|
| `google-maps-server-key` | `GOOGLE_MAPS_API_KEY` | Needed for place search and route polylines. Without it the backend starts, and both endpoints return 503 (`PLACES_NOT_CONFIGURED`, `ROUTING_NOT_CONFIGURED`). With the key set, a polyline 502 (`ROUTING_UPSTREAM_FAILURE`) or 503 (`ROUTING_RATE_LIMITED`) comes from the Routes API, not from a missing secret. |
| `otlp-exporter-headers` | `OTEL_EXPORTER_OTLP_HEADERS` | Optional. Do not mount it until it has a version: Cloud Run rejects a secret with no version. |

## 5. Retention before enabling the sweeper

Production forces `RETENTION_SWEEPER_ENABLED=true`, and the sweeper deletes data on its first run. The sweeper runs only in the worker leader, so it first runs when `WORKER_ENABLED` becomes `true` (Section 3). Read [RTDB retention](RTDB_RETENTION.md) before the first deployment, then run the inventory described in [Section 5.1 of that document](RTDB_RETENTION.md#51-inventory-with-a-dry-run) against the staging project. The inventory covers the documented RTDB scope only. It is not a Firestore dry run.

Take a Firestore and RTDB backup before the sweeper first runs against data that must survive.

## 6. Maps keys

Staging uses two separate keys:

| Key | Used by | Restriction |
|---|---|---|
| `eki-backend-maps-server` | Backend, through `GOOGLE_MAPS_API_KEY` | API restriction to Routes API and Places API (New). No application restriction, because Cloud Run outgoing addresses are not fixed. |
| Browser key | Frontend, through `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Restrict it to the Hosting origins. |

The backend calls `routes.googleapis.com/directions/v2:computeRoutes` and `places.googleapis.com/v1/places:searchText`. Both APIs are enabled in the project.

## 7. Client IP behind Hosting

Pre-authentication rate limits key on `req.ip` (`backend/src/lib/rateLimitIdentity.ts`). With `TRUST_PROXY` unset, the backend trusts one proxy hop in production. A request through Firebase Hosting to Cloud Run can cross more than one hop, so `req.ip` might resolve to a shared address and collapse the per-IP limits, including `HTTPS_INGRESS_DEVICES_PER_IP`, into one bucket.

The correct hop count has not been measured. On the deployed staging service, send requests through the Hosting path and through the direct service URL, compare the `req.ip` that the backend sees, and send forged `X-Forwarded-For` headers, before changing `TRUST_PROXY`. The setting accepts `false`, `loopback` or a hop count from 0 to 10. It rejects `true` on purpose, because that would let a caller choose its own rate-limit key.

## 8. Verification

After deployment, `GET /live` returns 200. `GET /health` returns 503 until the first Firestore and RTDB probes both succeed. The probes run concurrently with a 5 s timeout each and repeat every 30 s, so the first 200 can take more than one cycle. `/health` returns 503 again when a later probe fails or no probe has succeeded in the last 65 s. A startup refusal in the logs names the variable that failed.

## 9. References

- [Configuration reference](../CONFIGURATION.md)
- [RTDB retention](RTDB_RETENTION.md)
- [Worker leadership and fencing](WORKER_LEADERSHIP.md)
