# Security Policy

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-SEC-001 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This policy states which Eki code receives security fixes, how to report a vulnerability, what is in scope, and how contributors handle secrets and personal location data. The controls themselves are described in [Security architecture](../security/SECURITY_ARCHITECTURE.md).

## 2. Supported versions

| Component | Supported | Notes |
|---|---|---|
| Web app, backend, Firestore and RTDB rules, Hosting configuration | Head of `main` | Staging deploys the commit of each successful push build on `main`. Production deploys only by a manual workflow run from `main`. See [CI/CD and releases](../operations/CI_CD_AND_RELEASES.md). |
| Tracker firmware | Signed builds of the `esp32dev-secure` PlatformIO environment | The `esp32dev`, `esp32dev-quiet` and `esp32dev-journal` environments are development builds without Secure Boot or flash encryption. |
| Other branches, forks and earlier commits | Not supported | Reproduce a finding on `main` before reporting it. |

Fixes are made on `main` and reach deployments through the normal release pipeline.

## 3. Reporting a vulnerability

### 3.1 How to report

1. Do not describe the vulnerability in a public issue, pull request, discussion or commit.
2. Send the report privately to the repository owner listed in [`.github/CODEOWNERS`](.github/CODEOWNERS). If you cannot find a private channel, open a public issue that asks for one and contains no vulnerability details.
3. Include the affected component and commit, the steps to reproduce, the impact you observed, and whether you accessed any data that is not yours.
4. Use synthetic accounts and data. Do not attach real credentials, ID tokens, device secrets, location traces or unredacted logs.

### 3.2 Testing rules

- Reproduce against local Firebase emulators where possible; [Local testing](../operations/LOCAL_TESTING.md) describes the setup and `npm run test:rules` runs the rules tests.
- Do not run load tests, denial-of-service tests or credential guessing against deployed staging or production services.
- Do not read, change or delete other users' data, and stop as soon as a finding is confirmed.

### 3.3 What to expect

This repository does not define a response time, a disclosure deadline or a bounty. A confirmed vulnerability is fixed through a pull request to `main` and released through the deployment workflow.

## 4. Scope

| In scope | Location |
|---|---|
| Browser app | `frontend/` |
| Backend API and workers | `backend/` |
| Security rules | `firestore.rules`, `database.rules.json` |
| Hosting headers and Content Security Policy | `firebase.json`, `scripts/update-csp.mjs` |
| Tracker firmware and fleet build configuration | `hardware/` |
| Build, test and deployment automation | `scripts/`, `.github/workflows/` |

Out of scope:

- Vulnerabilities in Firebase, Google Cloud or Google Maps Platform themselves. Report them to Google.
- Vulnerabilities in third-party packages that do not affect Eki. Report them to the package maintainers.
- The residual risks listed in [Security architecture](../security/SECURITY_ARCHITECTURE.md), unless you show a new way to exploit them.

## 5. Handling secrets

| Secret | Where it belongs |
|---|---|
| Firebase Admin service-account JSON | Backend runtime environment (`FIREBASE_SERVICE_ACCOUNT`) or Application Default Credentials |
| Device secret and Wi-Fi password | Ignored `hardware/include/secrets.h`, only inside the controlled signing environment |
| Secure Boot signing key | Offline signing environment ([key custody](hardware/keys/README.md)) |
| Firebase deploy token | GitHub environment secret `FIREBASE_TOKEN` |
| Server Google Maps key | Backend environment (`GOOGLE_MAPS_API_KEY`) |

Rules for contributors:

1. Never commit a secret, paste it into an issue, pull request, chat or log, or include it in documentation. Use placeholders such as `<project-id>`.
2. `NEXT_PUBLIC_*` browser values are public once built. Restrict the browser Firebase and Maps keys by HTTP referrer and API in Google Cloud, and keep the server Maps key separate.
3. `npm run provision-device --workspace=backend` prints a device secret once. Copy it only into `secrets.h` in the signing environment.

If a secret is exposed:

| Secret | Response |
|---|---|
| Device secret | Run `npm run provision-device --workspace=backend -- --device-id <id> --bus-id <id> --route-id <id>` to issue a new secret, then build and flash a new signed image. To stop the device first, an administrator calls `POST /api/devices/<deviceId>/disable`. |
| Firebase Admin credential, deploy token or API key | Revoke it at Google Cloud or Firebase, issue a replacement, and update the store listed above. |
| Secure Boot signing key | Unset all six `FIRMWARE_RELEASE_*` backend variables to stop OTA distribution, and inform the university security owner who holds the key. Fleet trackers trust the public key digest burned into their eFuses; the repository defines no key replacement procedure. See [Hardware security provisioning](../security/HARDWARE_SECURITY_PROVISIONING.md). |

## 6. Handling personal and location data

Bus positions identify the vehicle and its driver. Passenger profiles, ride manifests, chat messages and feedback identify passengers and their travel. [Security architecture](../security/SECURITY_ARCHITECTURE.md) lists what Eki stores, who can read it and how long it is kept.

1. Never place real location traces, personal records or unredacted logs in issues, pull requests, commits, test fixtures or documentation. Store field evidence in approved private storage.
2. Use synthetic identities and coordinates in tests and examples.
3. Passengers delete their account from the app. [Privacy deletion](../operations/PRIVACY_DELETION.md) describes what is deleted, what is retained and how to recover a failed request.
