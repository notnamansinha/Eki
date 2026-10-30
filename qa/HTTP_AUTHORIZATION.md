# Disposable HTTP Authorization Sweep

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-009 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

`npm run qa:api` is an L2 family of the [QA programme](README.md). It sends requests to the compiled backend running against disposable Auth, Firestore and RTDB emulators and checks that the authorization boundary denies what it should without side effects. It involves no browser, real OAuth or real provider.

## 2. Procedure

Use a clean checkout with Node 24, Java 21 and locked dependencies. The safety preflight rejects real Firebase and provider credentials.

```powershell
npm ci
npm run qa:api
```

The script builds the backend, then `scripts/run-rules-emulator.mjs --api` starts the emulators and runs `scripts/qa/run-api.mjs`. That runner checks the emulator hub targets and runs `scripts/qa/api-authorization.integration.test.mjs` with `node --test`, one test at a time, the network guard preloaded and a 4-minute deadline. The nightly campaign allows 390 s.

## 3. Test design

The sweep reads operations from `backend/openapi.json`. `npm run verify:openapi` separately reconciles that document with the Express registrations, so a newly documented protected or admin-only operation joins the matching partition automatically. Path parameters are replaced with a safe identifier that does not exist.

| Test | Expected result |
|---|---|
| Every protected operation without credentials | 401 JSON |
| Every protected operation with a malformed bearer credential | 401 JSON |
| Every admin-only operation with a real emulator passenger ID token | 403 JSON; token verification and middleware are not mocked |
| Public health endpoints and CORS preflight | Minimal `no-store` JSON; allowed and disallowed origins answered without reflecting credentials |
| Mixed-case GET and HEAD requests | Identity and admin checks still apply |
| A saved `driver`-role token after unassignment, replacement and deletion | Database access is lost through the HTTP offboarding paths |
| Admin demotion and restoration through the Auth CLI | A saved admin token never regains access in either database |
| Device OTA reservations | Real device verifiers and Firestore transactions enforce reservation ownership and recovery |

Every denied response must be JSON with no `stack`, `token` or `boardingCode` field. After each denial sweep the test compares a snapshot of selected application collections, Auth claims and `activeBuses` with the snapshot taken before, and requires zero synthetic provider calls. The selected collections include sessions, routes, fleet, users, feedback, devices and diagnostics, active locks, privacy, and the route and fleet operation journals. Worker leases and metrics are not included.

Each partition starts its own backend process, so earlier negative requests cannot use up a later partition's rate limit. The fixture records the backend's process ID and refuses to reuse another server. The test-only control listener is separate from the production Express routes.

## 4. Evidence

Results are written to `artifacts/qa/api-report.json`, `api-report.md`, `api-junit.xml`, `api-observed.json`, `api-operation-observations.json`, `api-progress.log` and `api-run.log`, with the source commit and dirty flag. Request observations record method, path, partition and the 401 or 403 category; tokens, headers and private snapshots are never written. The verdict is green only when the runner exits cleanly and all eight named tests pass. Passing tests give `PARTIAL` status to the links in `qa/api-test-map.mjs`.

## 5. Limits

The sweep does not cover token expiry, wrong device secrets outside the firmware installation endpoint, resource ownership for every operation, query and body parser partitions, full error and log redaction, private cache behaviour, or proxy and tunnel semantics. Other focused tests may cover parts of these; they need reviewed mappings and current execution evidence.
