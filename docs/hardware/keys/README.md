# Fleet signing keys

Place the university-controlled RSA-3072 Secure Boot V2 private key at
`secure_boot_signing_key.pem` only inside the approved offline/HSM-backed
signing environment. The repository ignores PEM and binary key material.

The key is required by `esp32dev-secure`; a missing key makes the fleet build
fail. Never create the production key in CI or on a developer laptop. CI uses a
disposable test key only to verify that the secure build remains reproducible.
