#pragma once

/**
 * Copy to secrets.h and replace every placeholder. secrets.h is gitignored.
 * Never commit Wi-Fi, MQTT credentials, private keys, or production endpoints.
 */
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASS "YOUR_WIFI_PASSWORD"

// Stable device identity. The broker ACL must allow this credential to publish
// only to MQTT_TOPIC_PREFIX/DEVICE_ID.
#define DEVICE_ID "device_01"
#define MQTT_CLIENT_ID "eki-device-01"
#define MQTT_USERNAME "device_01"
#define MQTT_PASSWORD "GENERATE_AT_LEAST_20_RANDOM_CHARACTERS"

// TLS is mandatory. Use the broker DNS hostname, not an IP address, so
// WiFiClientSecure can verify the certificate hostname.
#define MQTT_HOST "mqtt.university.example"
#define MQTT_PORT 8883
#define MQTT_TOPIC_PREFIX "eki/v1/telemetry"
#define MQTT_ROOT_CA \
  "-----BEGIN CERTIFICATE-----\n" \
  "REPLACE_WITH_THE_CA_THAT_ISSUED_THE_BROKER_CERTIFICATE\n" \
  "-----END CERTIFICATE-----\n"
