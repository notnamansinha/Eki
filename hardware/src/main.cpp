#include "secrets.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <MQTT.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_system.h>
#include <sys/time.h>

#ifndef MQTT_ROOT_CA
#error "MQTT_ROOT_CA must be defined in include/secrets.h."
#endif
#ifndef DEVICE_ID
#error "DEVICE_ID must be defined in include/secrets.h."
#endif
#ifndef MQTT_HOST
#error "MQTT_HOST must be defined in include/secrets.h."
#endif

namespace {
constexpr double DISTANCE_THRESHOLD_M = 8.0;
constexpr double HEADING_THRESHOLD_DEG = 15.0;
constexpr double SPEED_THRESHOLD_KMH = 5.0;
constexpr double MOVING_SPEED_KMH = 2.5;
constexpr double STOP_SPEED_KMH = 1.5;
constexpr double HDOP_REJECT_THRESHOLD = 4.0;
constexpr uint32_t MIN_PUBLISH_INTERVAL_MS = 3000;
constexpr uint32_t MOVING_HEARTBEAT_MS = 30000;
constexpr uint32_t STOPPED_HEARTBEAT_MS = 120000;
constexpr uint32_t WIFI_RETRY_MS = 5000;
constexpr uint32_t MQTT_RETRY_MS = 5000;
constexpr uint16_t MQTT_BUFFER_BYTES = 512;
constexpr int MQTT_QOS = 1;

TinyGPSPlus gps;
HardwareSerial &gpsSerial = Serial2;
WiFiClientSecure tlsClient;
MQTTClient mqttClient(MQTT_BUFFER_BYTES);

struct TelemetryFix {
  double lat = 0;
  double lng = 0;
  double speed = 0;
  double heading = 0;
  const char *motionState = "uncertain";
  int64_t timestamp = 0;
  bool valid = false;
};

TelemetryFix bufferedFix;
double lastLat = 0;
double lastLng = 0;
double lastSpeed = 0;
double lastHeading = 0;
bool hasPublishedLocation = false;
bool moving = false;
uint8_t movingReadings = 0;
uint8_t stoppedReadings = 0;
uint32_t lastPublishAt = 0;
uint32_t lastEvaluationAt = 0;
uint32_t lastWifiAttemptAt = 0;
uint32_t lastMqttAttemptAt = 0;
uint32_t lastGpsWarningAt = 0;
bool gpsFixWasLost = false;
bool lossMessagePublished = false;

uint32_t elapsed(uint32_t since) {
  return millis() - since;
}

String telemetryTopic() {
  String prefix = MQTT_TOPIC_PREFIX;
  while (prefix.endsWith("/")) prefix.remove(prefix.length() - 1);
  return prefix + "/" + DEVICE_ID;
}

bool clockIsSynchronized() {
  return time(nullptr) > 1700000000;
}

int64_t epochMilliseconds() {
  timeval tv{};
  gettimeofday(&tv, nullptr);
  return static_cast<int64_t>(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
  const double dLat = radians(lat2 - lat1);
  const double dLng = radians(lng2 - lng1);
  const double a = sin(dLat / 2) * sin(dLat / 2) +
                   cos(radians(lat1)) * cos(radians(lat2)) *
                   sin(dLng / 2) * sin(dLng / 2);
  return 6371000.0 * 2 * atan2(sqrt(a), sqrt(1 - a));
}

double headingDelta(double current, double previous) {
  double delta = fabs(current - previous);
  return delta > 180 ? 360 - delta : delta;
}

const char *updateMotionState(double speed) {
  if (speed >= MOVING_SPEED_KMH) {
    movingReadings = min<uint8_t>(movingReadings + 1, 3);
    stoppedReadings = 0;
    if (movingReadings >= 3) moving = true;
  } else if (speed <= STOP_SPEED_KMH) {
    stoppedReadings = min<uint8_t>(stoppedReadings + 1, 3);
    movingReadings = 0;
    if (stoppedReadings >= 3) moving = false;
  }
  return moving ? "moving" : "stopped";
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (lastWifiAttemptAt && elapsed(lastWifiAttemptAt) < WIFI_RETRY_MS) return;
  lastWifiAttemptAt = millis();

  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("[WiFi] Connecting to %s\n", WIFI_SSID);
}

void connectMqtt() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected()) return;
  if (!clockIsSynchronized()) return;
  if (lastMqttAttemptAt && elapsed(lastMqttAttemptAt) < MQTT_RETRY_MS) return;
  lastMqttAttemptAt = millis();

