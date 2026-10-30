# Deterministic GNSS Properties

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-008 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

`npm run qa:gnss` is an L1 family of the [QA programme](README.md). It checks the telemetry payload validator and the trip reducer with fixed-seed generated inputs and records exact assertion identities. It uses no emulator, network, real provider, vehicle or model API.

## 2. Procedure

Run from the repository root:

```powershell
npm run qa:gnss
```

`scripts/qa/run-gnss.mjs` runs `backend/src/services/qaGnssProperties.test.ts` and `qaTelemetrySequences.test.ts` with Vitest, one worker and a 2-minute deadline. The ordinary backend test suite runs the same files. Results are written to `artifacts/qa/gnss-vitest.json`, `gnss-junit.xml`, `gnss-report.json`, `gnss-report.md` and `gnss-run.log`, and CI keeps them for seven days.

## 3. Inputs

`docs/testing/simulations/generate-gnss.mjs` generates the fixtures. It defines twenty profiles: `moving`, `reverse`, `stationary`, `jitter`, `stop-start`, `duplicate`, `reorder`, `burst`, `outage45`, `outage120`, `outage301`, `teleport`, `poor-hdop`, `uncertain`, `missing-hdop`, `invalid-speed`, `invalid-heading`, `stale`, `future` and `wrong-fields`. The acceptance catalog fails if this list and the plan's simulation table differ. The generator honours a supplied seed of zero and rejects a count of zero. Custom reverse geometry must already be ordered and use the `moving` profile.

The generator also has an opt-in HTTP replay mode. Do not use it: its loopback check alone does not prove backend isolation.

## 4. Assertions

- Exact boundaries for latitude, longitude, speed, heading, HDOP and sequence; malformed numeric types; the six-, eight- and nine-field payload schemas; the case-sensitive motion enumeration; capture and send clock normalisation; and 511, 512 and 513-byte bodies, including UTF-8.
- Every profile is deterministic and its transport rejections are classified. `teleport` is transport-valid but motion-invalid; `poor-hdop` is transport-valid but cannot support early reacquisition.
- Travel-envelope cases use independent equatorial metre offsets, and antimeridian and pole distances are checked without calling the production distance function for the expected value.
- Four seeded payload, motion and recovery properties and one ordering property each run 400 examples, seed 42 by default. The ordering property compares the production reducer with a separate lexicographic timestamp and sequence model, including shuffled duplicates, reset sequences and lifecycle preservation.
- Compound trace walks check raw versus accepted anchors, pending two-fix recovery, acceptance on the third fix, assignment retirement and retained ride state. These are reducer observations, not database commits.

`qa/gnss-test-map.mjs` links assertions to requirement IDs. A passing run gives those requirements `PARTIAL` status; it completes no feature case.

## 5. Reproducing a failure

A failing property reports its seed, the generation index (`replayPath`), and the original and reduced input. Replay it:

```powershell
$env:EKI_QA_SEED = '42'
$env:EKI_QA_REPLAY_PATH = '5'
npm run qa:gnss
Remove-Item Env:EKI_QA_REPLAY_PATH
Remove-Item Env:EKI_QA_SEED
```

`EKI_QA_SEED` must be an integer from 0 to 4294967295 and `EKI_QA_REPLAY_PATH` an integer from 0 to 399; other values block the run before Vitest starts. Replay regenerates every earlier input without checking it, then checks the given index. Array traces shrink to a shorter prefix. Inputs without a shrinker keep their original counterexample and are not described as minimal.

The runner deletes stale evidence before it starts. It exits with a non-zero code on a runner error, a skipped test, an empty or inconsistent report, or a missing mapped assertion. A run from a dirty tree records that fact and cannot serve as commit evidence.

## 6. Limits

The family does not cover HTTP ingestion, emulator persistence, browser listeners or rendered markers; those belong to the L2 and L3 families. It does not establish receiver accuracy, drift or compound recovery in a moving vehicle, which need the [field acceptance package](FIELD_ACCEPTANCE.md).
