#include "secrets.h"
#include "telemetry_policy.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_system.h>
#include <esp_idf_version.h>
#include <esp_task_wdt.h>
#include <sys/time.h>

#ifndef BACKEND_ROOT_CA
#error "BACKEND_ROOT_CA must be defined in include/secrets.h."
#endif
#ifndef BACKEND_URL
#error "BACKEND_URL must be defined in include/secrets.h."
#endif
#ifndef DEVICE_ID
#error "DEVICE_ID must be defined in include/secrets.h."
#endif
#ifndef DEVICE_SECRET
#error "DEVICE_SECRET must be defined in include/secrets.h."
#endif

static_assert(sizeof(DEVICE_SECRET) - 1 >= 20,
              "DEVICE_SECRET must contain at least 20 characters.");

namespace {
constexpr double HDOP_REJECT_THRESHOLD = 4.0;
constexpr uint32_t WIFI_RETRY_MS = 5000;
constexpr uint32_t TIME_SYNC_RETRY_MS = 10000;
constexpr uint32_t HTTP_TIMEOUT_MS = 7000;
constexpr uint32_t WATCHDOG_TIMEOUT_MS = 15000;
// At 9,600 baud, a seven-second HTTPS call can overlap roughly 6.7 KiB of
// incoming NMEA data. HardwareSerial defaults to only 256 bytes.
constexpr size_t GPS_RX_BUFFER_BYTES = 8192;

TinyGPSPlus gps;
HardwareSerial &gpsSerial = Serial2;
WiFiClientSecure tlsClient;
String telemetryEndpoint;
String authorizationHeader;

struct TelemetryFix {
  double lat = 0;
  double lng = 0;
  double speed = 0;
  double heading = 0;
  const char *motionState = "uncertain";
  int64_t timestamp = 0;
  bool valid = false;
};

enum class PublishResult : uint8_t {
  Accepted,
  RetryLatest,
  Dropped,
};

TelemetryFix bufferedFix;
double lastLat = 0;
double lastLng = 0;
double lastSpeed = 0;
double lastHeading = 0;
bool hasPublishedLocation = false;
const char *lastPublishedMotionState = nullptr;
eki::telemetry::MotionTracker motionTracker;
uint32_t lastPublishAt = 0;
uint32_t lastEvaluationAt = 0;
uint32_t lastWifiAttemptAt = 0;
uint32_t lastTimeSyncAttemptAt = 0;
uint32_t lastHttpsFailureAt = 0;
uint32_t httpsRetryDelayMs = 0;
uint32_t lastGpsWarningAt = 0;
uint8_t consecutiveHttpsFailures = 0;
bool gpsFixWasLost = false;
bool lossMessagePublished = false;
bool wifiConfigured = false;

uint32_t elapsed(uint32_t since) {
  return millis() - since;
}

String buildTelemetryUrl() {
  String base = BACKEND_URL;
  while (base.endsWith("/")) base.remove(base.length() - 1);
  return base + "/api/devices/" + DEVICE_ID + "/telemetry";
}

bool clockIsSynchronized() {
  return time(nullptr) > 1700000000;
}

bool httpsRetryIsPending() {
  return httpsRetryDelayMs > 0 &&
         elapsed(lastHttpsFailureAt) < httpsRetryDelayMs;
}

void scheduleHttpsRetry(uint32_t minimumDelayMs = 0) {
  // Per-device jitter prevents a recovering hotspot/backend from receiving a
  // synchronized retry wave from the whole fleet.
  httpsRetryDelayMs = max<uint32_t>(
    eki::telemetry::retryDelayMs(consecutiveHttpsFailures, esp_random()),
    minimumDelayMs
  );
  lastHttpsFailureAt = millis();
  consecutiveHttpsFailures =
    min<uint8_t>(consecutiveHttpsFailures + 1, 6);
}

void resetHttpsRetry() {
  consecutiveHttpsFailures = 0;
  httpsRetryDelayMs = 0;
}

int64_t epochMilliseconds() {
  timeval tv{};
  gettimeofday(&tv, nullptr);
  return static_cast<int64_t>(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (lastWifiAttemptAt && elapsed(lastWifiAttemptAt) < WIFI_RETRY_MS) return;
  lastWifiAttemptAt = millis();

  tlsClient.stop();
  if (!wifiConfigured) {
    WiFi.mode(WIFI_STA);
    WiFi.persistent(false);
    WiFi.setAutoReconnect(true);
    // The tracker is vehicle-powered. Disabling modem sleep avoids periodic
    // wake latency during short HTTPS telemetry bursts.
    WiFi.setSleep(false);
    WiFi.setScanMethod(WIFI_FAST_SCAN);
    WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    wifiConfigured = true;
    Serial.println("[WiFi] Connecting to configured network.");
  } else {
    WiFi.reconnect();
    Serial.println("[WiFi] Reconnecting.");
  }
}

void configureWatchdog() {
#if ESP_IDF_VERSION_MAJOR >= 5
  esp_task_wdt_config_t configuration{};
  configuration.timeout_ms = WATCHDOG_TIMEOUT_MS;
  configuration.idle_core_mask = (1U << portNUM_PROCESSORS) - 1U;
  configuration.trigger_panic = true;
  esp_err_t result = esp_task_wdt_init(&configuration);
  if (result == ESP_ERR_INVALID_STATE) {
    result = esp_task_wdt_reconfigure(&configuration);
  }
#else
  const esp_err_t result = esp_task_wdt_init(WATCHDOG_TIMEOUT_MS / 1000, true);
#endif
  const esp_err_t addResult = esp_task_wdt_add(nullptr);
  Serial.printf("[Watchdog] configure=%d, subscribe=%d\n", result, addResult);
}

void synchronizeClock() {
  if (clockIsSynchronized()) return;
  if (
    lastTimeSyncAttemptAt &&
    elapsed(lastTimeSyncAttemptAt) < TIME_SYNC_RETRY_MS
  ) {
    return;
  }
  lastTimeSyncAttemptAt = millis();
  configTime(0, 0, "pool.ntp.org", "time.google.com");
}

PublishResult publishFix(const TelemetryFix &fix) {
  if (
    !fix.valid ||
    WiFi.status() != WL_CONNECTED ||
    !clockIsSynchronized()
  ) {
    return PublishResult::RetryLatest;
  }
  if (httpsRetryIsPending()) return PublishResult::RetryLatest;

  JsonDocument document;
  document["lat"] = fix.lat;
  document["lng"] = fix.lng;
  document["speed"] = fix.speed;
  document["heading"] = fix.heading;
  document["motionState"] = fix.motionState;
  document["timestamp"] = fix.timestamp;

  String payload;
  payload.reserve(192);
  serializeJson(document, payload);
  if (payload.length() > 512) {
    Serial.println("[HTTPS] Refusing oversized telemetry payload.");
    scheduleHttpsRetry(eki::telemetry::HTTPS_REJECTED_SAMPLE_RETRY_MS);
    return PublishResult::Dropped;
  }

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(true);
  if (!http.begin(tlsClient, telemetryEndpoint)) {
    Serial.println("[HTTPS] Unable to initialize telemetry request.");
    scheduleHttpsRetry();
    return PublishResult::RetryLatest;
  }
  const char *responseHeaders[] = {"Retry-After"};
  http.collectHeaders(responseHeaders, 1);
  http.addHeader("Authorization", authorizationHeader);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Cache-Control", "no-store");

  const uint32_t startedAt = millis();
  const int responseCode = http.POST(payload);
  const eki::telemetry::HttpResponseAction action =
    eki::telemetry::httpResponseAction(responseCode);
  const uint32_t retryAfterMs = responseCode == 429
    ? eki::telemetry::retryAfterDelayMs(http.header("Retry-After").c_str())
    : 0;
  if (responseCode < 0) {
    const String transportError = HTTPClient::errorToString(responseCode);
    Serial.printf(
      "[HTTPS] Transport failure %d (%s) in %lums (RSSI %d dBm). Check DNS, hostname, CA, clock, and backend reachability.\n",
      responseCode,
      transportError.c_str(),
      elapsed(startedAt),
      WiFi.RSSI()
    );
  } else {
    Serial.printf(
      "[HTTPS] Telemetry %s (HTTP %d) in %lums (%u bytes, RSSI %d dBm)\n",
      action == eki::telemetry::HttpResponseAction::Accept
        ? "accepted"
        : action == eki::telemetry::HttpResponseAction::RetrySample
          ? "retryable"
          : "rejected",
      responseCode,
      elapsed(startedAt),
      payload.length(),
      WiFi.RSSI()
    );
    if (responseCode == 400 || responseCode == 413 || responseCode == 422) {
      Serial.println("[HTTPS] Check the six-field payload and NTP-synchronized timestamp.");
    } else if (responseCode == 401 || responseCode == 403) {
      Serial.println("[HTTPS] Check DEVICE_ID, provisioned secret, enabled state, and bus/route assignment.");
    } else if (responseCode == 404) {
      Serial.println("[HTTPS] Check BACKEND_URL; the telemetry endpoint was not found.");
    } else if (responseCode == 429) {
      Serial.printf(
        "[HTTPS] Rate limited; server retry delay=%lus.\n",
        static_cast<unsigned long>(
          eki::telemetry::minimumHttpRetryDelayMs(responseCode, retryAfterMs) / 1000
        )
      );
    } else if (responseCode >= 500) {
      Serial.println("[HTTPS] Backend dependency is unavailable; retaining the latest fix.");
    }
  }
  http.end();
  if (action != eki::telemetry::HttpResponseAction::Accept) {
    tlsClient.stop();
    scheduleHttpsRetry(
      eki::telemetry::minimumHttpRetryDelayMs(responseCode, retryAfterMs)
    );
    return action == eki::telemetry::HttpResponseAction::RetrySample
      ? PublishResult::RetryLatest
      : PublishResult::Dropped;
  }

  resetHttpsRetry();
  lastLat = fix.lat;
  lastLng = fix.lng;
  lastSpeed = fix.speed;
  lastHeading = fix.heading;
  lastPublishedMotionState = fix.motionState;
  lastPublishAt = millis();
  hasPublishedLocation = true;
  return PublishResult::Accepted;
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
  const double rawSpeed = gps.speed.isValid()
    ? min(max(gps.speed.kmph(), 0.0), 200.0)
    : 0.0;
  fix.speed = rawSpeed;
  fix.heading = gps.course.isValid()
    ? fmod(max(gps.course.deg(), 0.0), 360.0)
    : 0.0;
  fix.motionState = motionTracker.update(rawSpeed);
  fix.timestamp = epochMilliseconds();
  fix.valid = clockIsSynchronized();
  return fix;
}

bool shouldPublish(const TelemetryFix &fix) {
  return eki::telemetry::shouldPublishFix(
    fix.valid,
    hasPublishedLocation,
    elapsed(lastPublishAt),
    motionTracker.moving,
    fix.motionState,
    lastPublishedMotionState,
    fix.lat,
    fix.lng,
    lastLat,
    lastLng,
    fix.speed,
    lastSpeed,
    fix.heading,
    lastHeading
  );
}

void evaluateTelemetry() {
  const TelemetryFix fix = currentFix();
  if (!fix.valid) {
    if (!gpsFixWasLost) {
      gpsFixWasLost = true;
      lossMessagePublished = false;
      Serial.println("[GPS] Trustworthy fix lost.");
    }
    if (
      hasPublishedLocation &&
      !lossMessagePublished &&
      WiFi.status() == WL_CONNECTED
    ) {
      TelemetryFix uncertain;
      uncertain.lat = lastLat;
      uncertain.lng = lastLng;
      uncertain.speed = 0;
      uncertain.heading = lastHeading;
      uncertain.motionState = "uncertain";
      uncertain.timestamp = epochMilliseconds();
      uncertain.valid = clockIsSynchronized();
      lossMessagePublished = publishFix(uncertain) == PublishResult::Accepted;
    }
    return;
  }

  if (gpsFixWasLost) {
    gpsFixWasLost = false;
    lossMessagePublished = false;
    Serial.println("[GPS] Trustworthy fix restored.");
  }

  if (!shouldPublish(fix)) return;
  const PublishResult result = publishFix(fix);
  if (result == PublishResult::Accepted || result == PublishResult::Dropped) {
    bufferedFix.valid = false;
  } else if (result == PublishResult::RetryLatest) {
    bufferedFix = fix;
  }
}
} // namespace

void setup() {
  Serial.begin(115200);
  const size_t gpsRxBuffer = gpsSerial.setRxBufferSize(GPS_RX_BUFFER_BYTES);
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
  delay(500);
  Serial.printf(
    "[Boot] Eki HTTPS telemetry; reset reason=%d; GNSS RX buffer=%u bytes\n",
    esp_reset_reason(),
    gpsRxBuffer
  );

  if (eki::telemetry::hasTemplateConfiguration(
    WIFI_SSID,
    WIFI_PASS,
    DEVICE_SECRET,
    BACKEND_URL,
    BACKEND_ROOT_CA
  )) {
    Serial.println(
      "[Boot] secrets.h still contains template placeholders; configure Wi-Fi, provisioned device credentials, HTTPS backend URL, and issuing root CA."
    );
    while (true) delay(1000);
  }

  tlsClient.setCACert(BACKEND_ROOT_CA);
  telemetryEndpoint = buildTelemetryUrl();
  if (!telemetryEndpoint.startsWith("https://")) {
    Serial.println("[Boot] BACKEND_URL must use HTTPS; telemetry disabled.");
    while (true) delay(1000);
  }
  authorizationHeader = String("Device ") + DEVICE_SECRET;
  configureWatchdog();
  connectWiFi();
}

void loop() {
  esp_task_wdt_reset();
  while (gpsSerial.available() > 0) gps.encode(gpsSerial.read());

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  } else {
    synchronizeClock();
    if (
      bufferedFix.valid &&
      clockIsSynchronized() &&
      epochMilliseconds() - bufferedFix.timestamp > 55000
    ) {
      // The backend rejects measurements older than 60 seconds. Drop the
      // nearly stale buffered sample so it cannot trigger failure backoff and
      // delay the next current fix after connectivity returns.
      bufferedFix.valid = false;
    }
    if (bufferedFix.valid) {
      const PublishResult result = publishFix(bufferedFix);
      if (result != PublishResult::RetryLatest) bufferedFix.valid = false;
    }
  }

  if (elapsed(lastEvaluationAt) >= 1000) {
    lastEvaluationAt = millis();
    evaluateTelemetry();
  }

  if (
    millis() > 5000 &&
    gps.charsProcessed() < 10 &&
    elapsed(lastGpsWarningAt) >= 5000
  ) {
    lastGpsWarningAt = millis();
    Serial.println("[GPS] No NMEA data received; check RX/TX wiring.");
  }
  delay(5);
}
