# Running the Backend on a VPS (Backup Path)

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-030 | 1.1 | Current | 2026-11-07 |

## 1. Purpose

Cloud Run in `asia-south2` is the primary staging host. This is the fallback
if the backend must move. Only the backend runs here; the frontend stays on
Firebase Hosting. The workflow and its checks are described in
[CI, deployment and releases](../../operations/CI_CD_AND_RELEASES.md#73-backup-image-on-docker-hub-publish-backend-imageyml).

## 2. One-time setup (repository owner)

1. Create a Docker Hub access token (Account settings, Security).
2. Add repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.
3. Optionally make the Docker Hub repository `eki-backend` private. The server
   then needs `docker login` with a read token before it can pull.

Until both secrets exist, the "Publish backend image" workflow stops after its
credential check and pushes nothing. After that, every green push to `main`
publishes `<user>/eki-backend:<commit-sha>` and moves `:latest` to it while that
commit is still the head of `main`, so a run that finishes late never moves
`:latest` back. Before the push, Trivy scans the image with the same policy as
CI, and a fixed `CRITICAL` or `HIGH` finding stops the run. Run the workflow
manually from `main` to publish the head of `main` on demand. It never publishes
a pull request, a fork or a commit that `main` does not contain, and only the
credential check and the push step receive the Docker Hub secrets; the build and
the scan do not.

## 3. On the server

```sh
mkdir eki && cd eki
# copy docker-compose.yml here, then:
cp <repo>/backend/.env.example backend.env   # then edit the values
export EKI_BACKEND_IMAGE=<user>/eki-backend:<commit-sha>
docker compose pull && docker compose up -d
curl -s http://127.0.0.1:8080/live
```

Expected: `{"status":"alive"}`. `curl -s http://127.0.0.1:8080/health` returns
`"status":"ok"` while the latest Firestore and RTDB probes succeed, and
`"status":"degraded"` with HTTP 503 otherwise, including until the first probes
finish.

Compose refuses to start while `EKI_BACKEND_IMAGE` is unset. It pulls the image
on every `up` (`pull_policy: always`), restarts the container unless it was
stopped, and publishes port `8080` on `127.0.0.1` only, so a TLS reverse proxy
(Caddy or nginx) on the same host must sit in front of it.

## 4. Things to set in `backend.env`

- `NODE_ENV=production`, `CORS_ORIGIN` (your Firebase Hosting origins),
  `FIREBASE_DATABASE_URL`, `GOOGLE_MAPS_API_KEY`, `RETENTION_SWEEPER_ENABLED=true`.
  Production startup refuses to run without `CORS_ORIGIN`,
  `FIREBASE_DATABASE_URL` and `RETENTION_SWEEPER_ENABLED=true`. The values that
  the Cloud Run service uses are listed in the
  [staging runtime configuration](../../operations/STAGING_RUNTIME_CONFIG.md).
- Firebase credentials: Cloud Run supplies them automatically; a VPS does not.
  Set `FIREBASE_SERVICE_ACCOUNT` to the service-account JSON (see
  `backend/.env.example`) and keep the file readable by root only.
- `TRUST_PROXY`: with `NODE_ENV=production` the backend trusts one proxy hop when
  it is unset, which fits one reverse proxy in front of the container and lets
  rate limits see the client IP. `TRUST_PROXY=1` states the same explicitly.
- `WORKER_ENABLED`: `true` by default. See the worker note in Section 5.

## 5. Before pointing the frontend at it

- Serve it over HTTPS on a domain. The strict production build accepts only a
  non-local HTTPS backend URL, and browsers block HTTP calls from the HTTPS site.
  Set the `staging` environment secret `NEXT_PUBLIC_BACKEND_URL` to that origin;
  the next Deploy build adds it to the CSP `connect-src`.
- Give the VPS its own Google Maps server key, restricted to the VPS IP address
  and to the Routes API and Places API (New), so the restriction does not affect
  the Cloud Run service.
- Trackers post to the backend origin compiled into their firmware. Reflash them
  with the VPS origin and its root CA before they use it
  ([hardware guide](../../hardware/README.md)).
- Do not run Cloud Run and the VPS as workers at the same time unless that is
  intended. Both share one Firestore worker lease, and only the holder runs the
  workers ([worker leadership](../../operations/WORKER_LEADERSHIP.md)); set
  `WORKER_ENABLED=false` on the host that should not compete.

## 6. Rollback

Roll back by setting `EKI_BACKEND_IMAGE` to an earlier commit tag and running
`docker compose up -d` again.
