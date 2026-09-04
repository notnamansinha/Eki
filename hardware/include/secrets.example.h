#pragma once

// Copy this file to secrets.h and replace every placeholder. secrets.h is
// ignored by Git. Configuration changes require rebuilding and reflashing.
#define WIFI_SSID "replace-with-wifi-name"
#define WIFI_PASS "replace-with-wifi-password"
#define DEVICE_ID "replace-with-device-id"
#define DEVICE_SECRET "replace-me"
// Use a stable hostname. Trust its issuing root CA rather than its renewable
// leaf certificate so normal certificate renewal does not require reflashing.
#define BACKEND_URL "https://replace-with-stable-backend-host"
#define BACKEND_ROOT_CA \
  "-----BEGIN CERTIFICATE-----\n" \
  "replace-with-issuing-root-ca\n" \
  "-----END CERTIFICATE-----"
