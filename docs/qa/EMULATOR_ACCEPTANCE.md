# Disposable Emulator Acceptance

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-005 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

`npm run test:rules` is the L2 emulator family of the [QA programme](README.md). It runs the Firestore and RTDB rules tests and the backend integration suites against disposable Firebase emulators, with real SDK reads, writes and transactions. The [test strategy](../docs/testing/TEST_STRATEGY.md) lists the eleven suites and what each covers.

## 2. Prerequisites

- Node 24, Java 21 and locked dependencies.
- Free ports: Firestore 8085, RTDB 9005, Auth 9095, hub 4405, logging 4505. The launcher stops with a message naming the port and its owner when a previous run still holds one.
- No real credentials in the environment. The safety preflight rejects them before any tooling starts.

## 3. Procedure

```powershell
npm run test:rules
```

`scripts/run-rules-emulator.mjs` then:

1. Writes `artifacts/qa/emulator-report.json` with verdict BLOCKED.
2. Runs the safety preflight and checks that the emulator ports are free.
3. Writes a temporary Firebase configuration with copies of `firestore.rules` and `database.rules.json`, the existing index file and no hosting section. The committed rule files are never modified.
4. Runs `npx --yes firebase-tools@15.14.0 emulators:exec --only firestore,database,auth --project demo-eki-qa` with `scripts/qa/run-emulator-tests.mjs` as the child.
5. The child checks the running hub targets, then runs the backend `test:rules-integration` script with Vitest, one worker, `FIREBASE_RULES_TEST=1` and the Node network guard preloaded.

Before any SDK import, `backend/src/test-support/emulatorIsolation.ts` refuses to run unless the project is `demo-eki-qa`, every emulator host is the expected loopback port, `EKI_QA_CONFIRM_DISPOSABLE=1` and `EKI_QA_EXTERNAL_PROVIDERS=mock` are set, no real credential variable is present and the network guard is active. Suites use separate `demo-eki-*` namespaces and run sequentially.

Deadlines: the Vitest child stops after 4 minutes and the launcher after 6 minutes. The nightly campaign allows 390 s.

## 4. Telemetry chain suite

`qaTelemetryChain.integration.test.ts` mounts the real device router and bounded JSON parser on an ephemeral loopback port. Device credential checks, payload parsing, the RTDB transaction, route watcher, trip worker, public projection and Firestore lifecycle all run against the emulators. Firebase initialisation is injected; database operations are real. Google route computation throws if called; route geometry and identities are synthetic.

It asserts that unauthorised, forged and oversized requests change nothing; that a valid device fix creates presence without inventing passenger service; that response timing headers are present; that duplicate and delayed old samples are handled; and that ride identity, activation and the public projection are durable. It does not exercise every global middleware or the production bootstrap.

## 5. Evidence

The child writes `emulator-vitest.json`, `emulator-junit.xml`, `emulator-report.json`, `emulator-report.md` and `emulator-run.log` under `artifacts/qa/`, with the source commit, dirty flag, counts and running emulator targets. The verdict changes from BLOCKED only when every observed assertion passes without a skip. CI uploads the files with seven-day retention, including failed runs. Passing tests give `PARTIAL` status to the links in `qa/emulator-test-map.mjs`.

Teardown drains route processing, stops workers, closes HTTP connections and terminates the Firestore client. The Firebase CLI stops the emulators. On Windows the launcher also stops emulator JVMs that outlive the run. No real account or shared cloud data is created or deleted.

## 6. Troubleshooting

| Symptom | Cause and action |
|---|---|
| `SocketException: Invalid argument: connect` during Java startup on Windows | The emulator cannot open its Unix domain socket in this environment. The run is BLOCKED, not passed. Use the Linux CI run as evidence |
| A port is reported as held by another process | A previous run left an emulator running. Stop that process and run again |
| `npm test` passes but no emulator test ran | The suites are declared with `describe.skip` unless `FIREBASE_RULES_TEST=1`. Run `npm run test:rules` |

## 7. Limits

The network guard covers Node sockets, TLS, HTTP/2 and DNS in the test process; it is not an operating-system sandbox and does not cover native subprocesses. Dependency downloads by `npx` happen before the guarded child starts. The family does not cover browsers, OAuth, Google Maps, deployed configuration or any physical hardware.
