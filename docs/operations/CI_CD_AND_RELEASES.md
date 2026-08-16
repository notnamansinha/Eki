# CI, deployment, and release guide

This document explains what the repository automation verifies, what it deploys,
and which production actions still belong to the university operations team.
It contains names and placeholders only; environment secrets and project IDs
belong in GitHub environment settings or the university secret manager.

## Verification workflow

`.github/workflows/ci.yml` runs on every push and pull request as the
`Production verification` workflow. It uses Node.js 24, Java 21 for Firebase
emulators, Python 3.12 for PlatformIO, and a Linux runner.

The workflow performs:

1. `npm ci` with the committed lockfile.
2. Frontend and backend linting.
3. Root script tests plus backend and frontend Vitest suites.
4. Firebase Firestore/RTDB rules integration through the emulator. The test
   helper writes isolated temporary copies; committed rules are never modified.
   App Check is enforced separately in Firebase Console for deployed projects.
5. Strict frontend production build with CI-only placeholder public values,
   service-worker generation, and deterministic CSP regeneration.
6. Production dependency audit.
7. Backend Docker image build and smoke boot. A degraded `503 /health` is
   expected with placeholder Firebase configuration and proves the container
   starts and exposes the load-balancer contract.
8. Native firmware tests, development ESP32 compilation, and a secure firmware
   compilation using an ephemeral CI-only signing key. CI must never produce a
   fleet artifact or handle the university production key.

The workflow proves source/build consistency. It does not prove GNSS reception,
vehicle power, radio coverage, TLS against the production certificate chain,
secure eFuse provisioning, route geometry in the field, or safe driver
operation.

## Deployment workflow

`.github/workflows/deploy.yml` has two paths:

| Path | Trigger | Deploys | Gate |
|---|---|---|---|
| Staging | Successful verification from a push to `main`, or manual staging dispatch from `main` | Firebase Hosting, Firestore rules and RTDB rules for the approved staging project | Exact verified commit SHA for `workflow_run` (manual dispatch deploys the selected `main` ref directly); staging environment secrets |
| Production | Manual dispatch from `main` with `production` selected | Firebase Hosting, Firestore rules and RTDB rules for the separately approved production project | Protected GitHub environment/reviewer approval, current `main` ref at dispatch time, and production secrets |

The workflow does not deploy the Express backend container, configure DNS/TLS,
create a WAF, provision Firebase data, flash devices, or change fleet
assignments. Those actions must be performed and evidenced separately.

## Required environment secrets

Each GitHub environment needs its own values. Store values in GitHub encrypted
environment secrets or the approved secret manager; never put them in YAML,
Markdown, logs or screenshots.

### Deployment token

- `FIREBASE_TOKEN`: Firebase CLI token for that exact environment/project.

### Frontend build values

The deployment workflow passes these `NEXT_PUBLIC_*` values to the strict build:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `NEXT_PUBLIC_GOOGLE_MAP_ID`
- `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY`
- `NEXT_PUBLIC_BACKEND_URL`

Browser values are public identifiers after bundling, but Firebase/Maps keys
must still be restricted by hostname, project and API. The backend URL must be
HTTPS and origin-only outside local development.

### Backend runtime values

Backend `.env` values are not supplied by the Firebase Hosting deploy. Configure
them in the managed container/runtime using [CONFIGURATION.md](../CONFIGURATION.md),
prefer Workload Identity/ADC, and keep `FIREBASE_SERVICE_ACCOUNT` out of the
repository. Production must set exact `CORS_ORIGIN`, `FIREBASE_DATABASE_URL`,
server Maps configuration, worker settings, rate-limit shard factor and
approved retention values.

## Release sequence

1. Update code, rules, firmware, configuration templates and all affected docs.
2. Run `npm run verify` locally. Run `npm run test:rules` when the emulator
   prerequisites are available, and run the relevant PlatformIO tests/builds.
3. Open a pull request and wait for every CI job to pass.
4. Review the generated service worker and CSP changes when frontend behavior or
   allowed origins change.
5. Let the verified `main` commit deploy to staging. Check Hosting headers,
   Auth/App Check, rules, `/health`, backend logs, telemetry, and a test route.
6. Run the staged browser slow-network/offline and physical hardware acceptance
   matrix. Do not call CI success a field pass.
7. Dispatch production only after the protected environment approval, privacy/
   retention approval, backups/restore readiness, monitoring, DNS/TLS, WAF and
   rollback plan are confirmed.
8. Deploy or roll the backend runtime separately, then verify the exact frontend
   backend origin, device telemetry, worker lease and health alerts.

## Rollback and incident response

- Hosting/rules: redeploy the last known-good verified commit to the affected
  Firebase project, then recheck rules and headers.
- Backend: roll the managed runtime to the last known-good image; keep the
  worker lease and session IDs under observation during recovery.
- Frontend configuration: rebuild with the previous environment values; do not
  edit generated CSP hashes by hand.
- Device credential or CA failure: disable/rotate the registry credential,
  prepare a corrected device-specific protected image, and reflash under the
  witnessed hardware procedure. Never place a replacement secret in an issue
  or deployment log.
- Data/privacy incident: follow the university incident owner and preserve
  approved evidence; do not run destructive retention or deletion commands as a
  first response.

## Release evidence

Archive the commit SHA, CI run, deployment environment (not its secrets),
frontend/backend image identifiers, rules/index version, health output,
telemetry latency and rejection metrics, firmware artifact hash, physical
acceptance results, approver, rollback target, and known risks. Redact tokens,
private keys, device/Wi-Fi credentials, personal records and internal addresses.
