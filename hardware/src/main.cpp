#include "secrets.h"
#include "clock_policy.h"
#include "connectivity_policy.h"
#include "recovery_portal.h"
#include "telemetry_policy.h"
#include "telemetry_queue.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_attr.h>
#include <esp_system.h>
#include <esp_idf_version.h>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <limits>
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
#ifndef RECOVERY_AP_PASSWORD
#error "RECOVERY_AP_PASSWORD must be defined in include/secrets.h."
#endif

static_assert(sizeof(DEVICE_SECRET) - 1 >= 20,
              "DEVICE_SECRET must contain at least 20 characters.");
static_assert(
  sizeof(RECOVERY_AP_PASSWORD) - 1 >= 12 &&
  sizeof(RECOVERY_AP_PASSWORD) - 1 <= 63,
  "RECOVERY_AP_PASSWORD must contain 12 to 63 characters."
);

namespace {
constexpr double HDOP_REJECT_THRESHOLD = 4.0;
constexpr uint32_t GNSS_UTC_MAX_AGE_MS = 2000;
constexpr uint32_t NTP_CROSS_CHECK_INTERVAL_MS = 6UL * 60 * 60 * 1000;
constexpr uint32_t HTTP_TIMEOUT_MS = 7000;
constexpr uint32_t WATCHDOG_TIMEOUT_MS = 25000;
constexpr int64_t TELEMETRY_FRESHNESS_MARGIN_MS = 55000;
constexpr size_t TELEMETRY_QUEUE_CAPACITY = 120;
constexpr uint32_t HEALTH_REPORT_INTERVAL_MS = 30000;
constexpr uint32_t PUBLISHER_IDLE_MS = 100;
constexpr uint32_t PUBLISHER_TASK_STACK_BYTES = 12288;
constexpr UBaseType_t PUBLISHER_TASK_PRIORITY = 1;
// Network work runs on another core, but this buffer still absorbs scheduler
// jitter and diagnostic output without risking NMEA loss.
constexpr size_t GPS_RX_BUFFER_BYTES = 8192;
constexpr uint8_t STATUS_LED_PIN = 2;

TinyGPSPlus gps;
HardwareSerial &gpsSerial = Serial2;
WiFiClientSecure tlsClient;
String telemetryEndpoint;
String authorizationHeader;

enum class MotionState : uint8_t {
  Moving,
  Stopped,
  Uncertain,
};

struct TelemetryFix {
  double lat;
  double lng;
  double speed;
  double heading;
  int64_t timestamp;
  uint32_t sequence;
  MotionState motionState;
  bool valid;
};

using TelemetryQueue = eki::telemetry::NewestFirstTelemetryQueue<
  TelemetryFix,
  TELEMETRY_QUEUE_CAPACITY
>;
static_assert(
  sizeof(TelemetryQueue) <= 6 * 1024,
  "Telemetry queue must leave headroom in the ESP32's 8 KiB RTC slow memory."
);
static_assert(
  std::is_trivial<TelemetryQueue>::value,
  "RTC no-init queue must not be rewritten by a global constructor."
);

// RTC no-init memory preserves the bounded queue across software/watchdog
// resets. initializeOrRecover() rejects stale firmware layouts explicitly.
RTC_NOINIT_ATTR TelemetryQueue telemetryQueue;
portMUX_TYPE telemetryQueueMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE healthMetricsMux = portMUX_INITIALIZER_UNLOCKED;
TaskHandle_t publisherTaskHandle = nullptr;

enum class PublishResult : uint8_t {
  Accepted,
  RetryLatest,
  Dropped,
  CredentialFault,
};

double lastCapturedLat = 0;
double lastCapturedLng = 0;
double lastCapturedSpeed = 0;
double lastCapturedHeading = 0;
bool hasCapturedLocation = false;
MotionState lastCapturedMotionState = MotionState::Uncertain;
eki::telemetry::MotionTracker motionTracker;
uint32_t lastCaptureAt = 0;
uint32_t lastEvaluationAt = 0;
uint32_t lastNtpCrossCheckAt = 0;
uint32_t lastHttpsFailureAt = 0;
uint32_t httpsRetryDelayMs = 0;
uint32_t lastGpsWarningAt = 0;
uint32_t lastHealthReportAt = 0;
uint8_t consecutiveHttpsFailures = 0;
bool ntpCrossCheckStarted = false;
bool gnssClockApplied = false;
uint32_t lastGnssClockAppliedAt = 0;
bool credentialFaultActive = false;
bool gpsFixWasLost = false;
bool lossMessageQueued = false;
bool wifiConfigured = false;
eki::connectivity::StationCredentials stationCredentials;
eki::connectivity::WifiRetrySupervisor wifiRetrySupervisor;
eki::connectivity::RecoveryPortal recoveryPortal;
portMUX_TYPE deviceFaultMux = portMUX_INITIALIZER_UNLOCKED;
eki::connectivity::FaultCode deviceFault = eki::connectivity::FaultCode::None;
uint32_t uartBufferOverflowCount = 0;
uint32_t uartFifoOverflowCount = 0;
uint32_t acceptedFixCount = 0;
uint32_t rejectedFixCount = 0;

struct HealthCounters {
  uint32_t uartBufferOverflows;
  uint32_t uartFifoOverflows;
  uint32_t acceptedFixes;
  uint32_t rejectedFixes;
};

uint32_t elapsed(uint32_t since) {
  return millis() - since;
}

void setDeviceFault(eki::connectivity::FaultCode fault) {
  portENTER_CRITICAL(&deviceFaultMux);
  deviceFault = fault;
  portEXIT_CRITICAL(&deviceFaultMux);
}

eki::connectivity::FaultCode currentDeviceFault() {
  portENTER_CRITICAL(&deviceFaultMux);
  const eki::connectivity::FaultCode fault = deviceFault;
  portEXIT_CRITICAL(&deviceFaultMux);
  return fault;
}

void updateStatusLed() {
  digitalWrite(
    STATUS_LED_PIN,
    eki::connectivity::statusLedOn(currentDeviceFault(), millis()) ? HIGH : LOW
  );
}

const char *faultCodeName(eki::connectivity::FaultCode fault) {
  switch (fault) {
    case eki::connectivity::FaultCode::WifiRecovery:
      return "wifi-recovery";
    case eki::connectivity::FaultCode::CredentialRejected:
      return "credential-rejected";
    case eki::connectivity::FaultCode::None:
    default:
      return "none";
  }
}

const char *motionStateName(MotionState state) {
  switch (state) {
    case MotionState::Moving:
      return "moving";
    case MotionState::Stopped:
      return "stopped";
    case MotionState::Uncertain:
    default:
      return "uncertain";
  }
}

MotionState motionStateFromTracker(const char *state) {
  return strcmp(state, "moving") == 0
    ? MotionState::Moving
    : MotionState::Stopped;
}

void notifyPublisher() {
  if (publisherTaskHandle != nullptr) xTaskNotifyGive(publisherTaskHandle);
}

void enqueueFix(TelemetryFix fix) {
  portENTER_CRITICAL(&telemetryQueueMux);
  telemetryQueue.push(fix);
  portEXIT_CRITICAL(&telemetryQueueMux);
  notifyPublisher();
}

bool newestFreshFix(int64_t minimumTimestamp, TelemetryFix &fix, size_t &staleDrops) {
  portENTER_CRITICAL(&telemetryQueueMux);
  staleDrops = telemetryQueue.dropOlderThan(minimumTimestamp);
  const bool available = telemetryQueue.newest(fix);
  portEXIT_CRITICAL(&telemetryQueueMux);
  return available;
}

bool removeQueuedFix(uint32_t sequence) {
  portENTER_CRITICAL(&telemetryQueueMux);
  const bool removed = telemetryQueue.remove(sequence);
  portEXIT_CRITICAL(&telemetryQueueMux);
  return removed;
}

TelemetryQueue::Stats telemetryQueueStats() {
  portENTER_CRITICAL(&telemetryQueueMux);
  const TelemetryQueue::Stats stats = telemetryQueue.stats();
  portEXIT_CRITICAL(&telemetryQueueMux);
  return stats;
}

void onGpsSerialError(hardwareSerial_error_t error) {
  portENTER_CRITICAL(&healthMetricsMux);
  if (error == UART_BUFFER_FULL_ERROR) {
    ++uartBufferOverflowCount;
  } else if (error == UART_FIFO_OVF_ERROR) {
    ++uartFifoOverflowCount;
  }
  portEXIT_CRITICAL(&healthMetricsMux);
}

void recordPublishResult(bool accepted) {
  portENTER_CRITICAL(&healthMetricsMux);
  if (accepted) {
    ++acceptedFixCount;
  } else {
    ++rejectedFixCount;
  }
  portEXIT_CRITICAL(&healthMetricsMux);
}

HealthCounters healthCounters() {
  portENTER_CRITICAL(&healthMetricsMux);
  const HealthCounters counters = {
    uartBufferOverflowCount,
    uartFifoOverflowCount,
    acceptedFixCount,
    rejectedFixCount,
  };
  portEXIT_CRITICAL(&healthMetricsMux);
  return counters;
}

String buildTelemetryUrl() {
  String base = BACKEND_URL;
  while (base.endsWith("/")) base.remove(base.length() - 1);
  return base + "/api/devices/" + DEVICE_ID + "/telemetry";
}

uint32_t telemetryConfigurationTag() {
  uint32_t hash = 2166136261UL;
  for (const char *value : {DEVICE_ID, BACKEND_URL}) {
    while (*value != '\0') {
      hash ^= static_cast<uint8_t>(*value++);
      hash *= 16777619UL;
    }
    hash ^= 0xFF;
    hash *= 16777619UL;
  }
  return hash == 0 ? 1 : hash;
}

bool clockIsSynchronized() {
  return static_cast<int64_t>(time(nullptr)) * 1000 >=
    eki::clock::TRUSTED_EPOCH_MIN_MS;
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

void disciplineClockFromGnss() {
  if (
    !gps.date.isValid() ||
    !gps.time.isValid() ||
    gps.date.age() > GNSS_UTC_MAX_AGE_MS ||
    gps.time.age() > GNSS_UTC_MAX_AGE_MS
  ) {
    return;
  }

  const eki::clock::UtcDateTime utc = {
    gps.date.year(),
    gps.date.month(),
    gps.date.day(),
    gps.time.hour(),
    gps.time.minute(),
    gps.time.second(),
    gps.time.centisecond(),
  };
  int64_t gnssEpochMs = 0;
  if (!eki::clock::utcToEpochMilliseconds(utc, gnssEpochMs)) return;
  const int64_t gnssEpochSeconds = gnssEpochMs / 1000;
  if (gnssEpochSeconds > static_cast<int64_t>(std::numeric_limits<time_t>::max())) {
    Serial.println("[Clock] GNSS UTC exceeds this firmware runtime's time_t range.");
    return;
  }

  const int64_t systemEpochMs = epochMilliseconds();
  if (!eki::clock::shouldApplyGnssClock(
    gnssClockApplied,
    elapsed(lastGnssClockAppliedAt),
    systemEpochMs,
    gnssEpochMs
  )) {
    return;
  }

  timeval tv{};
  tv.tv_sec = static_cast<time_t>(gnssEpochSeconds);
  tv.tv_usec = static_cast<suseconds_t>((gnssEpochMs % 1000) * 1000);
  if (settimeofday(&tv, nullptr) != 0) {
    Serial.println("[Clock] GNSS UTC was valid but settimeofday failed.");
    return;
  }
  const bool initialSynchronization = !gnssClockApplied;
  gnssClockApplied = true;
  lastGnssClockAppliedAt = millis();
  if (initialSynchronization) {
    Serial.println("[Clock] System time established from fresh GNSS UTC.");
  } else {
    Serial.printf(
      "[Clock] GNSS UTC corrected system clock by %lldms; NTP remains a cross-check.\n",
      static_cast<long long>(eki::clock::absoluteDifference(systemEpochMs, gnssEpochMs))
    );
  }
}

void configureStationRadio() {
  WiFi.mode(recoveryPortal.active() ? WIFI_AP_STA : WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  // The tracker is vehicle-powered. Disabling modem sleep avoids periodic
  // wake latency during short HTTPS telemetry bursts.
  WiFi.setSleep(false);
  WiFi.setScanMethod(WIFI_FAST_SCAN);
  WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);
}

void attemptWifiConnection() {
  tlsClient.stop();
  if (!wifiConfigured) {
    configureStationRadio();
    WiFi.begin(stationCredentials.ssid(), stationCredentials.password());
    wifiConfigured = true;
    Serial.println("[WiFi] Connecting to configured network.");
  } else {
    WiFi.reconnect();
    Serial.println("[WiFi] Reconnecting with bounded exponential backoff.");
  }
}

void updateConnectivityFault() {
  setDeviceFault(
    credentialFaultActive
      ? eki::connectivity::FaultCode::CredentialRejected
      : recoveryPortal.active()
        ? eki::connectivity::FaultCode::WifiRecovery
        : eki::connectivity::FaultCode::None
  );
}

void serviceConnectivity() {
  const uint32_t now = millis();
  const bool connected = WiFi.status() == WL_CONNECTED;
  wifiRetrySupervisor.observe(connected, now);

  if (connected && recoveryPortal.active()) {
    recoveryPortal.stop();
    Serial.println("[WiFi] Connection restored; recovery portal stopped.");
  }

  recoveryPortal.handleClient();
  if (recoveryPortal.consumeCredentialsUpdated()) {
    tlsClient.stop();
    WiFi.disconnect(false, false);
    wifiConfigured = false;
    wifiRetrySupervisor.restartAfterConfiguration(now);
    Serial.println("[WiFi] Stored replacement network; reconnecting without exposing credentials.");
  }

  if (
    !connected &&
    wifiRetrySupervisor.recoveryStartDue(now) &&
    !recoveryPortal.active()
  ) {
    wifiRetrySupervisor.recordRecoveryStartAttempt(now);
    if (recoveryPortal.start(DEVICE_ID, RECOVERY_AP_PASSWORD, stationCredentials)) {
      Serial.printf(
        "[WiFi] Persistent outage; protected recovery mode active at http://192.168.4.1 on AP %s.\n",
        recoveryPortal.accessPointSsid()
      );
    } else {
      Serial.println("[WiFi] Persistent outage; recovery portal failed to start.");
    }
  }

  if (!connected && wifiRetrySupervisor.attemptDue(now)) {
    attemptWifiConnection();
    wifiRetrySupervisor.recordAttempt(now);
  }
  updateConnectivityFault();
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
  if (
    ntpCrossCheckStarted &&
    elapsed(lastNtpCrossCheckAt) < NTP_CROSS_CHECK_INTERVAL_MS
  ) return;
  lastNtpCrossCheckAt = millis();
  ntpCrossCheckStarted = true;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.println("[Clock] NTP cross-check/fallback scheduled.");
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
  document["motionState"] = motionStateName(fix.motionState);
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
          : action == eki::telemetry::HttpResponseAction::HaltCredentials
            ? "credential-fault"
            : "rejected",
      responseCode,
      elapsed(startedAt),
      payload.length(),
      WiFi.RSSI()
    );
    if (responseCode == 400 || responseCode == 413 || responseCode == 422) {
      Serial.println("[HTTPS] Check the six-field payload and GNSS/NTP-disciplined timestamp.");
    } else if (responseCode == 401 || responseCode == 403) {
      Serial.println("[HTTPS] Credential fault latched; publishing is halted until reprovisioning and restart.");
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
    if (action == eki::telemetry::HttpResponseAction::HaltCredentials) {
      credentialFaultActive = true;
      resetHttpsRetry();
      updateConnectivityFault();
      return PublishResult::CredentialFault;
    }
    scheduleHttpsRetry(
      eki::telemetry::minimumHttpRetryDelayMs(responseCode, retryAfterMs)
    );
    return action == eki::telemetry::HttpResponseAction::RetrySample
      ? PublishResult::RetryLatest
      : PublishResult::Dropped;
  }

  resetHttpsRetry();
  return PublishResult::Accepted;
}

TelemetryFix currentFix() {
  TelemetryFix fix{};
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
  fix.motionState = motionStateFromTracker(motionTracker.update(rawSpeed));
  fix.timestamp = epochMilliseconds();
  // GNSS quality and wall-clock readiness are separate signals.
  // evaluateTelemetry() waits for NTP before enqueueing, without misreporting
  // a healthy receiver as lost.
  fix.valid = true;
  return fix;
}

bool shouldCapture(const TelemetryFix &fix) {
  return eki::telemetry::shouldPublishFix(
    fix.valid,
    hasCapturedLocation,
    elapsed(lastCaptureAt),
    motionTracker.moving,
    motionStateName(fix.motionState),
    hasCapturedLocation ? motionStateName(lastCapturedMotionState) : nullptr,
    fix.lat,
    fix.lng,
    lastCapturedLat,
    lastCapturedLng,
    fix.speed,
    lastCapturedSpeed,
    fix.heading,
    lastCapturedHeading
  );
}

void rememberCapturedFix(const TelemetryFix &fix) {
  lastCapturedLat = fix.lat;
  lastCapturedLng = fix.lng;
  lastCapturedSpeed = fix.speed;
  lastCapturedHeading = fix.heading;
  lastCapturedMotionState = fix.motionState;
  lastCaptureAt = millis();
  hasCapturedLocation = true;
}

void evaluateTelemetry() {
  const TelemetryFix fix = currentFix();
  if (!fix.valid) {
    if (!gpsFixWasLost) {
      gpsFixWasLost = true;
      lossMessageQueued = false;
      Serial.println("[GPS] Trustworthy fix lost.");
    }
    if (hasCapturedLocation && !lossMessageQueued && clockIsSynchronized()) {
      TelemetryFix uncertain{};
      uncertain.lat = lastCapturedLat;
      uncertain.lng = lastCapturedLng;
      uncertain.speed = 0;
      uncertain.heading = lastCapturedHeading;
      uncertain.motionState = MotionState::Uncertain;
      uncertain.timestamp = epochMilliseconds();
      uncertain.valid = true;
      enqueueFix(uncertain);
      lossMessageQueued = true;
    }
    return;
  }

  if (gpsFixWasLost) {
    gpsFixWasLost = false;
    lossMessageQueued = false;
    Serial.println("[GPS] Trustworthy fix restored.");
  }

  if (!clockIsSynchronized()) return;
  if (!shouldCapture(fix)) return;
  enqueueFix(fix);
  rememberCapturedFix(fix);
}

void publisherTask(void *) {
  const esp_err_t watchdogResult = esp_task_wdt_add(nullptr);
  Serial.printf("[Publisher] Started on core %d; watchdog subscribe=%d.\n",
                xPortGetCoreID(), watchdogResult);

  for (;;) {
    esp_task_wdt_reset();
    serviceConnectivity();

    bool drainedSample = false;
    if (WiFi.status() == WL_CONNECTED) {
      synchronizeClock();
      if (clockIsSynchronized() && !httpsRetryIsPending()) {
        TelemetryFix fix{};
        size_t staleDrops = 0;
        const int64_t minimumTimestamp =
          epochMilliseconds() - TELEMETRY_FRESHNESS_MARGIN_MS;
        if (newestFreshFix(minimumTimestamp, fix, staleDrops)) {
          if (staleDrops > 0) {
            Serial.printf(
              "[Telemetry] Dropped %u stale queued sample(s) before publish.\n",
              static_cast<unsigned>(staleDrops)
            );
          }
          if (!credentialFaultActive) {
            const PublishResult result = publishFix(fix);
            if (result != PublishResult::RetryLatest) {
              removeQueuedFix(fix.sequence);
              recordPublishResult(result == PublishResult::Accepted);
            }
            drainedSample = true;
          }
        } else if (staleDrops > 0) {
          Serial.printf(
            "[Telemetry] Dropped %u stale queued sample(s); queue is empty.\n",
            static_cast<unsigned>(staleDrops)
          );
        }
      }
    }

    esp_task_wdt_reset();
    ulTaskNotifyTake(
      pdTRUE,
      pdMS_TO_TICKS(drainedSample ? 1 : PUBLISHER_IDLE_MS)
    );
  }
}

void reportHealth() {
  if (elapsed(lastHealthReportAt) < HEALTH_REPORT_INTERVAL_MS) return;
  lastHealthReportAt = millis();
  const TelemetryQueue::Stats queue = telemetryQueueStats();
  const HealthCounters counters = healthCounters();
  const eki::connectivity::FaultCode fault = currentDeviceFault();
  Serial.printf(
    "[Health] fault=%s queue=%u/%u high-water=%u overflow-drops=%lu stale-drops=%lu; accepted=%lu rejected=%lu; NMEA checksum-failures=%lu UART-buffer-overflows=%lu UART-FIFO-overflows=%lu.\n",
    faultCodeName(fault),
    queue.depth,
    static_cast<unsigned>(TELEMETRY_QUEUE_CAPACITY),
    queue.highWaterMark,
    static_cast<unsigned long>(queue.overflowDrops),
    static_cast<unsigned long>(queue.staleDrops),
    static_cast<unsigned long>(counters.acceptedFixes),
    static_cast<unsigned long>(counters.rejectedFixes),
    static_cast<unsigned long>(gps.failedChecksum()),
    static_cast<unsigned long>(counters.uartBufferOverflows),
    static_cast<unsigned long>(counters.uartFifoOverflows)
  );
}
} // namespace

