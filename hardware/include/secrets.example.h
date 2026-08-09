#pragma once

/**
 * Copy to secrets.h and replace every placeholder. secrets.h is gitignored.
 * Never commit Wi-Fi credentials, device secrets, or production endpoints.
 */
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASS "YOUR_WIFI_PASSWORD"

// Unique WPA2 password for the local recovery access point. Do not reuse the
// device API secret or a campus Wi-Fi password.
#define RECOVERY_AP_PASSWORD "GENERATE_UNIQUE_RECOVERY_PASSWORD"

// Stable identity registered in the backend devices collection.
#define DEVICE_ID "device_01"
#define DEVICE_SECRET "GENERATE_AT_LEAST_20_RANDOM_CHARACTERS"

// HTTPS is mandatory. This may be a university URL or an approved HTTPS tunnel
// to the backend running on the demo laptop.
#define BACKEND_URL "https://your-backend.example"
static constexpr char EKI_BACKEND_ROOT_CA[] = R"EOF(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_THE_CA_THAT_ISSUED_THE_BACKEND_CERTIFICATE
-----END CERTIFICATE-----
)EOF";
#define BACKEND_ROOT_CA EKI_BACKEND_ROOT_CA
