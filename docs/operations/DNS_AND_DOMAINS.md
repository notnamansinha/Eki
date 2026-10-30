# DNS and Domains

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-002 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This procedure connects custom domains to the Eki frontend and backend, and lists the settings that must change with a hostname: Firebase Authentication domains, OAuth redirect URIs, CORS, CSP and device trust. Use the exact values that the Firebase, Google Cloud and DNS consoles show. Do not publish verification tokens, private addresses or certificate keys in the repository.

## 2. Current origins

| Component | Origin | Notes |
|---|---|---|
| Frontend | `https://bustrack-be165.web.app` (also `https://bustrack-be165.firebaseapp.com`) | Firebase Hosting default domains; no custom domain is configured in the repository |
| Backend | The ngrok assigned domain | The domain belongs to the ngrok account; there are no DNS records to manage ([ngrok tunnel](NGROK_TUNNEL.md)) |
| Production frontend (planned) | `https://eki-production.web.app` | Named in `.github/workflows/deploy.yml`; the project is not provisioned |

A custom domain changes three build or runtime values, each in a different place:

| Value | Where | Effect |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Frontend build | Canonical, Open Graph, robots and sitemap URLs. Unset, it falls back to `https://bustrack-be165.web.app`. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Frontend build | Host of the Firebase Auth helper (`/__/auth/`) |
| `CORS_ORIGIN` | Backend `.env` | Comma-separated frontend origins that may call the API |

`NEXT_PUBLIC_SITE_INDEXING=false` keeps a test or preview build out of search indexes. All three frontend values are compiled into the static export, so a change needs a rebuild and redeploy. Variable details are in [configuration](../CONFIGURATION.md).

## 3. Connect a custom frontend domain

1. In the Firebase console, open Hosting for the project and add the custom domain. Expected: the console lists the DNS records to create.
2. At the DNS provider, create exactly those records: a TXT record that proves ownership and A records (AAAA as well in advanced setup) that point to Hosting. Remove existing A, AAAA or CNAME records for that name that point elsewhere [1]. Expected: after propagation the console shows the domain as connected and issues a certificate.
3. Add `NEXT_PUBLIC_SITE_URL: https://<frontend-host>` to the build step of `.github/workflows/deploy.yml` through a pull request; the workflow does not pass it today. Set the `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` secret as described in Section 4. Expected: after the next Deploy run, the page's canonical link uses the custom host.
4. Add `https://<frontend-host>` to `CORS_ORIGIN` on the backend and restart it. Keep the `web.app` origin as well: the Deploy workflow's backend check sends `Origin: https://bustrack-be165.web.app` and fails without it.
5. Add the host to the HTTP referrer restrictions of the Firebase browser API key and the Maps JavaScript API key in the Google Cloud console. Expected: maps load on the custom host.

## 4. Firebase Authentication domains

1. In the Firebase console, open Authentication, Settings, Authorized domains, and add the frontend host. Expected: the host is listed. Add the backend host only if it also serves Firebase Auth helper pages; the Eki API does not.
2. Set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to the frontend host. On `<project-id>.web.app` and `<project-id>.firebaseapp.com` the client already uses the current host (`frontend/src/lib/firebaseAuthDomain.ts`); on any other host it uses this value.
3. In the Google Cloud console, add `https://<frontend-host>/__/auth/handler` to the authorized redirect URIs of the OAuth client that Google sign-in uses [2]. Expected: Google sign-in completes on the custom host without `auth/unauthorized-domain`.

Keeping the Auth helper on the frontend's own host prevents browsers that partition third-party storage (Safari, Firefox and privacy-restricted browsers) from losing the sign-in state. A frontend served from a plain Next.js development server does not serve `/__/auth/`; keep its Auth domain on a Firebase Hosting host.

## 5. Backend hostname

Any backend hostname must serve HTTPS with a certificate chain that ends in the root CA compiled into the device firmware. The frontend and firmware store the origin only, without a path; they append `/api/...` themselves. A production frontend build rejects a backend URL that is not HTTPS or that points at a local host.

| Option | DNS work | Frontend and device settings |
|---|---|---|
| Current: ngrok domain | None | `NEXT_PUBLIC_BACKEND_URL` and firmware `BACKEND_URL` name the ngrok origin |
| Proposed: same origin as the frontend through Hosting rewrites ([proposal](CI_CD_AND_RELEASES.md#72-proposed-migration-to-cloud-run)) | None beyond Section 3 | Both settings name the frontend origin; the device trusts the Hosting certificate's root CA |
| Separate API host, for example `api.<domain>` | Create the records that the Cloud Run domain mapping or load balancer shows | Both settings name the API origin; the strict build adds it to the CSP; backend `CORS_ORIGIN` lists the frontend origins |

After any change to `NEXT_PUBLIC_BACKEND_URL`, run the strict build (`npm run build:production` locally, or the Deploy workflow). It writes the backend origin into the CSP `connect-src` in `firebase.json` and fails if the policy would block it. Do not edit the generated CSP by hand. `BACKEND_URL` is a firmware setting, not a backend environment variable.

## 6. Device DNS and TLS

1. The device resolves the backend hostname with the DNS servers that the Wi-Fi network assigns by DHCP; the firmware sets no resolver of its own. Confirm that the bus hotspot provides working DNS. Each lookup has a bounded time budget ([DNS cold connect](../hardware/DNS_COLD_CONNECT.md)).
2. If the backend certificate comes from a university or enterprise CA, compile that root CA into `BACKEND_ROOT_CA` in the controlled build environment.
3. A change of backend scheme, hostname, port or root CA needs a rebuild and reflash of every device ([ngrok tunnel](NGROK_TUNNEL.md#7-when-a-device-must-be-reflashed)).

## 7. Verification

Run from the repository root in PowerShell:

1. `Resolve-DnsName <frontend-host>`. Expected: the A records from the Hosting console.
2. `curl.exe -sI https://<frontend-host>`. Expected: `HTTP/1.1 200` (or `HTTP/2 200`) with `content-security-policy` and `strict-transport-security` headers.
3. `Invoke-RestMethod https://<backend-host>/health`. Expected: `status: ok`.
4. `node scripts/check-stationary-runtime.mjs --frontend https://<frontend-host> --backend https://<backend-host>`. Expected: every check passes, each allowing the frontend origin.
5. Sign in with Google on the custom host. Expected: no `auth/unauthorized-domain` error.
6. Watch a device's serial log. Expected: telemetry responses `200` or `202` to the backend host.

## 8. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| Console never shows the domain as connected | Missing TXT record or conflicting records | Compare the provider's records with the console; remove conflicting records |
| `auth/unauthorized-domain` | Host missing from Authorized domains | Section 4, step 1 |
| Google sign-in returns to a blank page or loses state | Auth domain not on the frontend host, or redirect URI missing | Section 4, steps 2 and 3 |
| Browser blocks API calls with a CSP error | Frontend built with another backend origin | Correct `NEXT_PUBLIC_BACKEND_URL` and redeploy |
| Browser blocks API calls with a CORS error | Frontend origin missing from `CORS_ORIGIN` | Add it and restart the backend |
| Device TLS or DNS failure after a hostname change | Device still compiled with the old origin or root | Reflash |

## 9. References

[1] Google, "Connect a custom domain," firebase.google.com/docs/hosting/custom-domain. Accessed: 2026-10-30.

[2] Google, "Best practices for using signInWithRedirect on browsers that block third-party storage access," firebase.google.com/docs/auth/web/redirect-best-practices. Accessed: 2026-10-30.