void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);
  const size_t gpsRxBuffer = gpsSerial.setRxBufferSize(GPS_RX_BUFFER_BYTES);
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
  gpsSerial.onReceiveError(onGpsSerialError);
  delay(500);

  if (eki::telemetry::hasTemplateConfiguration(
    WIFI_SSID,
    WIFI_PASS,
    DEVICE_SECRET,
    BACKEND_URL,
    BACKEND_ROOT_CA,
    RECOVERY_AP_PASSWORD
  )) {
    Serial.println(
      "[Boot] secrets.h still contains template placeholders; configure Wi-Fi, recovery access, provisioned device credentials, HTTPS backend URL, and issuing root CA."
    );
    while (true) delay(1000);
  }
  if (!stationCredentials.load(WIFI_SSID, WIFI_PASS)) {
    Serial.println("[Boot] Station Wi-Fi credentials are invalid; firmware halted.");
    while (true) delay(1000);
  }
  Serial.printf(
    "[Boot] Station Wi-Fi source=%s; credential values are not logged.\n",
    stationCredentials.loadedFromNvs() ? "validated NVS record" : "secrets.h fallback"
  );

  portENTER_CRITICAL(&telemetryQueueMux);
  const bool queueRecovered = telemetryQueue.initializeOrRecover(
    telemetryConfigurationTag()
  );
  const TelemetryQueue::Stats bootQueue = telemetryQueue.stats();
  portEXIT_CRITICAL(&telemetryQueueMux);
  Serial.printf(
    "[Boot] Eki asynchronous HTTPS telemetry; reset reason=%d; GNSS RX buffer=%u bytes; RTC queue=%s (%u/%u).\n",
    esp_reset_reason(),
    gpsRxBuffer,
    queueRecovered ? "recovered" : "initialized",
    bootQueue.depth,
    static_cast<unsigned>(TELEMETRY_QUEUE_CAPACITY)
  );

  tlsClient.setCACert(BACKEND_ROOT_CA);
  telemetryEndpoint = buildTelemetryUrl();
  if (!telemetryEndpoint.startsWith("https://")) {
    Serial.println("[Boot] BACKEND_URL must use HTTPS; telemetry disabled.");
    while (true) delay(1000);
  }
  authorizationHeader = String("Device ") + DEVICE_SECRET;
  configureWatchdog();
  const BaseType_t taskResult = xTaskCreatePinnedToCore(
    publisherTask,
    "telemetry-publisher",
    PUBLISHER_TASK_STACK_BYTES,
    nullptr,
    PUBLISHER_TASK_PRIORITY,
    &publisherTaskHandle,
    0
  );
  if (taskResult != pdPASS) {
    Serial.println("[Boot] Unable to start telemetry publisher task.");
    while (true) {
      esp_task_wdt_reset();
      delay(1000);
    }
  }
}

void loop() {
  esp_task_wdt_reset();
  while (gpsSerial.available() > 0) gps.encode(gpsSerial.read());
  disciplineClockFromGnss();

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
  reportHealth();
  updateStatusLed();
  delay(5);
}
