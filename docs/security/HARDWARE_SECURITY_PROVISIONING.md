# Hardware Security Provisioning

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-SEC-005 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This procedure provisions a production tracker with the `esp32dev-secure` firmware environment, and releases signed application updates to provisioned trackers. Secure Boot V2 and release-mode flash encryption burn ESP32 eFuses that cannot be reset. Run the procedure first on clearly labelled spare boards, with two authorized operators present. Never run a fleet upload against an unidentified serial port.

The fleet build enforces these protections:

| Protection | Enforced by |
|---|---|
| Secure Boot V2 with an RSA-3072 signing key; signed bootloader and application | `sdkconfig.defaults`, compile-time checks in `src/main.cpp`, pre-build check `scripts/verify_secure_fleet.py` |
| Release-mode flash encryption with a key generated on the device | `sdkconfig.defaults`; the `gps_log` journal partition is marked `encrypted` |
| UART ROM download mode permanently disabled after first boot | `CONFIG_SECURE_DISABLE_ROM_DL_MODE=y` |
| JTAG left disabled by the bootloader during secure provisioning | `CONFIG_SECURE_BOOT_ALLOW_JTAG` not set; the pre-build check rejects enabling it in the defaults or the effective configuration |
| Two OTA application slots with bootloader rollback | `partitions_secure.csv`, `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y` |
| Wi-Fi driver state kept in RAM | `CONFIG_ESP32_WIFI_NVS_ENABLED` not set; `WiFi.persistent(false)` before the driver starts |
| HTTPS backend only | Compile-time check and boot check of `BACKEND_URL` |
| Runtime gate | At boot, after the `secrets.h` checks and before it starts networking, the firmware halts with four LED pulses unless flash encryption and Secure Boot both report active |

Hardware, build environments and the development flashing procedure are in the [hardware guide](../../hardware/README.md). Telemetry behaviour is in the [hardware telemetry contract](../hardware/HARDWARE_TELEMETRY.md).

## 2. Roles and key custody

| Role | Responsibility |
|---|---|
| University security owner | Generates and keeps the RSA-3072 Secure Boot V2 signing key in an offline or HSM-backed signing environment; approves releases |
| Hardware operator | Receives signed artifacts, records each board's revision, MAC address and device ID, and performs the witnessed flash and acceptance steps |
| Second operator | Witnesses every irreversible step and signs the acceptance record |

The [fleet signing keys](../../hardware/keys/README.md) guide states the key custody rules. CI generates a disposable key on every run only to prove that the secure build compiles and that signature checks reject tampering; a CI artifact is never a fleet artifact. The flash-encryption key is generated on each device by the bootloader and is never exported or reused.

## 3. Prerequisites

