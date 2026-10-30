# Firmware Headers

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-004 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This folder holds the firmware's configuration template and its header-only policies. Both the board build (`src/CMakeLists.txt` adds this folder to the include path) and the `native` test environment compile these headers. Policy headers include only the C++ standard library (and ArduinoJson for `json_payload.h`), so the host tests run the same code that the board runs. Behaviour is specified in the [hardware telemetry contract](../../docs/hardware/HARDWARE_TELEMETRY.md); tests are described in the [firmware tests](../test/README.md) guide.

## 2. Configuration

| File | Contents |
|---|---|
| `secrets.example.h` | Tracked template that defines `WIFI_SSID`, `WIFI_PASS`, `DEVICE_ID`, `DEVICE_SECRET`, `BACKEND_URL` and `BACKEND_ROOT_CA` with placeholder values |
| `secrets.h` | Ignored copy of the template with the device's real values. The firmware's only configuration source. |
| `firmware_config.h` | Boot validation of the six definitions, the length limits (`DEVICE_ID` 128, `DEVICE_SECRET` 20 to 128, `BACKEND_URL` 256, `BACKEND_ROOT_CA` 3,072 bytes) and the name of the first invalid definition |

The value rules and the procedure that fills `secrets.h` are in the [hardware guide](../README.md#43-compile-time-configuration-file). Never put real credentials in `secrets.example.h`.

## 3. Policy headers

| Header | Contents | Native suite |
|---|---|---|
| `telemetry_policy.h` | Timing constants, fix freshness and range checks, HDOP limit, adaptive travel envelope, re-anchoring, motion hysteresis, capture decision, HTTP outcome classification, retry and `Retry-After` delays, retry freshness, diagnostics retry | `test_telemetry_policy` |
| `telemetry_queue.h` | `NewestFirstTelemetryQueue`: the 100-sample RTC ring with newest-first delivery, acknowledgement compaction, stale-sample expiry and integrity check | `test_telemetry_policy`, `test_checkpoint_journal` |
| `clock_policy.h` | Calendar-safe UTC conversion, GNSS epoch corroboration, correction thresholds and monotonic projection | `test_telemetry_policy` |
| `connectivity_policy.h` | Wi-Fi link check and retry backoff, SSID and passphrase validation, fault codes and LED pulse patterns | `test_telemetry_policy` |
| `firmware_update_policy.h` | OTA manifest and signed-version validation, update gates, check schedule and the 5 min rollback deadline | `test_firmware_update_policy` |
| `http_response.h` | Reuse guard for the persistent telemetry socket, accepted-body length check and bounded body drain | `test_http_response`, `test_http_reuse_guard` |
| `json_payload.h` | Serializes a JSON document only when it is complete and fits the buffer | `test_json_payload` |
| `checkpoint_journal.h` | Append-only ring of 128-byte authenticated checkpoint records | `test_checkpoint_journal` |
| `reset_stats.h` | Reset-reason counters kept in RTC memory | `test_reset_stats` |
| `dns_resolution_policy.h` | Single-slot DNS state with the 1 s caller budget and network epochs | `test_dns_resolution_policy` |

## 4. Platform adapters

These headers depend on Arduino, lwIP, ESP-IDF or mbedTLS. The host tests compile them against adapters.

| Header | Contents | Host coverage |
|---|---|---|
| `bounded_dns_resolver.h` | Runs DNS on the lwIP TCP/IP thread through `tcpip_try_callback` | `test_bounded_dns_resolver` with stubs in `test/test_bounded_dns_resolver/stubs/` |
| `encrypted_checkpoint.h` | Flash storage on the `gps_log` partition (or the `coredump` fallback), the AES-256-GCM record codec, and compile-time guards for the `esp32dev-journal` build | `scripts/test_host_protocols.py` with adapters in `test-support/crypto/` |
