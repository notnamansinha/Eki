# Environment and configuration reference

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
| `FIREBASE_SERVICE_ACCOUNT` | Conditional | Server-side Firebase Admin JSON | Prefer Workload Identity/ADC or Secret Manager; never commit or log it |
| `FIREBASE_DATABASE_URL` | Yes for RTDB | Firebase RTDB URL | Use the environment’s URL; no code fallback exists |
| `GOOGLE_MAPS_API_KEY` | Route/places features | Server-side Routes/Places key | Restrict by runtime identity/IP and enabled APIs; keep it different from the browser key |
| `BUS_STALE_MS` | No | Live bus staleness threshold; minimum `90000`, default `300000` | Align the alert/runbook threshold with the deployed value |
| `HTTPS_DEVICE_RATE_PER_MINUTE` | No | Durable accepted device requests per device per minute; default `30` | Add an edge/WAF limit; do not rely on process memory alone |
| `RATE_LIMIT_SHARD_FACTOR` | No | Expected backend replica count used to divide in-process budgets; default `1` | Set to the deployed replica count; values above the smallest in-process budget are rejected |
| `AUTH_REVOCATION_CACHE_MS` | No | Short cache for Firebase Auth revocation checks; `0` disables it, maximum `60000` | Keep short; use `0` only for troubleshooting |
| `WORKER_ENABLED` | No | Enables the Firestore-lease background worker; default `true` | Keep enabled for lifecycle recovery, abandonment and retention jobs |
| `WORKER_INSTANCE_ID` | No | Stable diagnostic identity for a runtime instance | Do not use credentials or personal data |
| `ABANDONED_RIDE_THRESHOLD_HOURS` | No | Age before conservative abandoned-ride reconciliation; minimum `1`, default `12` | Obtain privacy/operations approval before changing it |
| `RETENTION_SWEEPER_ENABLED` | No | Exact opt-in switch for destructive retention cleanup; default `false` | Enable only after documented privacy/legal approval |
| `RIDE_SESSION_RETENTION_DAYS` | No | Terminal ride-session retention period | Must match the approved retention schedule |
| `FEEDBACK_RETENTION_DAYS` | No | Feedback retention period | Must match privacy approval |
| `COMPLETED_TRIP_RETENTION_DAYS` | No | Completed-trip projection retention period | Must match reporting requirements and approval |
| `OPERATION_LOG_RETENTION_DAYS` | No | Operational log retention period | Avoid putting secrets or personal data in logs |

The exact defaults and comments are maintained in [`backend/.env.example`](../backend/.env.example).
Configuration is loaded before Firebase initialization; changing it requires a
backend restart.

## Frontend variables

Store these in the ignored `frontend/.env.local` file for local use or inject
them into the frontend build environment. `NEXT_PUBLIC_*` values are bundled
into the browser and should be treated as public identifiers.

| Variable | Required | Meaning | Safe guidance |
|---|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes | Browser Firebase API identifier | Restrict by host and Firebase APIs; it is not a service-account secret |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | Firebase Auth domain | Use the matching environment |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | Yes | Browser RTDB URL | Use the matching environment |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes | Firebase project identifier | Do not mix staging and production projects |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | Firebase Storage bucket identifier | Use the matching environment |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes | Firebase messaging identifier | Use the matching environment |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Yes | Firebase web app identifier | Use the matching environment |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | Optional | Analytics measurement identifier | Enable only if analytics/privacy approval exists |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Maps UI | Browser Maps JavaScript key | Restrict by approved hostnames and Maps APIs |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | Maps UI | Cloud map style identifier | Use the matching environment |
| `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` | Production/App Check | Firebase App Check browser site key | Use the matching environment; enforcement is configured in Firebase |
| `NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN` | Local demo only | Registered App Check debug token | Keep commented out in production and never commit it |
| `NEXT_PUBLIC_BACKEND_URL` | Yes | HTTPS backend origin used by REST mutations | Use an origin only—no `/api` suffix, path or query string |
| `NEXT_PUBLIC_SERVICE_TIME_ZONE` | Optional | Display timezone; default template is `Asia/Kolkata` | Use an IANA timezone name |
| `NEXT_PUBLIC_PASSENGER_BUS_START_TIME` | Optional | Passenger display default for service start | This is presentation configuration, not a dispatch rule |
| `NEXT_PUBLIC_BUS_EXPIRY_MS` | Optional | Client-side stale-display threshold | Keep consistent with the operational stale-state policy |

The complete tracked template is [`frontend/env.production.example`](../frontend/env.production.example).
The strict production build fails when mandatory values are missing or when the
backend URL is local/non-HTTPS.

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

The application expects these separately managed resources:

- Firebase Authentication for identity and custom role claims.
- Firestore for configuration, durable ride state, locks, sessions, messages,
  feedback, requests, and internal worker/privacy state.
- RTDB for the current `activeBuses` projection and limited server-managed
  assignment mirrors.
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
| Retention sweeper | Disabled | Explicitly approved test schedule | Enabled only with privacy/legal approval |
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
