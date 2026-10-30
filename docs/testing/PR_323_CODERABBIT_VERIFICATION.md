# PR #323 CodeRabbit verification: 2026-10-15

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-039 | 1.0 | Historical | 2026-10-15 |

Reviewed PR head `bb6b7c4d8277027f55bee694105d2e012fdf4ef3` in an isolated
worktree on `codex/pr-323-coderabbit`. The original checkout's staged,
unstaged and untracked work was preserved. Commands below ran locally on
Windows, Node 24.19.0, npm 12.0.2, Python 3.11.9 and Microsoft JDK 21.0.12;
times use Asia/Calcutta. Results describe this repair's working diff over that
head, not an exhaustive live deployment audit.

All six actionable comments and the Auth performance nitpick were genuine.

| Finding | Reproduction and repair | Local verification |
| --- | --- | --- |
| Broken playbook references | Seven document-relative targets did not exist. Point the standalone playbook at its tracked skill package. | Resolve all seven targets on disk. |
| Broad Places waiter / absent short-query assertion | A response for another query could satisfy the waiter; entering two characters had no request-count assertion. Match GET, parsed pathname and full query; count short-query requests separately. Update both copies of the example. | Execute the actual snippets in Chromium at 390×844 and 1280×800 against a synthetic page: unrelated responses arrive first; a deliberately faulty two-character request must fail the recipe. Eight cases pass. |
| Validator claim overstates its guarantees | Existing gate checked fields and file existence, not evidence contents or truth. Clarify structural validation and the continuing need to inspect actual observations. | Inspect implementation; updated reporting describes JSON/ledger checks without claiming semantic proof. |
| Census identity collision / shared-line reconciliation | Original census gives two same-line buttons the same ID. Add source column to the ID; introduce ledger `source_id` copied from the census, separate from action `control_id`. Reconcile ID and file/line; reject duplicate inventory IDs and location mismatches. | Actual baseline script reproduced the duplicate. Regressions verify distinct repeatable IDs and require a separate ledger mapping for each same-line candidate. |
| Short CSV rows crash | Omitted trailing fields become `None`, causing `.strip()` to raise. Reject incomplete/extra-field rows before accessing values. | Regression requires exit 2, an error-bearing summary and no traceback. |
| Empty evidence can support PASS | Empty files satisfied `is_file()`. Parse per-action JSON; require the documented fields and compare control/page/role/viewport/precondition/action/expected/observed/provider tier to the ledger. Validate SHA, timestamp, HTTP-status types and referenced trace/screenshot files. | Positive record plus empty/malformed/non-object/missing/mismatched record cases; incomplete rows never count as runtime passes. |
| Auth network call in retried transaction | Auth lookup repeated within Firestore callbacks. Fetch Auth once before the transaction; retain the transactional deletion fence and fresh post-commit claim synchronization. | Three simulated transaction attempts require only one pre-transaction validation plus one post-commit claim lookup. A deletion fence appearing after Auth validation still returns 409 without creating a profile. Missing/disabled accounts remain denied. |

The Auth change uses CodeRabbit's unconditional pre-transaction lookup option.
It adds one Auth read to existing-profile requests, avoiding repeated network
calls inside transaction retries. Claim synchronization still reads fresh
claims after commit. No Firestore permissions were broadened.

## Executed checks

