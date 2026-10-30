# Current-Source Execution Ledger

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-006 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

`npm run qa:report` combines the six harness reports of the [QA programme](README.md) with the static acceptance catalog for one commit. It derives a status for each of the 399 requirement definitions from exact test observations and the reviewed test maps. It does not run any test itself.

## 2. Inputs

`scripts/qa/execution-report.mjs` reads one report per family from `artifacts/qa/`:

| Family | Level | Report | Produced by |
|---|---|---|---|
| `gnss` | L1 | `gnss-report.json` | `npm run qa:gnss` |
| `reviewedUnit` | L1 | `reviewedUnit-report.json` | `npm run qa:unit:reviewed` |
| `native` | L1 | `native-report.json` | `npm run qa:native` |
| `emulator` | L2 | `emulator-report.json` | `npm run test:rules` |
| `api` | L2 | `api-report.json` | `npm run qa:api` |
| `browser` | L3 | `browser-report.json` | `npm run qa:browser` |

## 3. Procedure

Use a clean checkout with Node 24, Java 21, Chromium and PlatformIO 6.2.0 with a host C++ compiler:

```sh
npm ci
npm run qa:gnss
npm run qa:unit:reviewed
npm run build --workspace=backend
npm run test:rules
npm run qa:browser
npm run qa:api
npm run qa:native
npm run qa:report
```

The ledger is written to `artifacts/qa/execution-report.json` and `execution-report.md`, and appended to the GitHub step summary in CI. The command exits with a non-zero code unless every family is accepted.

## 4. Acceptance rules

A family is accepted for its scope only when its report:

- names the current commit and a clean working tree;
- exists, parses and has consistent counts;
- identifies every observed test by file and title, with no unknown case or scope, no duplicate observation, and no claimed result that disagrees with the observations;
- for the browser family, covers the full scope (not `providers` or `service`) with one first-attempt pass in both the mobile and desktop projects.

Requirement IDs that appear in several test maps keep each family's links. `scripts/qa/merge-test-maps.mjs` rejects a duplicate ID within one family and conflicting semantics for the same assertion.

Reports keep only the validated loopback emulator topology. Authorization observations record only the 401 or 403 category; the tests still compare the real status.

## 5. Output

| Field | Meaning |
|---|---|
| `requiredHarnessExecution` | `PASS` when all six families are accepted, otherwise `BLOCKED` |
| `counts` | Number of requirements in each status: `PARTIAL`, `FAIL`, `BLOCKED`, `NOT_RUN`, `NOT_COVERED` |
| `completeFeatureCases` | Always `0` |
| `softwareRelease` | Always `NOT_RELEASE_READY` |
| `vehicleFieldDeployment` | Always `NOT_VERIFIED` |

A requirement with a passing mapped assertion is `PARTIAL`: each test map covers a limited part of its oracle. Mapped requirements without observations stay `NOT_RUN`, and unmapped ones `NOT_COVERED`. Historical ledger notes never raise a status.

## 6. Continuous integration

In Production verification, the `qa-evidence` job runs after the `web` and `firmware` jobs, even when they fail. It downloads the static catalog and every `*-evidence` artifact and runs `npm run qa:report`. The ledger artifact `current-source-execution-evidence` is kept for seven days. The nightly workflow builds the same ledger from its campaign shards; see [scheduled reliability](SCHEDULED_RELIABILITY.md).

## 7. Limits

The ledger imports only the six instrumented families. The full backend and frontend Vitest suites and the ESP32 builds run separately in Production verification; their results are not linked to requirements. OAuth, real Maps and Places, hardware and owner approval gates remain outside the ledger. A `PASS` for `requiredHarnessExecution` shows that the bounded harnesses ran completely on one commit; it is not a release or deployment approval.
