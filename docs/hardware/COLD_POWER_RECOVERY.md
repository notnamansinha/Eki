# Cold Power Recovery

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-HW-002 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This procedure checks that a tracker restores its latest captured fix after complete power loss, and installs the app-only build that older development boards need for that check. Sections 1.1 and 1.2 state what recovery guarantees and how the flash journal works.

### 1.1 Guarantee and limits

- The RTC telemetry queue survives software, panic, watchdog and brownout resets ([queue rules](HARDWARE_TELEMETRY.md#44-queue-ordering-and-expiry)). Complete power loss clears it.
- After complete power loss, the firmware restores one sample: the latest authenticated flash checkpoint, with its original `seq`, so a retry stays idempotent on the backend.
- The firmware writes a checkpoint for the first captured sample after each boot, then for a captured sample at most every 10 s. Samples captured after the last successful checkpoint are lost on power loss, and failed writes widen that window. The journal records the latest live state, not every fix. Zero-loss capture would need durable storage per fix or backup power, which the repository does not provide.
- The 10 s interval is not a hard loss bound: capture cadence and flash write and erase time add to it. The firmware notifies the publisher before it writes flash, but ESP32 flash operations can pause execution; measure their timing on the board.
- A valid RTC queue always takes precedence, even when it is empty after an acknowledgement, so a warm restart never replays a checkpoint.
- Once the clock is trusted, the 55 s freshness margin discards a stale restored sample. After an outage longer than 55 s, telemetry resumes from a fresh fix.
- Ride and stop history is kept by the backend and is not affected. The firmware journal is an operational checkpoint, not ride history.

### 1.2 Journal storage and security

| Property | Value |
|---|---|
| Record | 128 bytes; 32 records per 4 KiB flash page |
| Encryption | AES-256-GCM (mbedTLS) with a 12-byte random nonce per record. The key is HMAC-SHA256 of the label `Eki GPS checkpoint key v1` keyed with `DEVICE_SECRET`. The record header (format, configuration tag, generation, sample size) is authenticated. |
| Identity | A record opens only with the same device secret and the same configuration tag (derived from `DEVICE_ID` and `BACKEND_URL`) |
| Entropy | Nonces come from the ESP32 hardware random number generator, whose entropy source in the running application is the enabled Wi-Fi radio [1]. While the radio is off, for example after a credential fault, the codec refuses to write and samples stay in RTC memory only. |
| Partition | The `gps_log` data partition: 896 KiB in the development layout, 128 KiB and marked `encrypted` in the fleet layout ([partition tables](../../hardware/README.md#42-partition-tables)) [2]. A build with flash core dumps disabled falls back to an older layout's 64 KiB `coredump` partition. |

The journal is an append-only ring. It never erases the page that holds the last committed record until a successor commits on another page. Authentication rejects partial writes, corruption and records from another configuration. A write whose outcome is unknown consumes a new slot and generation on retry. A read failure disables journal writes, and a codec failure leaves flash untouched. A missing partition or a failed write appears in the `[PowerCheckpoint]` log, and RTC operation continues.

| Journal | Records | Ring rotations per day at one write per 10 s | Erases per sector per year |
|---|---:|---:|---:|
| Fleet `gps_log`, 128 KiB | 1,024 | about 8.4 | about 3,080 |
| Development `gps_log`, 896 KiB | 7,168 | about 1.2 | about 440 |
| Legacy `coredump` fallback, 64 KiB | 512 | about 16.9 | about 6,160 |

These are workload estimates, not measured endurance. First-sample writes after frequent restarts add wear. Confirm the flash chip's rated endurance and duty cycle before fleet deployment.

## 2. Prerequisites

- The reviewed firmware installed through the normal workflow: the [hardware guide](../../hardware/README.md#52-steps) for development boards, or [hardware security provisioning](../security/HARDWARE_SECURITY_PROVISIONING.md) for fleet boards. An older development board without `gps_log` needs Section 3 first.
- A serial capture of the board, and HTTP or browser traces of the live bus.
- A way to remove all power from the board, including USB and any external supply.
- Do not erase or change a board's partition table, provision security eFuses or install a disposable signing key as part of this acceptance.

## 3. Install the app-only build on an older development board

Use this section only for an unsecured Eki development board whose partition table predates `gps_log`. The stock Arduino `esp32dev` SDK enables flash core dumps, so on that layout the firmware refuses the `coredump` fallback and reports `ready=false`; a successful build alone does not establish recovery. The `esp32dev-journal` environment rebuilds ESP-IDF with flash core dumps disabled and never inherits the fleet Secure Boot or flash-encryption settings. Compile-time checks reject the build if flash dumps or fleet provisioning are enabled, or if the partition table offset is not `0x8000`. Never remove these checks: precompiled libraries could otherwise overwrite the journal with a crash dump.

Run the commands from the repository root. `<port>` is the board's serial port; `<backup-dir>` is a folder you create for the backups.

1. Read the security eFuses.

   ```powershell
   platformio pkg exec --package tool-esptoolpy -- espefuse.py --port <port> summary
   ```

   Expected result: `ABS_DONE_1` is `False` and `FLASH_CRYPT_CNT` is `0`. If either is set, stop: a secured board needs its normal provisioning workflow.

2. Back up and decode the partition table.

   ```powershell
   platformio pkg exec --package tool-esptoolpy -- esptool.py --chip esp32 --port <port> read_flash 0x8000 0xC00 <backup-dir>/partitions.bin
   python "$env:USERPROFILE\.platformio\packages\framework-arduinoespressif32\tools\gen_esp32part.py" <backup-dir>/partitions.bin
   ```

   Expected result: `app0` at `0x10000` with size `0x300000` (3M), and `coredump` at `0x3F0000` with size `0x10000` (64K). If the layout differs, stop.

3. Back up the existing application and the `coredump` region, and check the application backup.

   ```powershell
   platformio pkg exec --package tool-esptoolpy -- esptool.py --chip esp32 --port <port> read_flash 0x10000 0x300000 <backup-dir>/app0.bin
   platformio pkg exec --package tool-esptoolpy -- esptool.py --chip esp32 --port <port> read_flash 0x3F0000 0x10000 <backup-dir>/coredump.bin
   platformio pkg exec --package tool-esptoolpy -- esptool.py --chip esp32 image_info <backup-dir>/app0.bin
   ```

   Expected result: both reads complete, and `image_info` describes a valid application image.

4. Build the app-only image.

   ```powershell
   platformio run --project-dir hardware -e esp32dev-journal
   ```

   Expected result: `SUCCESS` and `hardware/.pio/build/esp32dev-journal/firmware.bin`.

5. Write only the application, then verify it.

   ```powershell
   platformio pkg exec --package tool-esptoolpy -- esptool.py --chip esp32 --port <port> write_flash 0x10000 hardware/.pio/build/esp32dev-journal/firmware.bin
   platformio pkg exec --package tool-esptoolpy -- esptool.py --chip esp32 --port <port> verify_flash 0x10000 hardware/.pio/build/esp32dev-journal/firmware.bin
   ```

   Expected result: `Hash of data verified.` from the write and `-- verify OK (digest matched)` from the verification. Do not use `platformio run --target upload` here: it also writes the bootloader and the partition table.

6. Open the serial monitor with `platformio device monitor --project-dir hardware --port <port>`.

   Expected result: `[PowerCheckpoint] ready=true recovered=false slots=512 intervalMs=10000`, then `[PowerCheckpoint] committed=true` lines once fixes are captured.

The 64 KiB fallback holds half the records of the fleet journal (Section 1.2). It is a development compatibility path, not a fleet endurance guarantee.

## 4. Stationary power-cut acceptance

Keep the board stationary with a clear sky view throughout.

1. Start the serial capture and the HTTP or browser traces. Wait for `[PowerCheckpoint] committed=true seq=<n> writeMs=<t>`.

   Expected result: at least one committed checkpoint. Record `seq` and `writeMs`.

2. Remove all board power for about 10 s, then reconnect it.

   Expected result: `[PowerCheckpoint] ready=true recovered=true` on the cold boot. The restored sample keeps its `seq`; a newer fix may supersede it before it is sent. Compare accepted history and the current stop index before and after: no duplicate stop record and no regression to an earlier stop.

3. Repeat with an outage longer than 55 s.

   Expected result: after clock synchronization the restored sample is dropped as stale (`[Telemetry] Dropped 1 stale queued sample(s).`) and fresh telemetry resumes. Durable history is unchanged, and the user interface marks the interruption and then returns to live state.

4. Perform an ordinary software reset after the queue has been acknowledged.

   Expected result: `[PowerCheckpoint] ... recovered=false`. The valid, empty RTC queue takes precedence and no checkpoint is replayed.

5. Collect the worst-case `writeMs` and the GNSS UART and checksum counters from remote diagnostics during flash erases.

   Expected result: no growth in `uartBufferOverflows` or `uartFifoOverflows` caused by flash writes.

## 5. Verification

CI builds the firmware but never flashes boards or changes eFuses. The native suite `test_checkpoint_journal` discards all volatile and RTC state, interrupts writes at every byte boundary, interrupts an old-page erase, wraps the ring and the generation counter, corrupts records, changes the configuration, exhausts failing writes, and checks stale and warm recovery. It uses a deterministic stand-in for the codec, so it verifies journal logic, not AES-GCM. The host protocol test `hardware/scripts/test_host_protocols.py` runs the real AES-GCM codec against tampered records ([firmware tests](../../hardware/test/README.md)).

Electrical power cuts, real flash wear and latency, and GNSS UART continuity during flash operations need the board procedure in Section 4. Simulations cannot certify them.

## 6. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `[PowerCheckpoint] ready=false slots=0` | No `gps_log` partition, and no usable `coredump` fallback because flash core dumps are enabled | Use Section 3, or flash the full development layout through the [hardware guide](../../hardware/README.md#52-steps) |
| `[PowerCheckpoint] committed=false` | A flash write or erase failed, or the codec could not seal the record | Record it. Do not claim a 10 s loss window while writes fail. Repeat and compare `writeMs`. |
| `recovered=false` after a full power cut | No committed checkpoint before the cut, a changed `DEVICE_SECRET`, `DEVICE_ID` or `BACKEND_URL`, or the RTC queue survived because power was not fully removed | Wait for `committed=true` before the cut; remove every power source |

## 7. References

[1] Espressif Systems, "Random Number Generation," ESP-IDF Programming Guide v4.4, docs.espressif.com/projects/esp-idf/en/v4.4/esp32/api-reference/system/random.html. Accessed: 2026-10-30.

[2] Espressif Systems, "Flash Encryption," ESP-IDF Programming Guide v4.4, docs.espressif.com/projects/esp-idf/en/v4.4/esp32/security/flash-encryption.html. Accessed: 2026-10-30.