  Serial.printf("[MQTT] Connecting securely to %s:%u\n", MQTT_HOST, MQTT_PORT);
  if (mqttClient.connect(MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.println("[MQTT] Connected (persistent session, telemetry QoS 1).");
  } else {
    Serial.printf(
      "[MQTT] Connection failed (error=%d return=%d).\n",
      static_cast<int>(mqttClient.lastError()),
      static_cast<int>(mqttClient.returnCode())
    );
  }
}

bool publishFix(const TelemetryFix &fix) {
  if (!fix.valid || !mqttClient.connected() || !clockIsSynchronized()) return false;

  JsonDocument document;
  // Closed telemetry contract: these are the only transmitted parameters.
  document["lat"] = fix.lat;
  document["lng"] = fix.lng;
  document["speed"] = fix.speed;
  document["heading"] = fix.heading;
  document["motionState"] = fix.motionState;
  document["timestamp"] = fix.timestamp;

  String payload;
  serializeJson(document, payload);
  const uint32_t startedAt = millis();
  const bool acknowledged = mqttClient.publish(
    telemetryTopic(),
    payload,
    false,
    MQTT_QOS
  );
  Serial.printf(
    "[MQTT] QoS1 publish %s in %lums (%u bytes, RSSI %d dBm)\n",
    acknowledged ? "acknowledged" : "failed",
    elapsed(startedAt),
    payload.length(),
    WiFi.RSSI()
  );
  if (!acknowledged) return false;

  lastLat = fix.lat;
  lastLng = fix.lng;
  lastSpeed = fix.speed;
  lastHeading = fix.heading;
  lastPublishAt = millis();
  hasPublishedLocation = true;
  return true;
}

TelemetryFix currentFix() {
  TelemetryFix fix;
  if (
    !gps.location.isValid() ||
    gps.location.age() > 5000 ||
    !gps.hdop.isValid() ||
    gps.hdop.hdop() > HDOP_REJECT_THRESHOLD
  ) {
    return fix;
  }

  fix.lat = gps.location.lat();
  fix.lng = gps.location.lng();
  fix.speed = gps.speed.isValid() && gps.speed.kmph() >= MOVING_SPEED_KMH
    ? min(gps.speed.kmph(), 200.0)
    : 0.0;
  fix.heading = gps.course.isValid() ? fmod(max(gps.course.deg(), 0.0), 360.0) : 0.0;
  fix.motionState = updateMotionState(fix.speed);
  fix.timestamp = epochMilliseconds();
  fix.valid = clockIsSynchronized();
  return fix;
}

bool shouldPublish(const TelemetryFix &fix) {
  if (!fix.valid) return false;
  if (!hasPublishedLocation) return true;
  if (elapsed(lastPublishAt) < MIN_PUBLISH_INTERVAL_MS) return false;

  const double moved = haversineMeters(lastLat, lastLng, fix.lat, fix.lng);
  const bool materiallyChanged =
    moved >= DISTANCE_THRESHOLD_M ||
    headingDelta(fix.heading, lastHeading) >= HEADING_THRESHOLD_DEG ||
    fabs(fix.speed - lastSpeed) >= SPEED_THRESHOLD_KMH;
  const uint32_t heartbeat = moving ? MOVING_HEARTBEAT_MS : STOPPED_HEARTBEAT_MS;
  return materiallyChanged || elapsed(lastPublishAt) >= heartbeat;
}

void evaluateTelemetry() {
  const TelemetryFix fix = currentFix();
  if (!fix.valid) {
    if (!gpsFixWasLost) {
      gpsFixWasLost = true;
      lossMessagePublished = false;
      Serial.println("[GPS] Trustworthy fix lost.");
    }
    if (hasPublishedLocation && !lossMessagePublished && mqttClient.connected()) {
      TelemetryFix uncertain;
      uncertain.lat = lastLat;
      uncertain.lng = lastLng;
      uncertain.speed = 0;
      uncertain.heading = lastHeading;
      uncertain.motionState = "uncertain";
      uncertain.timestamp = epochMilliseconds();
      uncertain.valid = clockIsSynchronized();
      lossMessagePublished = publishFix(uncertain);
    }
    return;
  }

  if (gpsFixWasLost) {
    gpsFixWasLost = false;
    lossMessagePublished = false;
    Serial.println("[GPS] Trustworthy fix restored.");
  }

  if (!shouldPublish(fix)) return;
  if (!mqttClient.connected()) {
    bufferedFix = fix;
    return;
  }
  if (publishFix(fix)) bufferedFix.valid = false;
  else bufferedFix = fix;
}
} // namespace

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
  delay(500);
  Serial.printf("[Boot] Eki MQTT telemetry; reset reason=%d\n", esp_reset_reason());

  tlsClient.setCACert(MQTT_ROOT_CA);
  mqttClient.begin(MQTT_HOST, MQTT_PORT, tlsClient);
  mqttClient.setOptions(30, false, 5000);
  mqttClient.dropOverflow(true);
  connectWiFi();
}

void loop() {
  while (gpsSerial.available() > 0) gps.encode(gpsSerial.read());

  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  if (!wifiConnected) {
    if (mqttClient.connected()) mqttClient.disconnect();
    connectWiFi();
  } else {
    if (!clockIsSynchronized()) configTime(0, 0, "pool.ntp.org", "time.google.com");
    connectMqtt();
  }

  if (mqttClient.connected()) {
    mqttClient.loop();
    if (bufferedFix.valid && publishFix(bufferedFix)) bufferedFix.valid = false;
  }

  if (elapsed(lastEvaluationAt) >= 1000) {
    lastEvaluationAt = millis();
    evaluateTelemetry();
  }

  if (millis() > 5000 && gps.charsProcessed() < 10 && elapsed(lastGpsWarningAt) >= 5000) {
    lastGpsWarningAt = millis();
    Serial.println("[GPS] No NMEA data received; check RX/TX wiring.");
  }
  delay(5);
}
