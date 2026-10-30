# Contributing to Eki

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-GEN-007 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This document states how changes reach Eki: branches, pull requests, commit messages, the checks each kind of change needs, and the rules for documentation and firmware. Set up a working system first with [getting started](docs/GETTING_STARTED.md).

## 2. Branches and pull requests

1. Start every change from the latest `main` on a short-lived topic branch named after the change type, for example `fix/stop-arrival-corridor` or `docs/configuration-reference`. Branches created by coding agents use the `codex/` or `claude/` prefix.

   ```powershell
   git fetch origin
   git switch -c fix/<topic> origin/main
   npm ci
   ```

2. Keep each pull request to one concern. Open it against `main`.
3. Write the pull request title as a Conventional Commit subject (Section 3). Maintainers squash-merge, so the title becomes the commit subject on `main`.
4. In the description, state what changed, why, and how a reviewer can confirm it works. List every check you ran and every check you could not run, with the reason. Add screenshots for user interface changes, with personal data removed.
5. Request a review from the code owner listed in `.github/CODEOWNERS`. Merge only after the checks pass and the review approves.

Every push and pull request runs the `Production verification` workflow (`.github/workflows/ci.yml`) and CodeQL. A green `Production verification` run on a push to `main` starts the Deploy workflow, which publishes Hosting, rules and indexes to staging. Merging is therefore a staging release; see [CI, deployment and releases](docs/operations/CI_CD_AND_RELEASES.md).

## 3. Commit messages

Use Conventional Commits [1]: `<type>(<optional scope>): <summary>`.

| Type | Use for |
|---|---|
| `feat` | New user-visible behaviour |
| `fix` | A defect correction |
| `docs` | Documentation only |
| `test` | Tests only |
| `ci` | Workflow changes |
| `chore` | Dependencies, generated files and tooling |

Write the summary in the imperative and describe the behaviour after the change, for example `fix(trip): credit a revisited stop after a GNSS gap`. Use the body to explain why the change is needed. Describe the result, not the steps you took to reach it.

## 4. Checks by change type

Run the checks for every kind of change your branch contains, from the repository root.

| Change | Checks |
|---|---|
| Any code change | `npm run verify`: lint, all unit tests, the production build with service worker and CSP generation, and the production dependency audit |
| Firestore or RTDB rules, or backend code that the emulator suites cover | `npm run test:rules` (needs Java 21) |
| Admin, sign-in or feedback screens | `npm run test:e2e:admin`. Run `npx playwright install chromium` once first. |
| Passenger screens | `npx playwright test --config playwright.passenger-layout.config.ts` and `npx playwright test --config playwright.passenger-progress.config.ts` |
| Critical source: rules, or `backend/src` and `frontend/src` files whose path contains auth, appcheck, boarding, telemetry, tripstate, workerfence, livebus, ride, session, privacy, retention or fleet (`scripts/qa/coverage-budget.mjs`) | Add or change a test and map it in the `qa/*-test-map.mjs` files, commit, then run `$env:EKI_QA_BASE_SHA = git merge-base origin/main HEAD` and `npm run qa:budget`. CI runs the same gate on pull requests. |
| A test that a `qa/` map references is renamed or removed | `npm run qa:check` |
| Firmware | `platformio test --project-dir hardware -e native` and `platformio run --project-dir hardware -e esp32dev`. Use `py -m platformio` on Windows when `platformio` is not on the path. |
| Environment variable added, renamed or removed | Update the tracked template and the [configuration reference](docs/CONFIGURATION.md) in the same change, then run `npm run docs:check` |
| Documentation | `npm run docs:sync`, `npm run docs:check` and `git diff --check` |

A build regenerates the CSP hashes in `firebase.json`; commit changed hashes and do not edit them by hand. With a filled `frontend/.env.local`, the build also writes your backend origin and RTDB host into the policy: leave those local values out of the commit. The [test strategy](docs/testing/TEST_STRATEGY.md) explains what each suite proves, and the [QA guide](docs/qa/README.md) explains the acceptance maps.

## 5. Documentation

1. Follow the [documentation standard](docs/DOCUMENTATION_STANDARD.md). Every controlled document starts with a control block; when you change a document, update its `Last updated` cell and, for a correction, increase the minor version. Documents carry no separate "Last updated" line and no change log.
2. Change the authoritative document in the same pull request as the behaviour it describes. The [documentation index](docs/README.md) shows which document owns each topic.
3. Edit the source of a mirrored file, such as `backend/API.md` or this file, never its copy under `docs/`. Then run `npm run docs:sync`.
4. Register a new document in the [documentation index](docs/README.md) with the next free ID in its area.
5. Do not rewrite Historical evidence. Record a correction or a newer result in a new document that links to the original.
6. Use placeholders in examples. Never commit service-account JSON, device secrets, Wi-Fi passwords, tokens, signing keys, private hostnames or personal location data.

## 6. Firmware

1. Keep the fail-closed behaviour: TLS verification, credential rejection and the fleet security gates.
2. When you change a cadence, threshold or retry policy, state its effect on writes, freshness and recovery in the pull request.
3. A successful build or native test is not physical acceptance. A claim about timing, power, GNSS, TLS or radio behaviour needs a recorded hardware run: commit, build environment, board, conditions, and redacted results. See [hardware telemetry](docs/hardware/HARDWARE_TELEMETRY.md).
4. Produce signed fleet images and perform irreversible eFuse provisioning only through the witnessed [hardware security provisioning](docs/security/HARDWARE_SECURITY_PROVISIONING.md) procedure.

The [hardware guide](docs/hardware/README.md) covers builds, flashing and post-flash checks.

## 7. Security and conduct

Report vulnerabilities privately as described in the [security policy](SECURITY.md), not in a public issue. All participation is covered by the [code of conduct](CODE_OF_CONDUCT.md).

## 8. References

[1] Conventional Commits, "Conventional Commits 1.0.0," conventionalcommits.org/en/v1.0.0/. Accessed: 2026-10-30.
