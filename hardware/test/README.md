# Firmware Tests

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-005 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This guide lists the host-side firmware tests, how to run them and what each covers. None of them needs a board. They do not establish physical radio, UART, GNSS, power, TLS interoperability or fleet security acceptance; those need the board procedures in the [hardware guide](../README.md) and the [test strategy](../../docs/testing/TEST_STRATEGY.md).

## 2. Run the tests

Run the commands from the repository root with PlatformIO Core 6.2.0.

| Command | What it runs |
|---|---|
| `platformio test --project-dir hardware -e native` | All Unity suites in this folder. The first run downloads Unity, TinyGPSPlus and ArduinoJson into `hardware/.pio/`. |
| `platformio test --project-dir hardware -e native --filter test_http_response` | One suite, selected by name |
| `npm run qa:native` | The same suites, recorded as evidence in `artifacts/qa/` (`native-report.json`, `native-report.md`, `native-junit.xml`, `native-run.log`). It refuses any PlatformIO version other than 6.2.0. |
| `python hardware/scripts/test_host_protocols.py` | Real-library protocol checks (Section 4). Run the native suites first: the script uses their TinyGPSPlus download. It needs `gcc` and `g++` on `PATH`, and downloads the checksum-pinned Mbed TLS 2.28.7 source into `hardware/.pio/host-protocols/`. |
| `python hardware/scripts/test_verify_secure_fleet.py` | The fleet pre-build check `scripts/verify_secure_fleet.py` against temporary copies of the configuration |
| `python hardware/scripts/test_signed_image.py --esptool-dir "$env:USERPROFILE\.platformio\packages\tool-esptoolpy" --fixture` | Secure Boot V2 signature checks on a disposable signed fixture |

CI runs the native suites, the host protocol checks, the fleet check tests and the signed-image check. For the signed-image check, CI passes `--image hardware/.pio/build/esp32dev-secure/firmware-signed.bin` and `--key` with its disposable key instead of `--fixture`.

## 3. Native suites

Each suite is a folder with a `test_main.cpp` that includes production headers from `../include/`.

| Suite | Covers |
|---|---|
| `test_telemetry_policy` | Distance and heading maths; fix freshness, coordinate, speed and HDOP checks; receiver silence across `millis()` rollover; motion hysteresis; timing constants; retry backoff and `Retry-After`; HTTP outcome classification; retry and send-time freshness; configuration validation, including the unedited template failing at boot; GNSS UTC conversion and clock corroboration; Wi-Fi retry and LED codes; capture decisions; travel envelope, re-anchoring and outlier rejection; queue ordering, acknowledgement, overflow, expiry and RTC integrity |
| `test_checkpoint_journal` | Cold-boot recovery with the original sequence, torn writes at every byte offset, interrupted page erase, ring and generation wraparound, corruption and identity mismatch, unknown write outcomes, read and codec failures, and precedence of a warm RTC queue. It uses a deterministic codec stand-in, not AES-GCM. |
| `test_firmware_update_policy` | Manifest validation, signed version and sequence binding, update gates, check schedule and abort on motion or stale fix |
| `test_http_response` | Accepted-body length rules, fragmented and zero-length bodies, peer close, framing that prevents reuse, trailing bytes, the single drain deadline, slow drip, rollover and stream failures |
| `test_http_reuse_guard` | Closing the transport on buffered data before the first request write, and releasing the guard cleanly |
| `test_json_payload` | Allocator exhaustion, missing fields and small buffers never produce a partial payload |
| `test_reset_stats` | Reset counters: fresh boot, configuration change, corruption, out-of-range reasons and saturation |
| `test_dns_resolution_policy` | DNS slot sharing, deadlines, owner retention, stale completions, network epochs, invalid hostnames and rollover |
| `test_bounded_dns_resolver` | The production resolver with the stubs in `test_bounded_dns_resolver/stubs/`: cache hits, stalled DNS and TCP/IP queues, queue rejection, DNS failure, offline admission, and disconnect and reconnect |

Use the runner output for the number of cases at a given commit.

## 4. Host protocol checks

`test_host_protocols.py` builds three programs from `hardware/test-support/`:

| Program | Checks |
|---|---|
| `crypto/checkpoint_crypto.cpp` | The production AES-256-GCM checkpoint codec with real Mbed TLS: round trip, rejection of every single-byte tamper, key and configuration isolation, fresh nonces, journal recovery of the previous authenticated record, and refusal to write while the radio is off |
| `nmea/nmea_parser.cpp` | Pinned TinyGPSPlus with the production freshness policy: fragmented GN RMC and GGA sentences, bad checksums, no-fix expiry and reacquisition, `millis()` rollover |
| `tls/tls_profile.cpp` | The production `src/tls_profile.cpp` with real Mbed TLS: the ECDHE-RSA, AES-GCM and P-256 restriction with certificate verification kept, distinct single-use prepared keys, and fallback to normal ECDH |

Radio entropy and FreeRTOS task identity are deterministic host adapters. ESP32 hardware acceleration, certificate and hostname handling in `WiFiClientSecure`, and physical flash writes still need board acceptance.
