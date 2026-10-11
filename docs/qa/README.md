# Eki deterministic acceptance infrastructure

This first implementation slice imports requirements and inventories current source.
It changes no application, firmware, database rules or deployment behavior. It does
not certify the 351-case ledger. Routine commands use Node and existing TypeScript
dependencies, with no LLM calls or live provider requests.

## Run locally

```sh
npm ci --ignore-scripts
npm run qa:test
npm run qa:check
npm run qa:catalog
```

`artifacts/qa/qa-report.json` and `qa-report.md` are ignored generated outputs.
The JSON records HEAD **and working-tree dirty state**, full-document byte counts,
SHA-256, line counts, source-attributed cases/oracles, historical ledger notes,
current source inventory and outstanding gates. A dirty report cannot establish
an exact-commit acceptance result. Run again after committing for review evidence.
`qa:check` checks the configuration boundary and catalog without writing output.
The existing root test command also includes the new regression tests.

For a committed PR, `EKI_QA_BASE_SHA=<full base SHA> npm run qa:budget` fails if
changed authority/session/telemetry/live-position/privacy/rules source has no
exact reviewed `sourcePaths` mapping and corresponding changed test file.
The PR workflow supplies an immutable base SHA and fetches history. The gate
checks traceability and test changes, not whether assertions are sufficient;
reviewers must inspect semantics. Historical unmapped cases alone do not fail.

The reader consumes the entire historical plan to EOF, including all appendices;
each line is scanned and full file hashes/byte counts are recorded. Section 5's
351 exact case IDs, C01-C22/H01-H18, eight AB protocols and twenty GNSS profiles
are reconciled. The strategy's SIM-01 through SIM-20 are retained as a separate
unmapped denominator. Original table oracles, supplemental tables and preceding override/boundary prose are
preserved. Historical appendix claims are not imported as current execution.
This is a full **programmatic scan**, not a claim of manual semantic review of
every historical PR/comment or rendered browser state.

## Evidence contract

- 351 feature cases, 40 universal matrix entries and eight experiment protocols
  are separate denominators. Missing/duplicate/unknown IDs are hard errors.
- Source census uses tracked current files: Next page routes, the existing
  mounted Express extractor, JSX controls/event boundaries, import dependencies,
  candidate database calls, literal tests, firmware environments/native sources.
- Static control sites may render repeatedly. Non-JSX interactions, generated
  DOM and visible state/keyboard census need browser execution in later slices.
- Declared tests are not runtime-expanded test counts. Describe titles are
  context only. Database call candidates need review to identify actual writes.
- `test-map.mjs` contains justified exact named test mappings. Initially H17
  maps only the existing L0 OpenAPI/router reconciliation assertion. Everything
  else is conservatively unmapped, even where existing regressions are present.
  Unmapped does **not** mean the repository has no tests.
- Catalog generation can produce only NOT_RUN or NOT_COVERED. History is
  explicitly separate; PASS cannot be imported by editing a status field.
- Priorities and required levels are conservative proposals pending per-case
  review. They are not silently approved release waivers or physical gates.

## Safety boundary

`qa:safety` checks relevant process configuration without loading `.env` files,
SDKs or opening sockets. Known Firebase/GCP projects must be `demo-eki-qa`;
configured target URLs must use literal `http://127.0.0.1:PORT` or
`http://[::1]:PORT`. DNS names, alternate IPv4 notation, credentials, query/hash
redirect parameters, cloud Firebase and known Maps/model keys are rejected.
Errors print variable names, not values.

The future emulator mode (`npm run qa:safety -- --emulator`) also requires:

| Variable | Required value |
| --- | --- |
| GCLOUD_PROJECT | demo-eki-qa |
| FIRESTORE_EMULATOR_HOST | 127.0.0.1:8085 (or IPv6 loopback) |
| FIREBASE_DATABASE_EMULATOR_HOST | 127.0.0.1:9005 (or IPv6 loopback) |
| FIREBASE_AUTH_EMULATOR_HOST | 127.0.0.1:9095 (or IPv6 loopback) |
| FIREBASE_DATABASE_URL | http://127.0.0.1:9005/ |
| EKI_QA_BASE_URL | Explicit loopback backend root and port |
| EKI_QA_EXTERNAL_PROVIDERS | mock |
| EKI_QA_CONFIRM_DISPOSABLE | 1 |

Configuration acceptance is **not runtime proof of isolation**. This slice does
not enable network replay or alter the existing generator/rules runner. Before
any future mutating harness, verify the actual child process's SDK targets,
disable cloud credential discovery, deny outbound network, probe emulator
identity and provide teardown/kill controls. The current rules runner uses the
historical non-demo `eki-rules-test` identifier; that must be repaired/verified
in the emulator slice, not treated as accepted by this preflight.

## Audit and next implementation slices

See [the baseline audit](BASELINE_2026_10_11.md) for diagrams, gaps and risks.
Next: expand reviewed P0 test/source mappings and refine the coverage budget;
deterministic GNSS/property replay; fail-closed demo emulator ingestion/recovery;
complete passenger and admin component/browser flows; scheduled read-only CI;
measured load/mutation; separate field acceptance package.

No nightly/weekly workflow is installed in this slice. Scheduled workflows need
the default branch and separate owner approval in the supplied specification.
The existing PR CI can validate the catalog and publish static artifacts without
production credentials; historical NOT_RUN cases do not make the job fail.

The attached Edge Case Discovery checklist informs negative tests for missing,
malformed, duplicate, state/history, input boundary and external-target cases.
[Kognic's article](https://www.kognic.com/articles/edge-cases-autonomous-driving)
informs combined-fault scenarios.
[Safran's testing article](https://safran-navigation-timing.com/the-importance-of-testing-to-detect-gnss-vulnerabilities-in-intelligent-transportation-systems/)
informs the separate receiver truth/TTFF/sensitivity and RF gates. Future cases
must include plausible gradual drift and correct cold/warm/hot start setup;
HTTP coordinate replay cannot certify physical receiver resilience.
