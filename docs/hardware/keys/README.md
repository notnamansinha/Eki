# Fleet Signing Keys

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-006 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This folder is where the `esp32dev-secure` build reads the Secure Boot V2 signing key, `secure_boot_signing_key.pem`. Both `hardware/platformio.ini` (`board_build.secure_boot_signing_key`) and `hardware/sdkconfig.defaults` (`CONFIG_SECURE_BOOT_SIGNING_KEY`) name this path. This guide states the custody rules for that key. The provisioning procedure that uses it is [hardware security provisioning](../../security/HARDWARE_SECURITY_PROVISIONING.md).

## 2. Custody rules

1. The key is an RSA-3072 private key generated and kept by the university security owner in an offline or HSM-backed signing environment. Place it in this folder only inside that environment.
2. Never generate the production key on a developer laptop or in CI. CI creates a disposable key with `openssl genrsa` on every run, only to prove that the secure build compiles and that signature checks reject tampering. Nothing signed with a CI key is a fleet artifact.
3. Git ignores `keys/*.pem` and `keys/*.bin` (`hardware/.gitignore`) and every `*.pem` file (root `.gitignore`). Never force-add key material.
4. The key is not a device secret. Never copy it into `secrets.h` or pass it as a build flag.
5. Before a witnessed build, compare the key's public-key digest with the university release record:

   ```powershell
   platformio pkg exec --package tool-esptoolpy -- espsecure.py digest_sbv2_public_key --keyfile hardware/keys/secure_boot_signing_key.pem --output <digest-file>
   ```

   Secure Boot V2 burns this digest into each board, so a board accepts only images signed by the matching key.
6. Archive the digest and the signed-artifact hashes. Never archive the private key, and never archive an unencrypted firmware image: it contains device credentials.

## 3. Missing key

Without the key the secure build stops with `Secure Boot Signing Key ... does not exist. Generate using:` followed by an `espsecure.py generate_signing_key` command. Do not run that command outside the signing environment. A board first booted with an image signed by a locally generated key accepts only images signed by that key, permanently.
