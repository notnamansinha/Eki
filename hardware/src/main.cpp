#include "clock_policy.h"
#include "connectivity_policy.h"
#include "recovery_portal.h"
#include "telemetry_policy.h"
#include "telemetry_queue.h"
#include "reset_stats.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_attr.h>
#include <esp_flash_encrypt.h>
#include <esp_sntp.h>
#include <esp_secure_boot.h>
#include <esp_system.h>
#include <esp_idf_version.h>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <cstdio>
#include <cstring>
#include <limits>
#include <sys/time.h>

#ifndef EKI_FLEET_BUILD
#define EKI_FLEET_BUILD 0
#endif
#ifndef EKI_FIRMWARE_VERSION
#define EKI_FIRMWARE_VERSION "development"
#endif

namespace {
constexpr double HDOP_REJECT_THRESHOLD = 4.0;
constexpr uint32_t GNSS_UTC_MAX_AGE_MS = 2000;
constexpr uint32_t NTP_CROSS_CHECK_INTERVAL_MS = 6UL * 60 * 60 * 1000;
constexpr uint32_t HTTP_TIMEOUT_MS = 7000;
constexpr uint32_t WATCHDOG_TIMEOUT_MS = 25000;
constexpr int64_t TELEMETRY_FRESHNESS_MARGIN_MS = 55000;
constexpr size_t TELEMETRY_QUEUE_CAPACITY = 120;
constexpr uint32_t HEALTH_REPORT_INTERVAL_MS = 30000;
constexpr uint32_t FIRST_REMOTE_DIAGNOSTIC_DELAY_MS = 30000;
constexpr uint32_t REMOTE_DIAGNOSTIC_INTERVAL_MS = 5UL * 60 * 1000;
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
constexpr size_t ENDPOINT_MAX_LENGTH =
  eki::connectivity::BACKEND_URL_MAX_LENGTH +
  eki::connectivity::DEVICE_ID_MAX_LENGTH + 32;
char telemetryEndpoint[ENDPOINT_MAX_LENGTH]{};
char diagnosticsEndpoint[ENDPOINT_MAX_LENGTH]{};
char authorizationHeader[eki::connectivity::DEVICE_SECRET_MAX_LENGTH + 8]{};
bool flashEncryptionActive = false;
bool secureBootActive = false;
char hardwareDeviceLabel[13]{};

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
// Reset statistics survive brownout/panic/watchdog resets in RTC no-init
// memory, so operators see recovery events instead of a silent reboot.
RTC_NOINIT_ATTR eki::reset::ResetStats resetStats;
static_assert(
  sizeof(eki::reset::ResetStats) <= 512,
  "Reset stats must leave headroom in the ESP32's 8 KiB RTC slow memory."
);
static_assert(
  std::is_trivial<eki::reset::ResetStats>::value,
  "RTC no-init reset stats must not be rewritten by a global constructor."
);
static_assert(
  sizeof(TelemetryQueue) + sizeof(eki::reset::ResetStats) <= 6 * 1024,
  "RTC telemetry state must retain at least 2 KiB of slow-memory headroom."
);
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
uint32_t lastRemoteDiagnosticAt = 0;
bool remoteDiagnosticAttempted = false;
uint8_t consecutiveHttpsFailures = 0;
bool ntpCrossCheckStarted = false;
bool gnssClockApplied = false;
uint32_t lastGnssClockAppliedAt = 0;
portMUX_TYPE clockCrossCheckMux = portMUX_INITIALIZER_UNLOCKED;
int64_t latestGnssEpochMs = 0;
uint32_t latestGnssReferenceAt = 0;
int64_t pendingNtpDivergenceMs = 0;
bool latestGnssReferenceValid = false;
bool pendingNtpCrossCheck = false;
bool pendingNtpCrossCheckHasGnss = false;
bool credentialFaultActive = false;
bool gpsFixWasLost = false;
bool lossMessageQueued = false;
bool wifiConfigured = false;
eki::connectivity::DeviceConfiguration deviceConfiguration;
eki::connectivity::RecoveryAccess recoveryAccess;
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

eki::reset::ResetReason resetReasonFromEsp(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:
      return eki::reset::ResetReason::PowerOn;
    case ESP_RST_EXT:
      return eki::reset::ResetReason::External;
    case ESP_RST_SW:
      return eki::reset::ResetReason::Software;
    case ESP_RST_PANIC:
      return eki::reset::ResetReason::Panic;
    case ESP_RST_INT_WDT:
      return eki::reset::ResetReason::InterruptWatchdog;
    case ESP_RST_TASK_WDT:
      return eki::reset::ResetReason::TaskWatchdog;
    case ESP_RST_WDT:
      return eki::reset::ResetReason::OtherWatchdog;
    case ESP_RST_DEEPSLEEP:
      return eki::reset::ResetReason::DeepSleep;
    case ESP_RST_BROWNOUT:
      return eki::reset::ResetReason::Brownout;
    case ESP_RST_SDIO:
      return eki::reset::ResetReason::Sdio;
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 1, 0)
    case ESP_RST_USB:
      return eki::reset::ResetReason::Usb;
    case ESP_RST_JTAG:
      return eki::reset::ResetReason::Jtag;
    case ESP_RST_EFUSE:
      return eki::reset::ResetReason::Efuse;
    case ESP_RST_PWR_GLITCH:
      return eki::reset::ResetReason::PowerGlitch;
    case ESP_RST_CPU_LOCKUP:
      return eki::reset::ResetReason::CpuLockup;
#endif
    case ESP_RST_UNKNOWN:
    default:
      return eki::reset::ResetReason::Unknown;
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

bool initializeRequestStrings() {
  const char *base = deviceConfiguration.backendUrl();
  size_t baseLength = std::strlen(base);
  while (baseLength > 0 && base[baseLength - 1] == '/') --baseLength;
  const int telemetryLength = std::snprintf(
    telemetryEndpoint,
    sizeof(telemetryEndpoint),
    "%.*s/api/devices/%s/telemetry",
    static_cast<int>(baseLength),
    base,
    deviceConfiguration.deviceId()
  );
  const int diagnosticsLength = std::snprintf(
    diagnosticsEndpoint,
    sizeof(diagnosticsEndpoint),
    "%.*s/api/devices/%s/diagnostics",
    static_cast<int>(baseLength),
    base,
    deviceConfiguration.deviceId()
  );
  const int authorizationLength = std::snprintf(
    authorizationHeader,
    sizeof(authorizationHeader),
    "Device %s",
    deviceConfiguration.deviceSecret()
  );
  return telemetryLength > 0 &&
         static_cast<size_t>(telemetryLength) < sizeof(telemetryEndpoint) &&
         diagnosticsLength > 0 &&
         static_cast<size_t>(diagnosticsLength) < sizeof(diagnosticsEndpoint) &&
         authorizationLength > 0 &&
         static_cast<size_t>(authorizationLength) < sizeof(authorizationHeader);
}

uint32_t telemetryConfigurationTag() {
  uint32_t hash = 2166136261UL;
  const char *values[] = {
    deviceConfiguration.provisioned()
      ? deviceConfiguration.deviceId()
      : hardwareDeviceLabel,
    deviceConfiguration.provisioned()
      ? deviceConfiguration.backendUrl()
      : "unprovisioned",
  };
  for (const char *value : values) {
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

  // Keep a fresh, monotonic-time-anchored GNSS reference for the asynchronous
  // SNTP callback. TinyGPS++ age accounts for time since this sentence arrived.
  const uint32_t timeAgeMs = gps.time.age();
  portENTER_CRITICAL(&clockCrossCheckMux);
  latestGnssEpochMs = gnssEpochMs;
  latestGnssReferenceAt = millis() - timeAgeMs;
  latestGnssReferenceValid = true;
  portEXIT_CRITICAL(&clockCrossCheckMux);

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
  if (!deviceConfiguration.provisioned()) return;
  // Credential-fault mode is AP-only: the station link is intentionally
  // dropped and must stay down until the device is re-provisioned.
  if (credentialFaultActive) return;
  tlsClient.stop();
  if (!wifiConfigured) {
    configureStationRadio();
    WiFi.begin(
      deviceConfiguration.wifiSsid(),
      deviceConfiguration.wifiPassword()
    );
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

void latchCredentialFault() {
  if (credentialFaultActive) return;
  credentialFaultActive = true;
  resetHttpsRetry();
  // Rejected credentials make the station link useless, and leaving it up
  // exposes the recovery portal on the campus STA interface (the AP password
  // only guards the soft-AP path). Drop the station and stop auto-reconnect
  // until the device is re-provisioned and restarts.
  WiFi.setAutoReconnect(false);
  const bool disconnected = WiFi.disconnect(true, false);
  const bool radioDisabled = WiFi.mode(WIFI_OFF);
  if (!disconnected || !radioDisabled || WiFi.getMode() != WIFI_MODE_NULL) {
    Serial.println(
      "[Security] Station isolation reported a failure; recovery portal will remain disabled unless AP-only mode is verified."
    );
  }
  updateConnectivityFault();
}

void serviceConnectivity() {
  const uint32_t now = millis();
  recoveryPortal.handleClient();
  if (recoveryPortal.consumeConfigurationUpdated()) {
    Serial.println("[Provisioning] Valid NVS configuration stored; restarting.");
    delay(250);
    ESP.restart();
  }
  if (recoveryPortal.consumeRecoveryRotationRequested()) {
    // Give the operator a couple of seconds to receive and save the new
    // password before the AP restarts with it.
    Serial.println("[Provisioning] Recovery AP password rotated; restarting in 2s.");
    delay(2500);
    ESP.restart();
  }

  if (!deviceConfiguration.provisioned()) {
    if (!recoveryPortal.active()) {
      if (recoveryPortal.start(
        hardwareDeviceLabel,
        recoveryAccess,
        deviceConfiguration,
        false
      )) {
        Serial.printf(
          "[Provisioning] Unprovisioned device; connect to %s and open http://192.168.4.1.\n",
          recoveryPortal.accessPointSsid()
        );
      } else {
        Serial.println("[Provisioning] Unable to start local provisioning portal.");
      }
    }
    updateConnectivityFault();
    return;
  }

  const bool connected = WiFi.status() == WL_CONNECTED;
  wifiRetrySupervisor.observe(connected, now);

  if (connected && recoveryPortal.active() && !credentialFaultActive) {
    recoveryPortal.stop();
    Serial.println("[WiFi] Connection restored; recovery portal stopped.");
  }

  if (
    (credentialFaultActive ||
      (!connected && wifiRetrySupervisor.recoveryStartDue(now))) &&
    !recoveryPortal.active()
  ) {
    wifiRetrySupervisor.recordRecoveryStartAttempt(now);
    if (recoveryPortal.start(
      deviceConfiguration.deviceId(),
      recoveryAccess,
      deviceConfiguration,
      !credentialFaultActive
    )) {
      Serial.printf(
        "[Provisioning] Protected local configuration mode active at http://192.168.4.1 on AP %s.\n",
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

void onNtpTimeSynchronized(struct timeval *ntpTime) {
  const uint32_t now = millis();
  bool comparableToGnss = false;
  int64_t divergenceMs = 0;

  portENTER_CRITICAL(&clockCrossCheckMux);
  if (
    latestGnssReferenceValid &&
    now - latestGnssReferenceAt <= GNSS_UTC_MAX_AGE_MS * 2
  ) {
    const int64_t projectedGnssEpochMs =
      latestGnssEpochMs + static_cast<int64_t>(now - latestGnssReferenceAt);
    const int64_t ntpEpochMs =
      static_cast<int64_t>(ntpTime->tv_sec) * 1000 + ntpTime->tv_usec / 1000;
    divergenceMs = ntpEpochMs - projectedGnssEpochMs;
    comparableToGnss = true;
  }
  pendingNtpDivergenceMs = divergenceMs;
  pendingNtpCrossCheckHasGnss = comparableToGnss;
  pendingNtpCrossCheck = true;
  portEXIT_CRITICAL(&clockCrossCheckMux);
}

void reportNtpCrossCheck() {
  bool pending = false;
  bool comparedWithGnss = false;
  int64_t divergenceMs = 0;
  portENTER_CRITICAL(&clockCrossCheckMux);
  pending = pendingNtpCrossCheck;
  if (pending) {
    comparedWithGnss = pendingNtpCrossCheckHasGnss;
    divergenceMs = pendingNtpDivergenceMs;
    pendingNtpCrossCheck = false;
  }
  portEXIT_CRITICAL(&clockCrossCheckMux);

  if (!pending) return;
  if (comparedWithGnss) {
    Serial.printf(
      "[Clock] NTP/GNSS divergence=%lldms; GNSS discipline remains authoritative.\n",
      static_cast<long long>(divergenceMs)
    );
  } else {
    Serial.println(
      "[Clock] NTP fallback synchronized system time; awaiting fresh GNSS UTC cross-check."
    );
  }
}

PublishResult publishFix(const TelemetryFix &fix) {
  if (
    !fix.valid ||
    !deviceConfiguration.provisioned() ||
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

  char payload[512]{};
  const size_t payloadLength = serializeJson(document, payload, sizeof(payload));
  if (payloadLength == 0 || payloadLength >= sizeof(payload)) {
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
  const int responseCode = http.POST(
    reinterpret_cast<uint8_t *>(payload),
    payloadLength
  );
  const eki::telemetry::HttpResponseAction action =
    eki::telemetry::httpResponseAction(responseCode);
  const uint32_t retryAfterMs = responseCode == 429
    ? eki::telemetry::retryAfterDelayMs(http.header("Retry-After").c_str())
    : 0;
  if (responseCode < 0) {
    Serial.printf(
      "[HTTPS] Transport failure %d in %lums (RSSI %d dBm). Check DNS, hostname, CA, clock, and backend reachability.\n",
      responseCode,
      static_cast<unsigned long>(elapsed(startedAt)),
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
      static_cast<unsigned long>(elapsed(startedAt)),
      payloadLength,
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
      latchCredentialFault();
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

bool remoteDiagnosticIsDue() {
  return remoteDiagnosticAttempted
    ? elapsed(lastRemoteDiagnosticAt) >= REMOTE_DIAGNOSTIC_INTERVAL_MS
    : millis() >= FIRST_REMOTE_DIAGNOSTIC_DELAY_MS;
}

void publishRemoteDiagnostic() {
  if (
    !deviceConfiguration.provisioned() ||
    WiFi.status() != WL_CONNECTED ||
    !clockIsSynchronized() ||
    credentialFaultActive ||
    !remoteDiagnosticIsDue()
  ) return;

  const TelemetryQueue::Stats queue = telemetryQueueStats();
  const HealthCounters counters = healthCounters();
  const eki::reset::ResetStats resets = resetStats;
  const eki::connectivity::FaultCode fault = currentDeviceFault();
  JsonDocument document;
  document["firmwareVersion"] = EKI_FIRMWARE_VERSION;
  document["uptimeMs"] = millis();
  document["freeHeapBytes"] = ESP.getFreeHeap();
  document["rssiDbm"] = WiFi.RSSI();
  document["queueDepth"] = queue.depth;
  document["queueHighWater"] = queue.highWaterMark;
  document["queueOverflowDrops"] = queue.overflowDrops;
  document["queueStaleDrops"] = queue.staleDrops;
  document["acceptedFixes"] = counters.acceptedFixes;
  document["rejectedFixes"] = counters.rejectedFixes;
  document["nmeaChecksumFailures"] = gps.failedChecksum();
  document["uartBufferOverflows"] = counters.uartBufferOverflows;
  document["uartFifoOverflows"] = counters.uartFifoOverflows;
  document["resetTotal"] = resets.total();
  document["fault"] = faultCodeName(fault);
  document["flashEncryption"] = flashEncryptionActive;
  document["secureBoot"] = secureBootActive;
  document["timestamp"] = epochMilliseconds();

  char payload[1024]{};
  const size_t payloadLength = serializeJson(document, payload, sizeof(payload));
  remoteDiagnosticAttempted = true;
  lastRemoteDiagnosticAt = millis();
  if (payloadLength == 0 || payloadLength >= sizeof(payload)) {
    Serial.println("[Diagnostics] Refusing oversized health payload.");
    return;
  }

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(tlsClient, diagnosticsEndpoint)) {
    Serial.println("[Diagnostics] Unable to initialize remote health request.");
    return;
  }
  http.addHeader("Authorization", authorizationHeader);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Cache-Control", "no-store");
  const uint32_t startedAt = millis();
  const int responseCode = http.POST(
    reinterpret_cast<uint8_t *>(payload),
    payloadLength
  );
  http.end();
  Serial.printf(
    "[Diagnostics] Remote health HTTP %d in %lums.\n",
    responseCode,
    static_cast<unsigned long>(elapsed(startedAt))
  );
  if (responseCode == 401 || responseCode == 403) {
    latchCredentialFault();
    Serial.println("[Diagnostics] Credential fault latched; local reprovisioning enabled.");
  }
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
  const double rawSpeed = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
  if (!eki::telemetry::speedIsPlausible(rawSpeed)) return fix;
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
    reportNtpCrossCheck();

    bool drainedSample = false;
    if (deviceConfiguration.provisioned() && WiFi.status() == WL_CONNECTED) {
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
            if (
              result != PublishResult::RetryLatest &&
              result != PublishResult::CredentialFault
            ) {
              removeQueuedFix(fix.sequence);
              recordPublishResult(result == PublishResult::Accepted);
            } else if (result == PublishResult::CredentialFault) {
              recordPublishResult(false);
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
      if (!drainedSample) publishRemoteDiagnostic();
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
  // ResetStats is touched only by this (loop) task: setup() records and
  // reportHealth() reads, so a plain copy is race-free.
  const eki::reset::ResetStats resets = resetStats;
  const eki::connectivity::FaultCode fault = currentDeviceFault();
  Serial.printf(
    "[Health] fault=%s queue=%u/%u high-water=%u overflow-drops=%lu stale-drops=%lu; accepted=%lu rejected=%lu; NMEA checksum-failures=%lu UART-buffer-overflows=%lu UART-FIFO-overflows=%lu; resets: poweron=%u brownout=%u panic=%u task-wdt=%u int-wdt=%u sw=%u other=%u total=%u.\n",
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
    static_cast<unsigned long>(counters.uartFifoOverflows),
    static_cast<unsigned>(resets.count(eki::reset::ResetReason::PowerOn)),
    static_cast<unsigned>(resets.count(eki::reset::ResetReason::Brownout)),
    static_cast<unsigned>(resets.count(eki::reset::ResetReason::Panic)),
    static_cast<unsigned>(resets.count(eki::reset::ResetReason::TaskWatchdog)),
    static_cast<unsigned>(resets.count(eki::reset::ResetReason::InterruptWatchdog)),
    static_cast<unsigned>(resets.count(eki::reset::ResetReason::Software)),
    static_cast<unsigned>(resets.otherCount()),
    static_cast<unsigned>(resets.total())
  );
}
} // namespace

void setup() {
  Serial.begin(115200);
  std::snprintf(
    hardwareDeviceLabel,
    sizeof(hardwareDeviceLabel),
    "%012llX",
    static_cast<unsigned long long>(ESP.getEfuseMac() & 0xFFFFFFFFFFFFULL)
  );
  flashEncryptionActive = esp_flash_encryption_enabled();
  secureBootActive = esp_secure_boot_enabled();
  Serial.printf(
    "[Security] fleet-build=%s flash-encryption=%s secure-boot=%s.\n",
    EKI_FLEET_BUILD ? "yes" : "no",
    flashEncryptionActive ? "enabled" : "disabled",
    secureBootActive ? "enabled" : "disabled"
  );
  if (EKI_FLEET_BUILD && (!flashEncryptionActive || !secureBootActive)) {
    Serial.println(
      "[Security] Fleet firmware refuses to run until Flash Encryption and Secure Boot V2 are both verified."
    );
    while (true) delay(1000);
  }
  if (!recoveryAccess.loadOrCreate()) {
    Serial.println("[Boot] Unable to create protected local recovery access; halted.");
    while (true) delay(1000);
  }
  const bool provisioned = deviceConfiguration.load();
  if (!provisioned) {
    Serial.printf(
      "[Provisioning] Record this one-device recovery password over the controlled serial connection: %s\n",
      recoveryAccess.password()
    );
  }
  const uint32_t configurationTag = telemetryConfigurationTag();
  const esp_reset_reason_t espBootReason = esp_reset_reason();
  const eki::reset::ResetReason bootReason = resetReasonFromEsp(espBootReason);
  const bool resetStatsRecovered = resetStats.initializeOrRecover(
    configurationTag
  );
  resetStats.record(bootReason);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);
  const size_t gpsRxBuffer = gpsSerial.setRxBufferSize(GPS_RX_BUFFER_BYTES);
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
  gpsSerial.onReceiveError(onGpsSerialError);
  delay(500);

  Serial.printf(
    "[Boot] Reset cause=%s (%d, total %u); stats %s; poweron=%u brownout=%u panic=%u task-wdt=%u int-wdt=%u sw=%u other=%u.\n",
    eki::reset::resetReasonName(bootReason),
    static_cast<int>(espBootReason),
    static_cast<unsigned>(resetStats.total()),
    resetStatsRecovered ? "recovered" : "initialized",
    static_cast<unsigned>(resetStats.count(eki::reset::ResetReason::PowerOn)),
    static_cast<unsigned>(resetStats.count(eki::reset::ResetReason::Brownout)),
    static_cast<unsigned>(resetStats.count(eki::reset::ResetReason::Panic)),
    static_cast<unsigned>(resetStats.count(eki::reset::ResetReason::TaskWatchdog)),
    static_cast<unsigned>(resetStats.count(eki::reset::ResetReason::InterruptWatchdog)),
    static_cast<unsigned>(resetStats.count(eki::reset::ResetReason::Software)),
    static_cast<unsigned>(resetStats.otherCount())
  );

  Serial.printf(
    "[Boot] Device configuration=%s; credential values are not logged.\n",
    provisioned ? "validated NVS record" : "awaiting local provisioning"
  );

  portENTER_CRITICAL(&telemetryQueueMux);
  const bool queueRecovered = telemetryQueue.initializeOrRecover(
    configurationTag
  );
  const TelemetryQueue::Stats bootQueue = telemetryQueue.stats();
  portEXIT_CRITICAL(&telemetryQueueMux);
  Serial.printf(
    "[Boot] Eki asynchronous HTTPS telemetry; GNSS RX buffer=%u bytes; RTC queue=%s (%u/%u).\n",
    gpsRxBuffer,
    queueRecovered ? "recovered" : "initialized",
    bootQueue.depth,
    static_cast<unsigned>(TELEMETRY_QUEUE_CAPACITY)
  );

  if (provisioned) {
    tlsClient.setCACert(deviceConfiguration.backendRootCa());
    if (!initializeRequestStrings()) {
      Serial.println("[Boot] Provisioned request configuration is too long; halted.");
      while (true) delay(1000);
    }
  }
  sntp_set_time_sync_notification_cb(onNtpTimeSynchronized);
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
