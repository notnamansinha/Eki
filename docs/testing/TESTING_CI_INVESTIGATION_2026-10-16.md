# Testing branch CI investigation: 2026-10-16

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-056 | 1.0 | Historical | 2026-10-16 |

Investigated the red checks associated with merges #322, #333 and #325.
Baseline: `testing` at `72259f0012dea83a4d4595688d1339e3c2fbfd55`.
The latest baseline's Production verification and CodeQL runs were already
green; the older failures still warranted investigation for intermittency.
Work used an isolated checkout; the original checkout's uncommitted work was
preserved. Dates and local test times use Asia/Calcutta.

## Failure attribution

| Run | Observed failure | Finding |
| --- | --- | --- |
| [38803417893](https://github.com/notnamansinha/Eki/actions/runs/38803417893) at `acc8740` | Docker `npm prune --omit=dev --omit=optional` failed with registry `ECONNRESET` after backend TypeScript compilation succeeded. | Genuine unnecessary network dependency during backend pruning. The unscoped command can install the other workspace's dependencies. |
| [38803382696](https://github.com/notnamansinha/Eki/actions/runs/38803382696) at the PR merge tree for `9409168` | Emulator launcher exceeded its six-minute deadline before the test runner produced evidence. | Setup failure, not an observed assertion failure. Uploaded report has null counts and the initial setup-blocked marker. Current local rules suite passes. |
| [38803374876](https://github.com/notnamansinha/Eki/actions/runs/38803374876) at `9409168` | Mobile service restart received an unsuccessful HTTP response; backend logged Firestore `INVALID_ARGUMENT: Transaction is invalid or closed`. | Actual intermittent integration failure. Not reproduced in ten focused current-source local browser runs. No blanket transaction retry, timeout increase or weakened assertion was introduced. |
| QA evidence jobs in the last two runs | Required execution evidence was missing or a browser assertion failed. | Consequences of the upstream failures. Their fail-closed reporting is correct. |

## Repair and failing-first experiment

The backend image installs only the backend workspace for compilation, but its
old prune command operated on the whole workspace. With networking disabled,
the original command attempted to fetch the frontend package
`styled-jsx-5.1.6.tgz` and failed with `EAI_AGAIN`.

The replacement prune command explicitly selects the backend, excludes the
workspace root, omits development/optional dependencies, and disables install
scripts, audit and funding requests. `--offline` plus Docker's
`RUN --network=none` enforce that pruning succeeds without registry access.
The initial `npm ci` still downloads the locked build dependencies normally.
Application code, authentication policy, dependency versions and test assertions
are unchanged by this repair.

## Local verification

- `npm run test:rules`: 55 tests passed across 11 integration files, using real
  disposable Auth/Firestore/RTDB emulators and synthetic identities.
- Focused `admin live service controls` Playwright journey with `repeatEach: 5`:
  ten passed, zero failed/skipped/flaky; mobile 390×844 and desktop 1280×800,
  Chromium with real local emulators and synthetic providers.
- Baseline Docker builder with its prune step under `--network=none`: expected
  failure, confirming the unwanted frontend download.
- Revised Docker builder with pruning under `--network=none`: exit 0.
- Final `docker build -f backend/Dockerfile -t eki-backend:testing-ci-fix .`:
  exit 0, including backend TypeScript compilation.
- Final image booted with `--network none`, placeholder configuration and no
  credentials: `/live` returned 200 with `status=alive`; `/health` returned 503
  with `status=degraded`, as required by the CI smoke contract.
- Runtime checks: UID 1001, Express resolvable, Next.js/TypeScript absent and
  bundled npm removed. Both owned smoke containers were removed after testing.
- `node --test scripts/*.test.mjs`: 138 passed.
- `npm run qa:check`: exit 0. Its catalog correctly retains
  `NOT_RELEASE_READY`; this repair does not certify a live deployment.
- `npm run lint`: exit 0 for frontend and backend.

Windows emulator execution used process-local Java options
`-Djdk.net.unixdomain.tmpdir=C:/Temp/Eki323 -Djava.net.preferIPv4Stack=true`.
The first custom stress configuration had an incorrect working directory;
that local harness setup error was corrected before the ten actual executions.
The first container probe ran before the server listened; the final smoke check
waited for startup and asserted both responses.

Raw failed CI logs, the original setup artifact, the isolated stress harness,
Docker build logs and smoke output are retained locally under
`artifacts/qa/testing-ci-investigation/`. The helper files there are investigation
artifacts and are not production or CI entry points. Full current-source hosted
verification runs again on the repair commit pushed to `testing`.
