# ESP32 fleet security and provisioning

This is the mandatory physical acceptance procedure for production trackers.
Secure Boot V2 and release-mode flash encryption burn irreversible ESP32
eFuses. Run it first on clearly labelled spare ECO3-or-newer boards, with two
authorized operators present. Never run fleet upload commands against an
unidentified serial port.

## Roles and key custody

- The university security owner generates and retains the RSA-3072 Secure Boot
  V2 signing key in an offline or HSM-backed signing environment.
- The hardware operator receives signed release artifacts, records each board's
  serial/MAC/device ID, and performs the witnessed flash and acceptance steps.
- CI may generate a disposable signing key only to prove that the secure build
  compiles. A CI artifact is never a fleet artifact.
- The flash-encryption key is generated uniquely on-device by the ESP-IDF
  bootloader. Do not export or reuse it.

## Preflight on a spare board

1. Confirm the exact serial port, board label, power source, and ESP32 revision.
   Secure Boot V2 requires ESP32 ECO3 or newer.
2. Save `espefuse.py summary` output before any write. Both operators must
   confirm that the board is unused and that the expected security eFuses are
   not already in a conflicting state.
3. Confirm the signing-key fingerprint against the university release record.
   Place the private key at
   `hardware/keys/secure_boot_signing_key.pem` only inside the approved signing
   environment.
4. Run the native tests and both firmware builds:

   ```powershell
   platformio test --project-dir hardware -e native
   platformio run --project-dir hardware -e esp32dev
   platformio run --project-dir hardware -e esp32dev-secure
   ```

5. Archive the secure bootloader, signed application, partition table, hashes,
   source commit, PlatformIO version, and signing-key fingerprint. Do not
   archive the private key.

## Irreversible first boot

The `esp32dev-secure` environment is the only fleet environment. Its committed
configuration enables Secure Boot V2, signed binaries, release-mode flash
encryption, ROM-download lockdown, RAM-only Wi-Fi driver state, and a larger
bootloader-safe partition offset. The firmware refuses fleet operation unless
both hardware protections report active and the backend origin is HTTPS.

With both operators watching the selected spare-board port, upload the secure
application/partition images first, then the signed bootloader through
PlatformIO's explicit secure-boot target. Secure Boot intentionally excludes
the bootloader from the ordinary upload command, and the Arduino/ESP-IDF 4.4
combination does not retain the newer automatic-bootloader sdkconfig switch.
Keep uninterrupted power throughout both transfers and the first boot:

```powershell
platformio run --project-dir hardware -e esp32dev-secure --target upload
platformio run --project-dir hardware -e esp32dev-secure --target sign --target upload-bootloader
# Only after both commands succeed, power-cycle the selected spare board.
platformio device monitor --project-dir hardware --baud 115200
```

Both upload targets suppress their automatic reset so neither image can start
between transfers. Capture the complete first-boot log. Power loss during
first-boot encryption or eFuse provisioning is an acceptance failure;
quarantine the board for review.
The application must report `fleet-build=yes`, `flash-encryption=enabled`, and
`secure-boot=enabled`. Any other combination halts before credentials are read
or networking starts.

## Compile-time configuration and rotation

There is no local configuration or recovery service. Each device's Wi-Fi,
device ID/secret, HTTPS backend origin, and issuing root CA are compiled into
its signed, flash-encrypted application image.

The only firmware configuration file is the ignored
`hardware/include/secrets.h`, copied from `secrets.example.h`. It must contain
all six definitions: `WIFI_SSID`, `WIFI_PASS`, `DEVICE_ID`, `DEVICE_SECRET`,
`BACKEND_URL`, and `BACKEND_ROOT_CA`. The backend `.env` and frontend
`env.production.example` are separate application configuration; neither is
copied into firmware. Route geometry, ordered stops, bus/route assignment,
driver identity, delay and passenger data remain backend records and do not
belong in `secrets.h`.

1. Provision the backend registry with `npm run provision-device --workspace=backend -- --device-id ... --bus-id ... --route-id ...`. Capture the one-time device secret without putting it in shell history, tickets, screenshots, or source control.
2. In the approved signing environment, copy
   `hardware/include/secrets.example.h` to the ignored
   `hardware/include/secrets.h` and set the device-specific values. Never print
   the file or pass values as command-line build flags.
3. Build the `esp32dev-secure` artifact. The build gate verifies required
   definitions, HTTPS-only fleet configuration, Secure Boot/flash-encryption
   settings, and the absence of NVS/Preferences-backed configuration and
   recovery code. The RTC no-init telemetry queue remains intentionally present.
4. Flash the selected device using the witnessed secure procedure, then remove
   the plaintext `secrets.h` and any unencrypted intermediate artifact from the
   signing workspace according to university key-handling policy.
5. Verify HTTPS telemetry and authenticated diagnostics. Confirm both reported
   hardware-security booleans are `true`.
6. For secret or device-ID rotation, create the new backend value outside an
   active ride, rebuild the complete device-specific image, physically reflash
   it, and restart the device. If the compiled ID and secret remain correct but
   a credential was disabled or its backend registry/assignment is wrong,
   repair the backend record and restart the device without reflashing. A
   401/403 latches publishing off and disables the station radio until the
   applicable repair is followed by that restart.

Changing only route geometry or assigning the unchanged device credential to a
different approved bus/route does not require a reflash. Changing Wi-Fi,
`DEVICE_ID`, `DEVICE_SECRET`, `BACKEND_URL`, or `BACKEND_ROOT_CA` does require a
new device-specific build and flash. Never change backend assignment while an
active ride or bus lock exists.

## Acceptance evidence

For each spare-board rehearsal and production unit, retain:

- board revision, MAC/serial, assigned device ID, source commit, artifact hashes,
  and signing-key fingerprint;
- witnessed preflight summary and complete first-boot serial log;
- cold-boot evidence that only the signed image runs and both protections remain
  active;
- successful device-specific configuration build, telemetry, remote
  diagnostics, signed credential reflash/revocation, and lost-device disablement;
- failure evidence for a wrong secret, malformed configuration, and an artifact
  signed by an untrusted test key;
- operator names, date, anomalies, quarantined boards, and approval signatures.

No checklist item or GitHub hardware-security issue is closed from a compile or
emulator result alone. Physical spare-board evidence is required.
