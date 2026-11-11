# Staging Runtime Configuration

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-029 | 1.6 | Current | 2026-11-11 |

## 1. Purpose

This reference lists the values that run the backend container (`backend/Dockerfile`) as the staging service on Cloud Run in the Firebase project `bustrack-be165`. That project holds test data only. The manual job `deploy-backend-staging` deploys the service from `deploy/cloud-run/staging.service.yaml` ([CI, deployment and releases](CI_CD_AND_RELEASES.md#52-steps)). Every variable has a full definition in the [configuration reference](../CONFIGURATION.md#3-backend-variables); this document lists only the values that staging sets and the decisions behind them. The backup Docker Hub image and the VPS Compose file ([VPS guide](../../deploy/vps/README.md)) are a separate path and do not change this service.

Never commit real values. Secrets belong in Secret Manager, not in an image, a manifest or a `NEXT_PUBLIC_*` variable.

## 2. Project facts

These values were read from the live project on 2026-10-31 and the Cloud Run service row on 2026-11-01. The RTDB, scaling, serving revision and invocation rows, the runtime service account roles in Section 4 and the secrets were read again on 2026-11-07.

| Item | Value | How it was read |
|---|---|---|
| Firebase project | `bustrack-be165` (project number `449313371438`, display name Eki-AhdUni) | `firebase projects:list` |
| RTDB instance | `bustrack-be165-asia-rtdb`, region `asia-southeast1` (Singapore). The backend and the Hosting build do not use the default instance `bustrack-be165-default-rtdb` (`us-central1`) | `firebase database:instances:list --json` |
| RTDB URL | `https://bustrack-be165-asia-rtdb.asia-southeast1.firebasedatabase.app` | same |
| Hosting origins | `https://bustrack-be165.web.app` and `https://bustrack-be165.firebaseapp.com` | `firebase hosting:sites:list`, Firebase default domains |
| Runtime service account | `eki-backend-runtime@bustrack-be165.iam.gserviceaccount.com` | `gcloud iam service-accounts list` |
| Cloud Run service | `eki-backend-staging`, region `asia-south2`, URL `https://eki-backend-staging-449313371438.asia-south2.run.app` | `deploy-backend-staging` run 41334365954, revision 00001 |
| Scaling | Revision `minScale` 0 and `maxScale` 1. The live service also carries a service-level maximum of 20 instances (`run.googleapis.com/maxScale`), which the manifest does not set; Cloud Run applies the lower of the service and revision maximums to each revision, so each revision runs at most one instance: one instance outside a deploy, and two while `deploy-backend-staging` gates a candidate revision beside the serving one ([worker leadership](WORKER_LEADERSHIP.md#34-single-instance-deployments)). The Cloud Scheduler jobs `eki-workers-up` (`0 6-21 * * *`, Asia/Kolkata) and `eki-workers-down` (`0 22 * * *`) set the service-level minimum instances to 1 and to 0 through the Cloud Run Admin API, so one instance is held from 06:00 to 22:00 IST. Both jobs are paused and the service has no minimum, so it runs in wake-on-traffic mode: the tracker is powered by the bus ignition, its first telemetry starts an instance, and the instance closes 15 to 17 minutes after the last request (measured on 2026-11-03). Resume the jobs only if a fixed window is wanted. | `deploy/cloud-run/staging.service.yaml`, `gcloud scheduler jobs list --location asia-south2`, `gcloud run services describe` |
| Serving revision | `eki-backend-staging-00009-7sh`, created on 2026-11-03 with `gcloud` from a user account, not by `deploy-backend-staging`. Its environment variables, including `WORKER_ENABLED=true`, equal those in the manifest on `main`. | `gcloud run services describe`, `gcloud run revisions list` |
| Ingress and invocation | Ingress `all`. `allUsers` holds `roles/run.invoker` on the service, so the backend's own authentication decides access. `deploy-backend-staging` grants that binding on every run. Without it, Cloud Run answers every public request with HTTP 403, so neither the Hosting app nor a tracker reaches the backend. | `gcloud run services describe`, `gcloud run services get-iam-policy`, `.github/workflows/deploy.yml` |

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
| `WORKER_ENABLED` | `true` | The serving revision `eki-backend-staging-00009-7sh` runs `true`, so the workers run while an instance is up and the instance takes the worker lease within about 5 s of starting (measured on 2026-11-03). The handoff was rehearsed on 2026-11-02 ([issue #374](https://github.com/notnamansinha/Eki/issues/374)). `false` keeps an instance out of leader election; it does not stop the HTTP server. Set `WORKER_ENABLED=false` before starting a local backend against this project to keep it out of the election ([worker leadership](WORKER_LEADERSHIP.md)). |
| `HTTPS_DEVICE_RATE_LIMIT_MODE` | `distributed` | `local` also requires `RATE_LIMIT_SHARD_FACTOR=1`. |
| `RATE_LIMIT_SHARD_FACTOR` | `1` with a maximum of one instance | Set it to the maximum instance count if that count grows. |
| `TRUST_PROXY` | Unset | Unset means one trusted hop in production. Section 7 describes the open question. |
| `OTEL_SDK_DISABLED` | `true` | The manifest sets no OTLP endpoint either. Tracing starts only when an endpoint is configured and this flag is not `true`. |
| `LOG_LEVEL` | `info` | The default threshold, set explicitly. |

Do not set `FIREBASE_SERVICE_ACCOUNT` or any `*_EMULATOR_HOST` variable in the cloud runtime. The `EKI_QA_*`, rules-test and tooling variables are for tests only.

### 3.1 Service settings

`deploy/cloud-run/staging.service.yaml` also sets these service and container values.

| Setting | Value | Notes |
|---|---|---|
| `run.googleapis.com/ingress` | `all` | Browsers and trackers call the service URL directly. |
| Revision `autoscaling.knative.dev/minScale` and `maxScale` | `0` and `1` | One instance at most, so `RATE_LIMIT_SHARD_FACTOR=1` holds. |
| Service `run.googleapis.com/minScale` | The live value | The deploy job copies the current service-level minimum into the manifest, so a deploy does not override the value that Cloud Scheduler sets. |
| Revision label `eki-source-sha` | The commit the image was built from | Lets the release evidence map the serving revision to its source ([CI, deployment and releases](CI_CD_AND_RELEASES.md#11-release-evidence)). The same commit is baked into the image as `EKI_SOURCE_SHA`. |
| `run.googleapis.com/cpu-throttling` | `false` | The process runs worker and probe timers outside requests. |
| `run.googleapis.com/startup-cpu-boost` | `true` | Shortens the cold start. |
| `containerConcurrency` | `80` | Requests per instance. |
| `timeoutSeconds` | `60` | Request timeout. |
| CPU and memory limits | `1` CPU, `512Mi` | Container resources. |
| Container port | `8080` | The image sets `PORT=8080`; Cloud Run sets the same value. |
| Startup probe | `GET /live` every 2 s, 2 s timeout, 15 failures allowed | An instance that does not answer within about 30 s fails to start. |
| Liveness probe | `GET /live` every 30 s, 3 s timeout, 3 failures allowed | Restarts an instance whose process stops answering. |
| `GOOGLE_MAPS_API_KEY` secret version | `1` | An explicit version, never `latest`. A new key version needs a manifest change. |

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

Production forces `RETENTION_SWEEPER_ENABLED=true`, and the sweeper deletes data on its first run. The sweeper runs only in the worker leader, and each process that takes the lease runs a full sweep at once and then every 24 hours (`backend/src/services/retentionSweeper.ts`). On staging it first ran during the handoff rehearsal of 2026-11-02 and deleted nothing ([issue #374](https://github.com/notnamansinha/Eki/issues/374)). Read [RTDB retention](RTDB_RETENTION.md) before the first deployment, then run the inventory described in [Section 5.1 of that document](RTDB_RETENTION.md#51-inventory-with-a-dry-run) against the staging project. The inventory covers the documented RTDB scope only. It is not a Firestore dry run.

Take a Firestore and RTDB backup before the sweeper first runs against data that must survive. Staging keeps its backups in the private bucket `gs://bustrack-be165-eki-backups` (`asia-south2`), which deletes objects after 30 days, and has a daily managed Firestore backup with 7-day retention ([issue #374](https://github.com/notnamansinha/Eki/issues/374)).

## 6. Maps keys

Staging uses two separate keys:

| Key | Used by | Restriction |
|---|---|---|
| `eki-backend-maps-server` | Backend, through `GOOGLE_MAPS_API_KEY` | API restriction to Routes API and Places API (New). No application restriction, because Cloud Run outgoing addresses are not fixed. |
| Browser key (project `bustrack-501917`) | Frontend, through `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | HTTP referrers `https://bustrack-be165.web.app/*`, `https://bustrack-be165.firebaseapp.com/*`, `http://localhost:3000/*` and `http://localhost:3001/*`; API restriction to the Maps JavaScript API only. |

A local `backend/.env` also uses the server key, not the browser key.

The backend calls `routes.googleapis.com/directions/v2:computeRoutes` and `places.googleapis.com/v1/places:searchText`. Both APIs are enabled in the project.

## 7. Client IP

Pre-authentication rate limits key on `req.ip` (`backend/src/lib/rateLimitIdentity.ts`). With `TRUST_PROXY` unset, the backend trusts one proxy hop in production. Clients call the service origin directly. On a Hosting preview channel with rewrites to this service, the backend saw a Google egress pool instead of the caller, which would collapse the per-IP limits, including `HTTPS_INGRESS_DEVICES_PER_IP`, into shared buckets; the rewrites were not adopted ([issue #372](https://github.com/notnamansinha/Eki/issues/372)). On the direct origin, 1,150 requests with forged `X-Forwarded-For` headers received 1,000 responses of 401 and 150 of 429 on 2026-11-02 (same issue), so a forged header did not open a new rate-limit bucket.

Measure again before changing `TRUST_PROXY` or putting a proxy in front of the service: send requests through the new path and through the direct service URL, compare the `req.ip` that the backend sees, and send forged `X-Forwarded-For` headers. The setting accepts `false`, `loopback` or a hop count from 0 to 10. It rejects `true` on purpose, because that would let a caller choose its own rate-limit key.

## 8. Verification

After deployment, `GET /live` returns 200. `GET /health` returns 503 until the first Firestore and RTDB probes both succeed. The probes run concurrently with a 5 s timeout each and repeat every 30 s, so the first 200 can take more than one cycle. `/health` returns 503 again when a later probe fails or no probe has succeeded in the last 65 s. A startup refusal in the logs names the variable that failed.

Whenever the service has no minimum instance, the first request after an idle period starts an instance. On 2026-11-03 a cold start took about 4.5 s until the container was ready, and a client with the tracker's 1.5 s request timeout and 1 s retry got its first real answer about 5.7 s after the first request; its first two attempts timed out. On 2026-11-01 a cold instance answered `/health` with 503 for about 2 s. Before it promotes a new revision, `deploy-backend-staging` polls the candidate's `/health` for up to 180 s until it reports `status: ok`. When a Deploy dispatch also deploys the backend, the release check then retries `/health` for up to 90 s while it answers 502, 503 or 504; a staging release that deploys only the frontend does not probe the backend ([CI, deployment and releases](CI_CD_AND_RELEASES.md#52-steps)).

## 9. References

- [Configuration reference](../CONFIGURATION.md)
- [RTDB retention](RTDB_RETENTION.md)
- [Worker leadership and fencing](WORKER_LEADERSHIP.md)
