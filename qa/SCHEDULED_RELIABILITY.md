# Scheduled Reliability Workflows

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-013 | 2.0 | Current | 2026-10-30 |

## 1. Purpose

Two GitHub Actions workflows repeat the isolated QA harnesses on a schedule: a nightly campaign of the six evidence families, and a weekly mutation and admission baseline. They test software only. They do not monitor live telemetry, deploy anything or call real providers, Firebase projects or model APIs.

## 2. Source revision

Both workflow files are on `main`, so GitHub runs their schedules from the `main` definition. The first job, `resolve`, chooses one immutable commit for the whole run:

| Event | Commit tested |
|---|---|
| Schedule or manual dispatch (must run from `main`) | The head of `main`, read once through the GitHub API |
| Push to an allowed QA branch | The pushed commit |

Every later job checks out that commit. Missing scripts or reports fail the run; it never falls back to another branch or an earlier artifact.

The `testing` branch was deleted on 2026-10-25; scheduled runs from then until the resolver was changed to `main` failed in `resolve` with `Not Found` and ran no suite. The last scheduled runs that executed suites were on 2026-10-24 (UTC). None of the allowed QA push branches exists. The [risk register](../docs/operations/ARCHITECTURE_RISK_REGISTER.md) closes OPS-02 once a nightly and a weekly run are green on `main`.

## 3. Nightly campaign

Workflow `Isolated nightly QA` (`.github/workflows/deep-qa.yml`) runs daily at 20:17 UTC (01:47 IST), on manual dispatch, and on pushes to the QA branches listed in the file. GitHub may delay scheduled runs.

The `suites` job runs one shard per family, two at a time, without fail-fast. Each shard runs `npm ci`, `npm run qa:check`, installs what its family needs (Java 21 and a backend build for `emulator`, `browser` and `api`; Chromium for `browser`; Python 3.12 and PlatformIO 6.2.0 for `native`), then `node scripts/qa/campaign.mjs <suite>`.

| Shard | Runs | Campaign limit |
|---|---|---|
| `gnss` | `qa:gnss` three times: seeds 42, 0 and a seed derived from the commit and the date | 150 s per seed |
| `reviewedUnit` | `qa:unit:reviewed` | 300 s |
| `native` | `qa:native` | 360 s |
| `emulator` | `test:rules` emulator suites | 390 s |
| `api` | `qa:api` | 390 s |
| `browser` | `qa:browser`, Chromium mobile and desktop, one worker, no retries | 480 s |

`campaign.mjs` refuses a dirty checkout. It accepts a shard only when the family report names the same commit, a clean tree, no physical or provider execution, and as many passed assertions as discovered. Each GNSS seed keeps its own report files.

The `report` job downloads every shard and runs `scripts/qa/campaign-report.mjs`. It checks the commit, workflow run, seed set, assertion identities and case scopes of every campaign, then builds the [execution ledger](EXECUTION_EVIDENCE.md). A partial campaign, red runner, missing artifact or narrow browser run blocks the result. The artifact `nightly-current-source-ledger` holds the ledger and campaign summary.

## 4. Weekly baseline

Workflow `Isolated weekly reliability baseline` (`.github/workflows/weekly-reliability.yml`) runs on Saturdays at 20:41 UTC (Sunday 02:11 IST), on manual dispatch, and on pushes to `codex/qa-nightly-reliability`.

| Shard | Command | What it measures |
|---|---|---|
| `mutation` | `npm run qa:mutation` | Stryker 10.0.0 mutates only `backend/src/services/telemetryPayload.ts` and runs `telemetryPayload.test.ts` and `qaGnssProperties.test.ts`. `qa/stryker.config.mjs` sets a break threshold of 90 % and keeps every surviving mutant in the report. Outer deadline 10 minutes |
| `soak` | `npm run qa:soak` | Five separate processes each run `scripts/benchmark-work-admission.mjs`: 250,000 submissions against stalled synthetic dependencies, drain, recovery and FIFO order, with a 60 s limit per process. A trial passes only with FIFO order, five rounds and retained heap growth under 4 MiB |

The `report` job runs `scripts/qa/weekly-report.mjs` and uploads `weekly-current-source-baseline`. The mutation score is a regression budget for one pure module, not a feature completion measure. The admission trials exercise production helper code; they are not a fleet load or duration soak.

## 5. Controls

`npm run qa:check` runs `scripts/qa/workflow-policy.mjs`, which fails if either workflow loses any of these properties:

- read-only `contents` permission, no deployment environment and no job-level permission changes;
- a dedicated concurrency group that does not cancel a running campaign;
- only the schedule, manual dispatch and allowed-branch push triggers;
- the `resolve`, `suites`, `report` job graph, with at most two shards in parallel and no fail-fast;
- job timeouts of 15 minutes or less;
- actions pinned to the approved commit SHAs.

Artifacts are kept for seven days. Dependency downloads are allowed; the safety preflight, Node network guard and browser request allowlist still apply to the tests.

## 6. Running locally

Use a clean checkout, Java 21, Chromium with its system libraries and PlatformIO 6.2.0. Remove any real provider or Firebase credential from the environment.

```sh
npm ci
python -m pip install platformio==6.2.0
npx playwright install --with-deps chromium
npm run qa:nightly
npm run qa:weekly
```

To run one shard, use `node scripts/qa/campaign.mjs <suite>` with one of `gnss`, `emulator`, `browser`, `api`, `native` or `reviewedUnit`; the emulator, browser and API shards need `npm run build --workspace=backend` first. `npm run qa:mutation` and `npm run qa:soak` run the weekly shards. Reports are written under `artifacts/qa/`.

## 7. Limits

The campaigns use Chromium only. Firefox and WebKit, the production Next.js PWA, wider security matrices and the remaining source and control oracles need reviewed executable coverage. Moving-vehicle truth and compound recovery need the [field acceptance package](FIELD_ACCEPTANCE.md).
