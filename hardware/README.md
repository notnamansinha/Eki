# ESP32 + GNSS hardware

## Wiring

| ESP32 | NEO-M8N |
|---|---|
| 5V/VIN | VCC |
| GND | GND |
| GPIO 16 (RX2) | TX |
| GPIO 17 (TX2) | RX |

Power the ESP32 through a fused automotive 12 V-to-5 V buck converter and
place the active GNSS antenna where it has a clear sky view.

## Configure, build, and flash

```bash
Copy-Item include/secrets.example.h include/secrets.h
platformio run --project-dir .
platformio run --project-dir . --target upload
platformio device monitor --baud 115200
```

Fill `secrets.h` with Wi-Fi, device ID/secret, HTTPS backend origin, and the CA
certificate that issued the backend hostname certificate. The file is ignored
by Git.

Firmware sends exactly six telemetry fields over certificate-verified HTTPS.
It never receives Firebase credentials or bus/route identity. HTTP 200 means a
duplicate timestamp was safely ignored; HTTP 202 means a new sample was
accepted. HTTP 401 indicates device credential/registry mismatch, 429 indicates
rate limiting, and TLS errors indicate clock/hostname/CA problems.

Do not enable insecure TLS. Before fleet rollout, the university must design
signed OTA with rollback and provision Secure Boot V2/flash encryption on
spare boards before irreversible eFuse operations.
