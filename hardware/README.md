# Eki (BusTrack) — GNSS Hardware Module

This directory contains the PlatformIO (C++) project for the dedicated ESP32 + NEO-M8N GNSS hardware module, which handles real-time bus tracking without relying on driver smartphones.

## Hardware Requirements
- ESP-WROOM-32 (30-Pin, CP2102)
- NEO-M8N GNSS Module with active ceramic antenna
- 12V to 5V Step-Down Converter (Buck Converter) for bus ignition power

## Pin Configuration (ESP32 to NEO-M8N)
| ESP32 Pin | NEO-M8N Pin |
|---|---|
| 5V (VIN) | VCC |
| GND | GND |
| GPIO 16 (RX2) | TX |
| GPIO 17 (TX2) | RX |

## Software Requirements
- [PlatformIO Core](https://platformio.org/) or the VSCode PlatformIO Extension.

## Build and Flash
```bash
# Build the firmware
pio run

# Upload to the connected ESP32
pio run --target upload

# Monitor the serial output (115200 baud)
pio device monitor
```

## How It Works
The hardware automatically boots when the bus ignition is turned on. It acquires a GPS lock and connects to the enterprise WiFi. Once connected, it authenticates with the backend server via a custom JWT to obtain Firebase credentials, and then begins streaming optimized location deltas directly to the Firebase Realtime Database.

## Future Scaling & Security Hardening
As the fleet scales and physical access to the ESP32 modules becomes difficult, the following two features should be implemented before mass production:

### 1. Over-The-Air (OTA) Updates
To update the ESP32 firmware remotely without physically plugging a USB cable into each bus module:
- Implement `ArduinoOTA` in the firmware.
- Use the `DEVICE_SECRET` as the OTA password to prevent unauthorized firmware flashes.
- Configure `platformio.ini` with `upload_protocol = espota` and the target IP address.

### 2. Physical Tamper Resistance (Flash Encryption & Secure Boot)
To protect the firmware and `DEVICE_SECRET` from being extracted if someone physically steals the module or desolders the flash memory chip:
- **Secure Boot V2**: Cryptographically sign your firmware so the ESP32 refuses to boot malicious code. 
- **Flash Encryption**: Encrypt the flash memory contents.
> **Warning**: Both of these features require burning eFuses on the ESP32 via `esptool.py`. This is an **irreversible** hardware process. If done incorrectly, or if you lose the signing keys, the ESP32 will become permanently bricked. Proceed with caution and test on spare modules first.