| Command/check | Result | Evidence boundary |
| --- | --- | --- |
| `node --test scripts/*.test.mjs` | 138 passed | Includes 22 census/coverage-gate regressions; Python required for the gate tests. |
| Backend Vitest, via `npm test` | 1,110 passed; 51 integration cases intentionally skipped in unit mode | Unit/loopback harnesses. |
| `npm run test --workspace=frontend -- --maxWorkers=2` | 644 passed | All frontend unit/component tests. |
| Focused backend `profileSettings.test.ts --maxWorkers=1` | 16 passed | Bootstrap, identity, role and settings regressions. |
| `npm run lint` | Exit 0 | Frontend and backend ESLint. |
| `npm run build` | Exit 0 | Backend TypeScript, Next static export, service worker and CSP generation. Deployment backend URL contract skipped because no backend URL was configured. Generated CSP-only `firebase.json` changes were saved as evidence and restored. |
| OpenAPI / UI contracts | Exit 0 | 71 registered HTTP operations; checked during `npm test`. |
| `npm run qa:check` | Exit 0 | Safety preflight, acceptance catalog and workflow policy. Catalog still reports NOT_RELEASE_READY; this is not a deployment certification. |
| `npm run test:rules` with local Java options below | 51 passed, zero failed/blocked | Actual disposable Auth/Firestore/RTDB emulators; includes retained history and retired-profile authority. |
| `npm run test:e2e:admin -- --workers=1` | 22 passed | Actual admin components with synthetic auth/transport. |
| `playwright test e2e/places-audit-recipe.spec.ts --workers=1` | Eight passed | Both actual documentation snippets; synthetic browser/network only. |
| `npm run qa:browser` | 38 passed; zero failed/skipped/flaky | Real local Auth/Firestore/RTDB; synthetic Maps/Places. |
| `npm run qa:api` | Four partitions passed; 179 protected-operation observations | Local HTTP authorization partitions. |
| `npm audit --json` and `npm audit --omit=dev --omit=optional --json` | Both exit 0; zero vulnerabilities | Current locked full and required production dependency graphs. |
| Ruff 0.17.1, `check .../coverage-gate.py --select E,F --ignore E501` | Exit 0 | Python lint; gate formatted with Ruff. |
| Bandit 1.9.4, coverage gate | Exit 0; zero findings | Python security static analysis. |
| ESLint security 4.2.0, 212 tracked non-test JS/TS files | 136 heuristic warnings, zero parser/configuration errors | Broad static scan, not 136 confirmed vulnerabilities. See triage below. |
| Tracked credential/hidden-text pattern scan | Zero matches across 801 tracked files | Signature patterns, not a full entropy/history scan. |
| Current source census | 170 candidates / 36 files / four pages | Inventory only. Candidate ledger marks all 170 NOT_RUN for exhaustive UI coverage; strict gate correctly exits 1 with zero structural errors. Regression suites are separate evidence. |

The first unconstrained `npm test` frontend run had 11 failures under concurrent
build/test load. All 644 frontend tests passed on the complete bounded rerun;
no application code was changed to make those failures disappear. The first
negative recipe tests used a color-sensitive error-message matcher; they were
corrected to assert the failure type and recorded request, then all eight passed.

The first emulator attempt failed before test execution in Java's Windows
Unix-domain loopback selector. Subsequent emulator commands used a disposable
short temporary directory and these process-local options:

```powershell
$env:JAVA_TOOL_OPTIONS='-Djdk.net.unixdomain.tmpdir=C:/Temp/Eki323 -Djava.net.preferIPv4Stack=true'
```

## Audit and security skill scope

Applied `address-github-comments`, `codebase-audit-pre-push`,
`cc-skill-security-review`, `security-scanning-security-sast`,
`security-scanning-security-dependencies` and the repository's
`owasp-agentic-skills-top-10` guidance. Used the Eki interaction-audit and
accessibility guidance to separate actual browser evidence, synthetic providers,
source candidates and unexecuted states. Reviewed baseline UI, motion and metadata
applicability; this repair changes no rendered UI, animations, pages or metadata.
This does not claim every installed skill or every source line was manually audited.

The 16 SAST warnings in PR-touched files were inspected: feedback checks an own
manifest property before indexing, chat validates membership before indexing,
route edits index local stop arrays, passenger route counts index the local
catalog, and census filesystem paths are explicitly selected local CLI inputs.
The census neither runs source code nor sends network requests. These warnings
do not establish an exploitable injection. Other repository-wide warnings remain
heuristics outside the changed lines; this is not a clean whole-repository SAST
or penetration-test claim. Existing duration regexes are anchored with disjoint
numeric/fractional segments, the profanity regex escapes fallback characters,
and the token equality warning concerns a per-request cache.

OWASP review covered the tracked skill's instructions and scripts, external
references, hidden text, intended file access and lack of credential/network
access in its census/gate helpers. Git pins the reviewed package revision;
publisher signatures, a container boundary and platform-wide permission
enforcement were not certified. No hooks, deployment, cloud data or installed
agent configuration were changed.

PASS evidence validation now intentionally requires per-action JSON rather than
an arbitrary screenshot/report file. Existing ledgers need the new `source_id`
header and current census IDs. A structurally valid JSON record can still lie;
its trace, screenshot and observation require independent inspection.

Local evidence is under `artifacts/qa/`, including `eslint-security.json`,
`bandit.json`, `secrets-and-skill-scan.json`, emulator/browser/API reports and
`interaction-audit/2026-10-15-bb6b7c4-coderabbit/`. Root `*-final.log`,
`frontend-tests-bounded.log`, `recipe-browser.log`, `rules-retry.log`,
`admin-browser.log`, `emulator-browser.log`, `build.log`, `lint.log` and audit
JSON files retain command results. Source hashes bind final files to the tested
diff. None of these ignored artifacts contains real passenger data.

Real OAuth/picture delivery, billed Google Maps/Places, deployed CSP/App Check,
cloud indexes, physical GNSS and exhaustive role/state/control execution remain
separate gates. No live-provider or production-readiness claim is made.
