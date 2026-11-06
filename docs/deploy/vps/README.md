# Running the backend on a VPS (backup path)

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-030 | 1.0 | Current | 2026-11-06 |

Cloud Run in `asia-south2` stays the primary staging host. This is the fallback
if it must move. Only the backend runs here; the frontend stays on Firebase Hosting.

## One-time setup (repository owner)

1. Create a Docker Hub access token (Account settings, Security).
2. Add repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.
3. Optionally make the Docker Hub repository `eki-backend` private.

Until the secrets exist, the "Publish backend image" workflow skips itself. After
that, every green push to `main` publishes `<user>/eki-backend:<commit-sha>` and
`:latest`. Run the workflow manually from `main` to publish on demand. It never
publishes a pull request, a fork or a commit that `main` does not contain, and
only the login and push steps can read the Docker Hub secrets.

## On the server

```sh
mkdir eki && cd eki
# copy docker-compose.yml here, then:
cp <repo>/backend/.env.example backend.env   # then edit the values
export EKI_BACKEND_IMAGE=<user>/eki-backend:<commit-sha>
docker compose pull && docker compose up -d
curl -s http://127.0.0.1:8080/live
```

## Things to set in `backend.env`

- `NODE_ENV=production`, `CORS_ORIGIN` (your Firebase Hosting origins),
  `FIREBASE_DATABASE_URL`, `GOOGLE_MAPS_API_KEY`, `RETENTION_SWEEPER_ENABLED=true`.
- Firebase credentials: Cloud Run supplies them automatically; a VPS does not.
  Use `FIREBASE_SERVICE_ACCOUNT` (see `backend/.env.example`) and keep the file
  readable by root only.
- `TRUST_PROXY=1` when running behind one reverse proxy, so rate limits see the
  client IP.

## Before pointing the frontend at it

- Serve it over HTTPS on a domain (PWA install and browsers require it) and set
  `NEXT_PUBLIC_BACKEND_URL` in the Hosting build to that origin.
- Restrict the Google Maps server key to the VPS IP address.
- Do not run Cloud Run and the VPS as workers at the same time unless that is
  intended; workers coordinate through a Firestore lease.

Roll back by setting `EKI_BACKEND_IMAGE` to an earlier commit tag and running
`docker compose up -d` again.
