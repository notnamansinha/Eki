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
encryption, encrypted NVS, ROM-download lockdown, and a larger bootloader-safe
partition offset. The firmware itself also refuses fleet operation unless both
hardware protections report active.

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

## Local configuration and rotation

An empty device creates a random 24-character recovery password in NVS and
prints it only while the device remains unprovisioned over the controlled serial
connection. Record it in the restricted device inventory; never reuse it.

1. Provision the backend registry with `npm run provision-device --workspace=backend -- --device-id ... --bus-id ... --route-id ...`. Capture the one-time device secret without putting it in shell history, tickets, screenshots, or source control.
2. Connect to the WPA2 `Eki-Recovery-*` access point using the recorded recovery
   password and open `http://192.168.4.1`.
3. Submit Wi-Fi, device ID, one-time device secret, HTTPS backend origin, and
   issuing root CA. The form never returns stored values. The firmware validates
   and writes one versioned, checksummed NVS record, then restarts.
4. Verify HTTPS telemetry and the authenticated diagnostics endpoint. Confirm
   the server record reports both hardware-security booleans as `true`.
5. For rotation, run the backend provisioner again outside an active ride, then
   enter the complete replacement configuration through the protected local
   portal. A 401/403 automatically exposes that portal and latches publishing
   off until a valid replacement is stored.

## Acceptance evidence

For each spare-board rehearsal and production unit, retain:

- board revision, MAC/serial, assigned device ID, source commit, artifact hashes,
  and signing-key fingerprint;
- witnessed preflight summary and complete first-boot serial log;
- cold-boot evidence that only the signed image runs and both protections remain
  active;
- successful NVS provisioning, power-cycle persistence, telemetry, remote
  diagnostics, credential rotation/revocation, and lost-device disablement;
- failure evidence for a wrong secret, malformed configuration, and an artifact
  signed by an untrusted test key;
- operator names, date, anomalies, quarantined boards, and approval signatures.

No checklist item or GitHub hardware-security issue is closed from a compile or
emulator result alone. Physical spare-board evidence is required.
