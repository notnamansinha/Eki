# Reviewed Unit Sub-Oracles

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-012 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

`npm run qa:unit:reviewed` is an L1 family of the [QA programme](README.md). It runs a fixed selection of backend and frontend Vitest files whose assertions have been reviewed against specific requirement oracles, and records each observed assertion by file and title. The full backend and frontend suites still run in `npm test`; their results are not linked to requirements.

## 2. Procedure

```powershell
npm ci
npm run qa:unit:reviewed
```

Node 24 and locked dependencies are enough; no Java, browser or credential is needed. `scripts/qa/run-reviewed-unit.mjs` accepts no arguments. It runs the backend files, then the frontend files, each as a separate Vitest child with one worker, no file parallelism, the Node network guard preloaded through `NODE_OPTIONS`, and a 2-minute deadline. The nightly campaign allows 300 s for both.

## 3. Selection and mappings

`qa/reviewed-unit-test-map.mjs` holds the file list for each workspace (`reviewedUnitFiles`) and the case links (`reviewedUnitTestMap`). The runner blocks the family when the set of files Vitest reports differs from that list.

The selected files use pure functions, mocked SDKs and datastores, loopback Express handlers with mocked authentication, or React components mounted in jsdom. Mapped requirements fall in the AUTH, BOARD, TRIP, DATA, PAX, MAP, FEED, HIST, SEC, SET, CHAT, FLEET and OBS categories. Examples:

- authentication token verification, caching and readiness, including `AuthProvider` and `useAuth` mounted in jsdom;
- boarding policy boundaries and the mounted boarding view, including preparation budgets with a controlled clock;
- trip reducer transitions, ride progress history and lifecycle shutdown;
- worker fencing, retention sweeps and privacy deletion queue recovery;
- feedback, settings and chat HTTP boundaries, described in the [HTTP policy sub-oracles record](HTTP_UNIT_EVIDENCE.md);
- live bus store expiry, recovery and server clock handling, and passenger availability.

Each link was compared with the requirement oracle and the assertion body; a matching title alone does not qualify. Vitest can repeat a literal `%p` title on every parameter row. The collector records each row by its position without guessing the parameter value, and the ledger refuses an ambiguous title as a case link, so unreviewed parameter rows stay unmapped.

## 4. Evidence

The runner writes `reviewedUnit-backend-vitest.json`, `reviewedUnit-frontend-vitest.json`, the matching JUnit and log files, `reviewedUnit-report.json` and `reviewedUnit-report.md` under `artifacts/qa/`, with the source commit and dirty flag. Every assertion must pass with no skip; a missing file or workspace report blocks the family. Passing assertions give `PARTIAL` status to the linked requirements.

## 5. Limits

Mocks define what these tests cannot prove:

| Area | Proven | Not proven |
|---|---|---|
| Authentication | Cache, coalescing, expiry and fresh privileged verification policy | Firebase revocation propagation in a deployment |
| Privacy | Scheduling bounds, recovery generations, refusal of operator and changed identities | Cloud deletion outcomes |
| Trip reducer | Ordered state transitions | Worker persistence, field progression |
| Components | Mounted state, selectors, Escape handling, late callbacks, account transitions | Chromium behaviour, real permissions, durable membership |
| Frontend helpers | History, eligibility and cache rules | Listener clean-up when mounted, PWA and offline behaviour |
