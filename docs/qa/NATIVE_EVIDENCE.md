# Native Firmware Evidence

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-011 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

`npm run qa:native` is an L1 family of the [QA programme](README.md). It runs the PlatformIO `native` environment, which executes the firmware policy suites in `hardware/test/` on the host, and records each Unity assertion by name. It uploads nothing to a board and performs no serial, flash, OTA, RF or provisioning step. The suites themselves are described in [firmware policy tests](../hardware/test/README.md).

## 2. Prerequisites

- Node 24 and locked dependencies.
- PlatformIO Core 6.2.0 available as `platformio` on `PATH`. The runner stops when `platformio --version` reports another version.
- A host C++ compiler. Without one, every native suite fails at compilation and no assertion runs.
- No production credentials are needed.

## 3. Procedure

```powershell
python -m pip install platformio==6.2.0
npm ci
npm run qa:native
```

`scripts/qa/run-native.mjs` accepts no arguments, disables PlatformIO telemetry and runs `platformio test --project-dir hardware -e native` with a 5-minute deadline. The nightly campaign allows 360 s.

## 4. Evidence

The runner writes `native-platformio.json`, `native-junit.xml`, `native-report.json`, `native-report.md` and `native-run.log` under `artifacts/qa/`, with the source commit and dirty flag.

The source census lists every literal `RUN_TEST` site in `hardware/test/` with its path and line, ignoring lookalikes in comments and strings. It does not evaluate the C++ preprocessor or computed macros. `scripts/qa/native-evidence.mjs` reconciles each observed test name and path with that census and rejects duplicates, list-only reports, missing cases and runs of any environment other than `native`. Other PlatformIO environments appear in the raw report as unselected empty suites; they are not counted.

After a failing Unity program, PlatformIO adds a separate runner-error row. The collector keeps it as a diagnostic so it cannot hide the assertion failures. The verdict is green only when the runner exits cleanly, every discovered assertion passes and there is no diagnostic.

`qa/native-test-map.mjs` links assertions to parts of FW02 to FW09, FW11 to FW13, FW15 and FW18 to FW20. A pass gives those requirements `PARTIAL` status. FW01, FW10, FW14, FW16, FW17, FW21 and FW22 have no native mapping.

In Production verification the `firmware` job runs `qa:native` and uploads `native-firmware-evidence` for the `qa-evidence` job. The nightly workflow runs it as the `native` shard.

## 5. Limits

The checkpoint journal tests use a deterministic stand-in for authenticated encryption; they do not establish AES-GCM security or real flash and power-loss behaviour. The CI `firmware` job exercises the real checkpoint cryptography, TLS wrapper and NMEA parser separately with `hardware/scripts/test_host_protocols.py`, and builds every board environment.

Receiver and UART task ownership, power interruption, RTC retention, storage layout, watchdog and reset timing, TLS over radio, firmware installation, protected boot and eFuse behaviour need the [field acceptance package](FIELD_ACCEPTANCE.md). A green native run does not establish release or field readiness.