- An ESP32 board of silicon revision ECO3 (v3.0) or newer. Secure Boot V2 requires it, and `CONFIG_ESP32_REV_MIN_3=y` builds images that require it.
- The approved signing environment, with PlatformIO Core 6.2.0, the repository at the reviewed commit, and the signing key at `hardware/keys/secure_boot_signing_key.pem`.
- A device provisioned in the backend registry and its one-time secret ([hardware guide, step 2](../../hardware/README.md#52-steps)).
- A backend reachable over `https://` with an RSA certificate that chains to the root CA you compile into `BACKEND_ROOT_CA`.
- A stable power supply for the board throughout flashing and first boot.

## 4. Preflight on a spare board

1. Confirm the serial port, the board label, the power source and the ESP32 revision.

   Expected result: both operators agree on which board is connected to `<port>`.

2. Save the eFuse summary before any write.

   ```powershell
   platformio pkg exec --package tool-esptoolpy -- espefuse.py --port <port> summary
   ```

   Expected result: both operators confirm that the board is unused and that `ABS_DONE_1`, `FLASH_CRYPT_CNT`, `UART_DOWNLOAD_DIS` and `JTAG_DISABLE` are in their unprogrammed state. Keep the output: after first boot, ROM download mode is disabled and `espefuse.py` can no longer read this board.

3. Confirm the signing-key fingerprint against the university release record.

   ```powershell
   platformio pkg exec --package tool-esptoolpy -- espsecure.py digest_sbv2_public_key --keyfile hardware/keys/secure_boot_signing_key.pem --output <digest-file>
   ```

   Expected result: the digest matches the recorded value. This is the public-key digest that Secure Boot V2 burns into the board.

4. Create the device-specific `hardware/include/secrets.h` from the template with the six definitions in the [hardware guide](../../hardware/README.md#43-compile-time-configuration-file). Never print the file or pass its values as command-line build flags.

5. Run the native tests and both firmware builds.

   ```powershell
   platformio test --project-dir hardware -e native
   platformio run --project-dir hardware -e esp32dev
   platformio run --project-dir hardware -e esp32dev-secure
   ```

   Expected result: all tests pass and both builds report `SUCCESS`. The secure build produces `hardware/.pio/build/esp32dev-secure/firmware-signed.bin`. The pre-build check stops the build if a security option, the release sequence, `PROJECT_VER`, the partition layout or one of the six `secrets.h` definitions is wrong.

6. Record the SHA-256 hashes of the signed bootloader, the signed application and the partition table, together with the source commit, the PlatformIO version and the key digest. Keep the signed application only in the approved encrypted signing environment: it contains the Wi-Fi passphrase and device secret in plaintext until the device encrypts its flash.

## 5. Irreversible first boot

Secure Boot excludes the bootloader from the ordinary upload, so the bootloader is written in a second transfer. In `espressif32@7.0.1` the `bootloader` target selects the signed bootloader image for the `upload` target that follows it; the platform has no `upload-bootloader` target. Both uploads skip the automatic reset, so neither image starts between the transfers.

1. Write the signed application and the partition table.

   ```powershell
   platformio run --project-dir hardware -e esp32dev-secure --target upload --upload-port <port>
   ```

   Expected result: esptool verifies each written image, and PlatformIO prints `Warning! The target won't be reset after uploading the binary in the Secure Boot mode!`.

2. Write the signed bootloader.

   ```powershell
   platformio run --project-dir hardware -e esp32dev-secure --target bootloader --target upload --upload-port <port>
   ```

   Expected result: esptool writes and verifies the bootloader image; the board is not reset.

3. Start the serial capture, then reset the board once. Keep power uninterrupted until the application has started.

   ```powershell
   platformio device monitor --project-dir hardware --port <port>
   ```

   Expected result: the complete first-boot log, including the bootloader's Secure Boot and flash-encryption steps, followed by application start with no four-pulse halt. Power loss during this boot is an acceptance failure: quarantine the board for review.

4. Verify the protections from the running application. At least 30 s after boot, an administrator calls `GET /api/devices/<device-id>/diagnostics`.

   Expected result: `flashEncryption` and `secureBoot` are both `true`, and `lastTelemetryResponseCode` is `202` or `200`.

5. Remove the plaintext `secrets.h` and any unencrypted intermediate artifact from the signing workspace according to the university key-handling policy.

JTAG evidence has a gap. ESP-IDF's bootloader disables JTAG during secure provisioning, and the fleet configuration keeps `CONFIG_SECURE_BOOT_ALLOW_JTAG` unset, but this configuration does not prove that an individual board was provisioned. After first boot, ROM download mode is disabled, so the procedure has no tool path to read `JTAG_DISABLE`. Record the first-boot bootloader log as the available evidence and note this limitation in the acceptance record. A development board is never security-provisioning evidence.

## 6. Signed OTA release and rollback

The device-side update policy (check schedule, installation gates, reservation and five-minute rollback) is in the [hardware guide](../../hardware/README.md#9-firmware-updates).

Limitation: the signed application image contains every value compiled from `secrets.h`, including the Wi-Fi passphrase, device ID and device secret. The backend serves one release descriptor to every device that checks for updates. A release therefore installs the configuration of the build that produced it on every device that accepts it. Flash encryption protects the image only once it is on a device, so anyone who can download the published file can read those credentials. Do not configure a release on a backend that serves more than one device, and protect the published file as you would the device secret.

1. Increment `EKI_FIRMWARE_SEQUENCE` in `[env:esp32dev-secure]` of `hardware/platformio.ini`, and set `PROJECT_VER` in `hardware/CMakeLists.txt` to `s<sequence>-<name>`. The backend accepts a name of 1 to 19 characters from `A-Z`, `a-z`, `0-9`, `.`, `_` and `-` that starts with a letter or digit. The pre-build check requires the two values to agree. Never reuse a sequence, a version or a release URL.

   Expected result: the secure build succeeds; a mismatch stops it with `PROJECT_VER must use s<sequence>-<name> and match EKI_FIRMWARE_SEQUENCE.`

2. Build with the university key, then measure the signed application.

   ```powershell
   platformio run --project-dir hardware -e esp32dev-secure
   (Get-Item hardware/.pio/build/esp32dev-secure/firmware-signed.bin).Length
   Get-FileHash -Algorithm SHA256 hardware/.pio/build/esp32dev-secure/firmware-signed.bin
   ```

   Expected result: a size of at most 1,966,080 bytes and a SHA-256 digest.

3. Publish the exact signed file at an immutable `https://` URL. The host must present an RSA certificate that chains to `BACKEND_ROOT_CA`. Do not put credentials in the URL.

4. Set all six backend values together: `FIRMWARE_RELEASE_VERSION`, `FIRMWARE_RELEASE_SEQUENCE`, `FIRMWARE_RELEASE_URL`, `FIRMWARE_RELEASE_ALLOWED_ORIGIN`, `FIRMWARE_RELEASE_SHA256` and `FIRMWARE_RELEASE_SIZE` ([configuration](../CONFIGURATION.md)).

   Expected result: release checks return the descriptor. A partial or malformed set makes release checks return `503`; leaving all six unset disables OTA (`204`).

5. Prove on a spare board that:
   - a bus with an active ride receives `204`;
   - a modified image or an image signed with another key is rejected;
   - a healthy candidate is confirmed after accepted telemetry or diagnostics;
   - a candidate that cannot reach the backend rolls back within 5 min.

   The validation timer runs without Wi-Fi as well, so a healthy candidate installed just before a coverage gap can roll back. Install in a depot with stable backend access, and record a deliberate post-update outage trial.

6. To stop distribution, unset all six values. Keep earlier signed artifacts, descriptors and rollback evidence, and never reuse their sequence numbers.

A firmware reservation (`_active_bus_locks/<bus-id>` with `kind: "firmware"`) has no timed expiry. If a board is lost during an installation, establish that it no longer writes flash before you delete its reservation. Never delete a ride lock.

## 7. Configuration and credential rotation

There is no local configuration or recovery service. Each device's Wi-Fi credentials, device ID and secret, backend origin and root CA are compiled into its signed, flash-encrypted image. The [hardware guide](../../hardware/README.md#6-changes-that-require-a-reflash) lists which changes need a reflash.

1. Rotate the device secret or device ID outside an active ride with `npm run provision-device --workspace=backend -- --device-id <device-id> --bus-id <bus-id> --route-id <route-id>`. Capture the one-time secret without putting it in shell history, tickets, screenshots or source control.
2. Rebuild the complete device-specific `esp32dev-secure` image in the signing environment (Section 4, steps 4 to 6).
3. Reflash a provisioned board only through a path its security state allows. With ROM download mode disabled, the USB upload in Section 5 no longer works on that board; the OTA path in Section 6 carries the new configuration, subject to its limitation.
4. Restart the device and confirm accepted telemetry.

If the compiled ID and secret are correct but the backend record is disabled or mis-assigned, repair the record and restart the device without reflashing. A `401` latches publishing off and switches the radio off until the board restarts. A valid but unassigned device receives `403` and retries every 60 s with Wi-Fi on.

## 8. Acceptance evidence

For each spare-board rehearsal and each production unit, keep:

- board revision, MAC address, device ID, source commit, artifact hashes and signing-key digest;
- the preflight eFuse summary and the complete first-boot serial log;
- cold-boot evidence that only the signed image runs and both protections stay active;
- a successful device-specific build, accepted telemetry, remote diagnostics, credential rotation and lost-device disablement;
- failure evidence for a wrong secret, a malformed configuration and an artifact signed by an untrusted key;
- operator names, date, anomalies, quarantined boards and approval signatures.

A compile, emulator or native test result never closes a checklist item or a hardware security issue. Physical spare-board evidence is required.

## 9. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Build stops: `Secure Boot Signing Key ... does not exist. Generate using:` | The key is not in the signing environment | Install the approved key. Do not follow ESP-IDF's suggestion to generate one ([fleet signing keys](../../hardware/keys/README.md)). |
| Build stops with `Fleet build security options are missing ...` or `... must be disabled ...` | `sdkconfig.defaults` or the generated `hardware/sdkconfig.esp32dev-secure` was changed | Restore the committed `sdkconfig.defaults`; if the generated file still differs, delete it so the build regenerates it |
| Build stops with `include/secrets.h is missing required definitions` | Incomplete `secrets.h` | Add all six definitions |
| Upload cannot connect to a provisioned board | ROM download mode is disabled after first boot | Expected. Use the OTA path, or quarantine the board. |
| Four LED pulses after first boot | Flash encryption or Secure Boot is not active, or `BACKEND_URL` is not `https://` | Quarantine the board and review the first-boot log. Never bypass the gate. |
| Candidate image rolls back | No accepted telemetry or diagnostics within 5 min of boot | Check backend reachability, the artifact host certificate and the device credential; retry from a depot |

## 10. References

[1] Espressif Systems, "Secure Boot v2," ESP-IDF Programming Guide v4.4, docs.espressif.com/projects/esp-idf/en/v4.4/esp32/security/secure-boot-v2.html. Accessed: 2026-10-30.

[2] Espressif Systems, "Flash Encryption," ESP-IDF Programming Guide v4.4, docs.espressif.com/projects/esp-idf/en/v4.4/esp32/security/flash-encryption.html. Accessed: 2026-10-30.
