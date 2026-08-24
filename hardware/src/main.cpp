#include "clock_policy.h"
#include "connectivity_policy.h"
#include "firmware_config.h"
#include "firmware_update_policy.h"
#include "secrets.h"
#include "telemetry_policy.h"
#include "telemetry_queue.h"
#include "reset_stats.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <TinyGPSPlus.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <esp_attr.h>
#include <esp_flash_encrypt.h>
#include <esp_sntp.h>
#include <esp_secure_boot.h>
#include <esp_system.h>
#include <esp_idf_version.h>
#include <esp_ota_ops.h>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mbedtls/sha256.h>
#include <cstdio>
#include <cstring>
#include <limits>
#include <sys/time.h>

#ifndef EKI_FLEET_BUILD
#define EKI_FLEET_BUILD 0
#endif
#if EKI_FLEET_BUILD
#define EKI_FIRMWARE_VERSION esp_ota_get_app_description()->version
#elif !defined(EKI_FIRMWARE_VERSION)
#define EKI_FIRMWARE_VERSION "development"
#endif
#ifndef EKI_FIRMWARE_SEQUENCE
#define EKI_FIRMWARE_SEQUENCE 0
#endif

#if EKI_FLEET_BUILD
static_assert(EKI_FIRMWARE_SEQUENCE > 0, "Fleet firmware requires a positive release sequence.");
static_assert(
  eki::config::literalStartsWith(
    BACKEND_URL,
    sizeof(BACKEND_URL) - 1,
    "https://",
    sizeof("https://") - 1
  ),
  "Fleet builds require an HTTPS BACKEND_URL in secrets.h."
);
#endif

#if EKI_FLEET_BUILD
#if !defined(CONFIG_ESP32_REV_MIN_3) || !CONFIG_ESP32_REV_MIN_3
#error "Fleet builds require ESP32 ECO3 or newer."
#endif
#if !defined(CONFIG_SECURE_BOOT) || !CONFIG_SECURE_BOOT
#error "Fleet builds require secure boot."
#endif
#if !defined(CONFIG_SECURE_BOOT_V2_ENABLED) || !CONFIG_SECURE_BOOT_V2_ENABLED
#error "Fleet builds require Secure Boot V2."
#endif
#if !defined(CONFIG_SECURE_BOOT_BUILD_SIGNED_BINARIES) || !CONFIG_SECURE_BOOT_BUILD_SIGNED_BINARIES
#error "Fleet builds require signed application binaries."
#endif
#if !defined(CONFIG_SECURE_FLASH_ENC_ENABLED) || !CONFIG_SECURE_FLASH_ENC_ENABLED
#error "Fleet builds require flash encryption."
#endif
#if !defined(CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE) || !CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE
#error "Fleet builds require bootloader application rollback."
#endif
#if !defined(CONFIG_SECURE_FLASH_ENCRYPTION_MODE_RELEASE) || !CONFIG_SECURE_FLASH_ENCRYPTION_MODE_RELEASE
#error "Fleet builds require release-mode flash encryption."
#endif
#if !defined(CONFIG_SECURE_DISABLE_ROM_DL_MODE) || !CONFIG_SECURE_DISABLE_ROM_DL_MODE
#error "Fleet builds require ROM download mode lockdown."
#endif
#endif

namespace {
constexpr double HDOP_REJECT_THRESHOLD = 4.0;
constexpr uint32_t GNSS_UTC_MAX_AGE_MS = 2000;
constexpr uint32_t GNSS_EPOCH_REFERENCE_MAX_AGE_MS = 24UL * 60 * 60 * 1000;
constexpr uint32_t NTP_CROSS_CHECK_INTERVAL_MS = 6UL * 60 * 60 * 1000;
constexpr uint32_t HTTP_TIMEOUT_MS = 7000;
constexpr uint32_t WATCHDOG_TIMEOUT_MS = 25000;
constexpr size_t TELEMETRY_QUEUE_CAPACITY = 120;
constexpr uint32_t FIRST_REMOTE_DIAGNOSTIC_DELAY_MS = 30000;
constexpr uint32_t REMOTE_DIAGNOSTIC_INTERVAL_MS = 5UL * 60 * 1000;

const char *httpTransportFailureName(int code) {
  switch (code) {
    case HTTPC_ERROR_CONNECTION_REFUSED: return "connection refused";
    case HTTPC_ERROR_SEND_HEADER_FAILED: return "header send failed";
    case HTTPC_ERROR_SEND_PAYLOAD_FAILED: return "payload send failed";
    case HTTPC_ERROR_NOT_CONNECTED: return "not connected";
    case HTTPC_ERROR_CONNECTION_LOST: return "connection lost";
    case HTTPC_ERROR_NO_STREAM: return "no stream";
    case HTTPC_ERROR_NO_HTTP_SERVER: return "invalid HTTP server";
    case HTTPC_ERROR_TOO_LESS_RAM: return "insufficient RAM";
    case HTTPC_ERROR_ENCODING: return "unsupported encoding";
    case HTTPC_ERROR_STREAM_WRITE: return "stream write failed";
    case HTTPC_ERROR_READ_TIMEOUT: return "read timeout";
    default: return "unknown transport error";
  }
}
constexpr uint32_t PUBLISHER_IDLE_MS = 100;
constexpr uint32_t PUBLISHER_TASK_STACK_BYTES = 20480;
constexpr UBaseType_t PUBLISHER_TASK_PRIORITY = 1;
// Network work runs on another core, but this buffer still absorbs scheduler
// jitter and diagnostic output without risking NMEA loss.
constexpr size_t GPS_RX_BUFFER_BYTES = 8192;
constexpr uint8_t STATUS_LED_PIN = 2;

TinyGPSPlus gps;
HardwareSerial &gpsSerial = Serial2;
WiFiClientSecure tlsClient;
WiFiClient plainClient;
#if EKI_FLEET_BUILD
WiFiClientSecure firmwareTlsClient;
#endif

constexpr size_t ENDPOINT_MAX_LENGTH =
  eki::config::BACKEND_URL_MAX_LENGTH +
  eki::config::DEVICE_ID_MAX_LENGTH + 64;
char telemetryEndpoint[ENDPOINT_MAX_LENGTH]{};
char diagnosticsEndpoint[ENDPOINT_MAX_LENGTH]{};
char firmwareEndpoint[ENDPOINT_MAX_LENGTH]{};
char authorizationHeader[eki::config::DEVICE_SECRET_MAX_LENGTH + 8]{};
bool flashEncryptionActive = false;
bool secureBootActive = false;

#if EKI_FLEET_BUILD
struct FirmwareManifest {
  char version[eki::update::VERSION_MAX_LENGTH + 1];
  char url[eki::update::URL_MAX_LENGTH + 1];
  char sha256[eki::update::SHA256_HEX_LENGTH + 1];
  uint32_t sequence;
  size_t size;
};

bool otaValidationPending = false;
uint32_t otaValidationStartedAt = 0;
bool firmwareCheckedBefore = false;
bool previousFirmwareCheckFailed = false;
uint32_t lastFirmwareCheckAt = 0;
#endif

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
uint32_t lastRemoteDiagnosticAt = 0;
bool remoteDiagnosticPublished = false;
uint32_t remoteDiagnosticRetryStartedAt = 0;
uint32_t remoteDiagnosticRetryDelayMs = 0;
uint8_t consecutiveRemoteDiagnosticFailures = 0;
uint8_t consecutiveHttpsFailures = 0;
bool ntpCrossCheckStarted = false;
bool gnssClockApplied = false;
bool timeRangeWarningLogged = false;
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
bool trustworthyGpsFixObserved = false;
bool wifiStatusKnown = false;
bool lastWifiConnected = false;
bool gnssStatusKnown = false;
bool lastGnssConnected = false;
bool lossMessageQueued = false;
bool wifiConfigured = false;

WiFiClient &getNetworkClient() {
  if (std::strncmp(BACKEND_URL, "http://", 7) == 0) {
    return plainClient;
  }
  return tlsClient;
}
eki::connectivity::WifiRetrySupervisor wifiRetrySupervisor;
portMUX_TYPE deviceFaultMux = portMUX_INITIALIZER_UNLOCKED;
eki::connectivity::FaultCode deviceFault = eki::connectivity::FaultCode::None;
uint32_t uartBufferOverflowCount = 0;
uint32_t uartFifoOverflowCount = 0;
uint32_t acceptedFixCount = 0;
uint32_t rejectedFixCount = 0;
uint32_t nmeaChecksumFailureCount = 0;

struct HealthCounters {
  uint32_t uartBufferOverflows;
  uint32_t uartFifoOverflows;
  uint32_t acceptedFixes;
  uint32_t rejectedFixes;
  uint32_t nmeaChecksumFailures;
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

size_t acknowledgeQueuedFix(uint32_t sequence) {
  portENTER_CRITICAL(&telemetryQueueMux);
  const size_t removed = telemetryQueue.acknowledgeThrough(sequence);
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
    nmeaChecksumFailureCount,
  };
  portEXIT_CRITICAL(&healthMetricsMux);
  return counters;
}

bool initializeRequestStrings() {
  const char *base = BACKEND_URL;
  size_t baseLength = std::strlen(base);
  while (baseLength > 0 && base[baseLength - 1] == '/') --baseLength;
  const int telemetryLength = std::snprintf(
    telemetryEndpoint,
    sizeof(telemetryEndpoint),
    "%.*s/api/devices/%s/telemetry",
    static_cast<int>(baseLength),
    base,
    DEVICE_ID
  );
  const int diagnosticsLength = std::snprintf(
    diagnosticsEndpoint,
    sizeof(diagnosticsEndpoint),
    "%.*s/api/devices/%s/diagnostics",
    static_cast<int>(baseLength),
    base,
    DEVICE_ID
  );
  const int firmwareLength = std::snprintf(
    firmwareEndpoint,
    sizeof(firmwareEndpoint),
    "%.*s/api/devices/%s/firmware?sequence=%u",
    static_cast<int>(baseLength),
    base,
    DEVICE_ID,
    static_cast<unsigned>(EKI_FIRMWARE_SEQUENCE)
  );
  const int authorizationLength = std::snprintf(
    authorizationHeader,
    sizeof(authorizationHeader),
    "Device %s",
    DEVICE_SECRET
  );
  return telemetryLength > 0 &&
         static_cast<size_t>(telemetryLength) < sizeof(telemetryEndpoint) &&
         diagnosticsLength > 0 &&
         static_cast<size_t>(diagnosticsLength) < sizeof(diagnosticsEndpoint) &&
         firmwareLength > 0 &&
         static_cast<size_t>(firmwareLength) < sizeof(firmwareEndpoint) &&
         authorizationLength > 0 &&
         static_cast<size_t>(authorizationLength) < sizeof(authorizationHeader);
}

uint32_t telemetryConfigurationTag() {
  uint32_t hash = 2166136261UL;
  const char *values[] = {DEVICE_ID, BACKEND_URL};
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

int64_t systemEpochMilliseconds() {
  timeval tv{};
  gettimeofday(&tv, nullptr);
  return static_cast<int64_t>(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

int64_t epochMilliseconds() {
  const uint32_t now = millis();
  int64_t epochMs = 0;
  portENTER_CRITICAL(&clockCrossCheckMux);
  eki::clock::projectEpochMillisecondsFromReference(
    latestGnssReferenceValid,
    latestGnssEpochMs,
    latestGnssReferenceAt,
    now,
    GNSS_EPOCH_REFERENCE_MAX_AGE_MS,
    epochMs
  );
  portEXIT_CRITICAL(&clockCrossCheckMux);
  return epochMs >= eki::clock::TRUSTED_EPOCH_MIN_MS
    ? epochMs
    : systemEpochMilliseconds();
}

void expireGnssEpochReference(uint32_t now) {
  int64_t ignoredEpochMs = 0;
  portENTER_CRITICAL(&clockCrossCheckMux);
  eki::clock::projectEpochMillisecondsFromReference(
    latestGnssReferenceValid,
    latestGnssEpochMs,
    latestGnssReferenceAt,
    now,
    GNSS_EPOCH_REFERENCE_MAX_AGE_MS,
    ignoredEpochMs
  );
  portEXIT_CRITICAL(&clockCrossCheckMux);
}

bool clockIsSynchronized() {
  return epochMilliseconds() >= eki::clock::TRUSTED_EPOCH_MIN_MS;
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
    if (!timeRangeWarningLogged) {
      Serial.println(
        "[Clock] System time_t range exhausted; telemetry continues on the 64-bit GNSS clock. TLS depends on platform support."
      );
      timeRangeWarningLogged = true;
    }
    return;
  }

  const int64_t systemEpochMs = systemEpochMilliseconds();
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
  if (!initialSynchronization) {
    Serial.printf(
      "[Clock] GNSS UTC corrected system clock by %lldms; NTP remains a cross-check.\n",
      static_cast<long long>(eki::clock::absoluteDifference(systemEpochMs, gnssEpochMs))
    );
  }
}

void configureStationRadio() {
  // This must be set before mode() initializes the driver; setting it later
  // leaves the Arduino Wi-Fi layer backed by flash for the current boot.
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  // The tracker is vehicle-powered. Disabling modem sleep avoids periodic
  // wake latency during short HTTPS telemetry bursts.
  WiFi.setSleep(false);
  WiFi.setScanMethod(WIFI_FAST_SCAN);
  WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);
}

void attemptWifiConnection() {
  if (credentialFaultActive) return;
  getNetworkClient().stop();
  if (!wifiConfigured) {
    configureStationRadio();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    wifiConfigured = true;
  } else {
    WiFi.reconnect();
  }
}

void updateConnectivityFault() {
  setDeviceFault(
    credentialFaultActive
      ? eki::connectivity::FaultCode::CredentialRejected
      : eki::connectivity::FaultCode::None
  );
}

[[noreturn]] void haltWithStatusLed(uint8_t pulseCount, bool feedWatchdog = false) {
  while (true) {
    if (feedWatchdog) esp_task_wdt_reset();
    digitalWrite(
      STATUS_LED_PIN,
      eki::connectivity::pulsePatternLedOn(pulseCount, millis()) ? HIGH : LOW
    );
    delay(25);
  }
}

void latchCredentialFault() {
  if (credentialFaultActive) return;
  credentialFaultActive = true;
  resetHttpsRetry();
  // Compile-time credentials can only be replaced by reflashing. Stop the
  // radio after a definitive rejection so the device cannot retry stale
  // credentials until corrected firmware is installed.
  WiFi.setAutoReconnect(false);
  const bool disconnected = WiFi.disconnect(true, false);
  const bool radioDisabled = WiFi.mode(WIFI_OFF);
  if (!disconnected || !radioDisabled || WiFi.getMode() != WIFI_MODE_NULL) {
    Serial.println("[Security] Station isolation reported a failure.");
  }
  updateConnectivityFault();
}

void serviceConnectivity() {
  const uint32_t now = millis();
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (!wifiStatusKnown || connected != lastWifiConnected) {
    wifiStatusKnown = true;
    lastWifiConnected = connected;
    Serial.printf(
      "[WiFi] %s.\n",
      connected ? "Connected" : "Not connected; waiting"
    );
  }
  wifiRetrySupervisor.observe(connected, now);
  if (!connected && !credentialFaultActive && wifiRetrySupervisor.attemptDue(now)) {
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
  if (result != ESP_OK || addResult != ESP_OK) {
    Serial.printf(
      "[Watchdog] Setup failed (configure=%d, subscribe=%d).\n",
      result,
      addResult
    );
  }
}

void synchronizeClock() {
  if (
    ntpCrossCheckStarted &&
    elapsed(lastNtpCrossCheckAt) < NTP_CROSS_CHECK_INTERVAL_MS
  ) return;
  lastNtpCrossCheckAt = millis();
  ntpCrossCheckStarted = true;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
}

void onNtpTimeSynchronized(struct timeval *ntpTime) {
  const uint32_t now = millis();
  bool comparableToGnss = false;
  int64_t divergenceMs = 0;

  portENTER_CRITICAL(&clockCrossCheckMux);
  int64_t projectedGnssEpochMs = 0;
  if (
    latestGnssReferenceValid &&
    eki::clock::projectEpochMillisecondsIfFresh(
      latestGnssEpochMs,
      latestGnssReferenceAt,
      now,
      GNSS_UTC_MAX_AGE_MS * 2,
      projectedGnssEpochMs
    )
  ) {
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

#if EKI_FLEET_BUILD
bool decodeSha256(const char *hex, uint8_t output[32]) {
  if (!eki::update::sha256IsValid(hex)) return false;
  const auto nibble = [](char value) -> uint8_t {
    if (value >= '0' && value <= '9') return static_cast<uint8_t>(value - '0');
    if (value >= 'a' && value <= 'f') return static_cast<uint8_t>(value - 'a' + 10);
    return static_cast<uint8_t>(value - 'A' + 10);
  };
  for (size_t index = 0; index < 32; ++index) {
    output[index] = static_cast<uint8_t>(
      (nibble(hex[index * 2]) << 4) | nibble(hex[index * 2 + 1])
    );
  }
  return true;
}

void initializeOtaRollbackState() {
  const esp_partition_t *running = esp_ota_get_running_partition();
  esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
  if (
    running != nullptr &&
    esp_ota_get_state_partition(running, &state) == ESP_OK &&
    state == ESP_OTA_IMG_PENDING_VERIFY
  ) {
    otaValidationPending = true;
    otaValidationStartedAt = millis();
    Serial.println(
      "[OTA] Candidate image pending backend health validation before it becomes permanent."
    );
  }
}

void markOtaValidAfterBackendAcceptance() {
  if (!otaValidationPending) return;
  if (esp_ota_mark_app_valid_cancel_rollback() != ESP_OK) {
    Serial.println("[OTA] Unable to confirm candidate image; preserving rollback state.");
    return;
  }
  otaValidationPending = false;
  Serial.println("[OTA] Candidate image validated by authenticated backend acceptance.");
}

void enforceOtaValidationDeadline() {
  if (
    !otaValidationPending ||
    elapsed(otaValidationStartedAt) < eki::update::ROLLBACK_VALIDATION_TIMEOUT_MS
  ) return;
  Serial.println("[OTA] Candidate failed backend validation; rolling back.");
  delay(50);
  esp_ota_mark_app_invalid_rollback_and_reboot();
  ESP.restart();
}

bool parseFirmwareManifest(HTTPClient &http, FirmwareManifest &manifest) {
  const int contentLength = http.getSize();
  if (contentLength <= 0 || contentLength > 1024) return false;
  JsonDocument document;
  const DeserializationError error = deserializeJson(document, http.getStream());
  if (error) return false;

  const char *version = document["version"] | "";
  const char *url = document["url"] | "";
  const char *sha256 = document["sha256"] | "";
  if (
    !document["sequence"].is<uint32_t>() ||
    !document["size"].is<size_t>()
  ) return false;
  const uint32_t sequence = document["sequence"].as<uint32_t>();
  const size_t size = document["size"].as<size_t>();
  if (!eki::update::manifestIsValid(
    version,
    sequence,
    url,
    sha256,
    size,
    EKI_FIRMWARE_SEQUENCE
  )) return false;

  std::strncpy(manifest.version, version, sizeof(manifest.version) - 1);
  std::strncpy(manifest.url, url, sizeof(manifest.url) - 1);
  std::strncpy(manifest.sha256, sha256, sizeof(manifest.sha256) - 1);
  manifest.version[sizeof(manifest.version) - 1] = '\0';
  manifest.url[sizeof(manifest.url) - 1] = '\0';
  manifest.sha256[sizeof(manifest.sha256) - 1] = '\0';
  manifest.sequence = sequence;
  manifest.size = size;
  return true;
}

bool installSignedFirmware(const FirmwareManifest &manifest) {
  const esp_partition_t *candidatePartition = esp_ota_get_next_update_partition(nullptr);
  if (candidatePartition == nullptr || manifest.size > candidatePartition->size) {
    Serial.println("[OTA] No inactive application slot can accept this release.");
    return false;
  }
  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(15000);
  // The device credential is deliberately not attached to the artifact-host
  // request. Secure Boot authenticates the image; this digest binds the exact
  // immutable object selected by the authenticated backend manifest.
  if (!http.begin(firmwareTlsClient, manifest.url)) {
    Serial.println("[OTA] Unable to initialize signed-image download.");
    return false;
  }
  const int responseCode = http.GET();
  const int contentLength = http.getSize();
  if (
    responseCode != 200 ||
    contentLength <= 0 ||
    static_cast<size_t>(contentLength) != manifest.size
  ) {
    Serial.printf("[OTA] Signed-image response rejected (HTTP %d, size %d).\n", responseCode, contentLength);
    http.end();
    firmwareTlsClient.stop();
    return false;
  }
  if (!Update.begin(manifest.size, U_FLASH)) {
    Serial.printf("[OTA] Inactive slot cannot accept image (error %u).\n", Update.getError());
    http.end();
    return false;
  }

  mbedtls_sha256_context hashContext;
  mbedtls_sha256_init(&hashContext);
  if (mbedtls_sha256_starts_ret(&hashContext, 0) != 0) {
    mbedtls_sha256_free(&hashContext);
    Update.abort();
    http.end();
    return false;
  }

  WiFiClient *stream = http.getStreamPtr();
  uint8_t buffer[2048];
  size_t received = 0;
  uint32_t lastProgressAt = millis();
  bool streamOk = true;
  while (received < manifest.size) {
    esp_task_wdt_reset();
    const size_t available = stream->available();
    if (available == 0) {
      if (!http.connected() || elapsed(lastProgressAt) >= 15000) {
        streamOk = false;
        break;
      }
      delay(1);
      continue;
    }
    const size_t requested = min(
      sizeof(buffer),
      min(available, manifest.size - received)
    );
    const int count = stream->readBytes(buffer, requested);
    if (count <= 0) {
      streamOk = false;
      break;
    }
    if (
      mbedtls_sha256_update_ret(&hashContext, buffer, count) != 0 ||
      Update.write(buffer, count) != static_cast<size_t>(count)
    ) {
      streamOk = false;
      break;
    }
    received += static_cast<size_t>(count);
    lastProgressAt = millis();
  }

  uint8_t actualDigest[32]{};
  const bool digestFinished =
    mbedtls_sha256_finish_ret(&hashContext, actualDigest) == 0;
  mbedtls_sha256_free(&hashContext);
  uint8_t expectedDigest[32]{};
  const bool digestMatches =
    digestFinished &&
    decodeSha256(manifest.sha256, expectedDigest) &&
    std::memcmp(actualDigest, expectedDigest, sizeof(actualDigest)) == 0;

  esp_app_desc_t candidateDescription{};
  uint32_t signedSequence = 0;
  const bool descriptorMatches =
    streamOk &&
    received == manifest.size &&
    esp_ota_get_partition_description(
      candidatePartition,
      &candidateDescription
    ) == ESP_OK &&
    std::strncmp(
      candidateDescription.version,
      manifest.version,
      sizeof(candidateDescription.version)
    ) == 0 &&
    eki::update::signedVersionSequence(
      candidateDescription.version,
      signedSequence
    ) &&
    signedSequence == manifest.sequence;

  if (!streamOk || received != manifest.size || !digestMatches || !descriptorMatches) {
    Serial.println(
      "[OTA] Image stream, digest, or signed version/sequence verification failed; inactive slot discarded."
    );
    Update.abort();
    http.end();
    firmwareTlsClient.stop();
    return false;
  }
  if (!Update.end(false) || !Update.isFinished()) {
    Serial.printf("[OTA] Signed image was rejected (error %u).\n", Update.getError());
    http.end();
    return false;
  }
  http.end();
  Serial.printf(
    "[OTA] Installed signed candidate %s (sequence %u); rebooting into rollback validation.\n",
    manifest.version,
    static_cast<unsigned>(manifest.sequence)
  );
  delay(100);
  ESP.restart();
  return true;
}

void checkForSignedFirmware() {
  const TelemetryQueue::Stats queue = telemetryQueueStats();
  if (
    WiFi.status() != WL_CONNECTED ||
    !eki::update::locallySafeToUpdate(
      credentialFaultActive,
      clockIsSynchronized(),
      queue.depth,
      hasCapturedLocation,
      lastCapturedMotionState == MotionState::Stopped,
      otaValidationPending
    ) ||
    !eki::update::checkIsDue(
      millis(),
      firmwareCheckedBefore,
      lastFirmwareCheckAt,
      previousFirmwareCheckFailed
    )
  ) return;

  firmwareCheckedBefore = true;
  lastFirmwareCheckAt = millis();
  previousFirmwareCheckFailed = true;

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(tlsClient, firmwareEndpoint)) {
    Serial.println("[OTA] Unable to initialize authenticated release check.");
    return;
  }
  http.addHeader("Authorization", authorizationHeader);
  http.addHeader("Cache-Control", "no-store");
  const int responseCode = http.GET();
  if (responseCode == 401 || responseCode == 403) {
    http.end();
    latchCredentialFault();
    Serial.println("[OTA] Credential fault latched during release check.");
    return;
  }
  if (responseCode == 204) {
    previousFirmwareCheckFailed = false;
    http.end();
    return;
  }
  FirmwareManifest manifest{};
  if (responseCode != 200 || !parseFirmwareManifest(http, manifest)) {
    Serial.printf("[OTA] Release manifest rejected (HTTP %d).\n", responseCode);
    http.end();
    tlsClient.stop();
    return;
  }
  http.end();
  tlsClient.stop();
  previousFirmwareCheckFailed = !installSignedFirmware(manifest);
}
#endif

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
  if (!http.begin(getNetworkClient(), telemetryEndpoint)) {
    Serial.println("[HTTPS] Unable to initialize telemetry request.");
    scheduleHttpsRetry();
    return eki::telemetry::retryKeepsSampleFresh(
      fix.timestamp,
      epochMilliseconds(),
      httpsRetryDelayMs,
      eki::telemetry::TELEMETRY_FRESHNESS_MARGIN_MS
    ) ? PublishResult::RetryLatest : PublishResult::Dropped;
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
      "[HTTPS] Transport failure %d (%s) in %lums (RSSI %d dBm). Check DNS, hostname, CA, clock, and backend reachability.\n",
      responseCode,
      httpTransportFailureName(responseCode),
      static_cast<unsigned long>(elapsed(startedAt)),
      WiFi.RSSI()
    );
  } else if (action != eki::telemetry::HttpResponseAction::Accept) {
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
      Serial.println("[HTTPS] Credential fault latched; correct secrets.h and reflash the device.");
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
    getNetworkClient().stop();
    if (action == eki::telemetry::HttpResponseAction::HaltCredentials) {
      latchCredentialFault();
      return PublishResult::CredentialFault;
    }
    scheduleHttpsRetry(
      eki::telemetry::minimumHttpRetryDelayMs(responseCode, retryAfterMs)
    );
    const bool retryableAndFresh =
      action == eki::telemetry::HttpResponseAction::RetrySample &&
      eki::telemetry::retryKeepsSampleFresh(
        fix.timestamp,
        epochMilliseconds(),
        httpsRetryDelayMs,
        eki::telemetry::TELEMETRY_FRESHNESS_MARGIN_MS
      );
    return retryableAndFresh ? PublishResult::RetryLatest : PublishResult::Dropped;
  }

  resetHttpsRetry();
#if EKI_FLEET_BUILD
  markOtaValidAfterBackendAcceptance();
#endif
  Serial.printf(
    "[RTDB] lat: %.6f | lng: %.6f\n",
    fix.lat,
    fix.lng
  );
  return PublishResult::Accepted;
}

bool remoteDiagnosticIsDue() {
  if (remoteDiagnosticRetryDelayMs > 0) {
    return elapsed(remoteDiagnosticRetryStartedAt) >= remoteDiagnosticRetryDelayMs;
  }
  return remoteDiagnosticPublished
    ? elapsed(lastRemoteDiagnosticAt) >= REMOTE_DIAGNOSTIC_INTERVAL_MS
    : millis() >= FIRST_REMOTE_DIAGNOSTIC_DELAY_MS;
}

void scheduleRemoteDiagnosticRetry() {
  if (consecutiveRemoteDiagnosticFailures < UINT8_MAX) {
    ++consecutiveRemoteDiagnosticFailures;
  }
  remoteDiagnosticRetryStartedAt = millis();
  remoteDiagnosticRetryDelayMs = eki::telemetry::diagnosticRetryDelayMs(
    consecutiveRemoteDiagnosticFailures,
    esp_random()
  );
}

void publishRemoteDiagnostic() {
  if (
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
  document["nmeaChecksumFailures"] = counters.nmeaChecksumFailures;
  document["uartBufferOverflows"] = counters.uartBufferOverflows;
  document["uartFifoOverflows"] = counters.uartFifoOverflows;
  document["resetTotal"] = resets.total();
  document["fault"] = faultCodeName(fault);
  document["flashEncryption"] = flashEncryptionActive;
  document["secureBoot"] = secureBootActive;
  document["timestamp"] = epochMilliseconds();

  char payload[1024]{};
  const size_t payloadLength = serializeJson(document, payload, sizeof(payload));
  if (payloadLength == 0 || payloadLength >= sizeof(payload)) {
    Serial.println("[Diagnostics] Refusing oversized health payload.");
    scheduleRemoteDiagnosticRetry();
    return;
  }

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(getNetworkClient(), diagnosticsEndpoint)) {
    Serial.println("[Diagnostics] Unable to initialize remote health request.");
    scheduleRemoteDiagnosticRetry();
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
  if (responseCode == 401 || responseCode == 403) {
    latchCredentialFault();
    Serial.println("[Diagnostics] Credential fault latched; firmware reflash required.");
    return;
  }
  if (responseCode >= 200 && responseCode < 300) {
#if EKI_FLEET_BUILD
    markOtaValidAfterBackendAcceptance();
#endif
    remoteDiagnosticPublished = true;
    lastRemoteDiagnosticAt = millis();
    consecutiveRemoteDiagnosticFailures = 0;
    remoteDiagnosticRetryDelayMs = 0;
  } else {
    Serial.printf(
      "[Diagnostics] Remote health failed (HTTP %d, %lums).\n",
      responseCode,
      static_cast<unsigned long>(elapsed(startedAt))
    );
    scheduleRemoteDiagnosticRetry();
  }
}

TelemetryFix currentFix() {
  TelemetryFix fix{};
  if (
    !eki::telemetry::gnssFixFieldsAreFresh(
      gps.location.isValid(),
      gps.location.age(),
      gps.hdop.isValid(),
      gps.hdop.age(),
      gps.speed.isValid(),
      gps.speed.age(),
      gps.course.isValid(),
      gps.course.age()
    ) ||
    gps.hdop.hdop() > HDOP_REJECT_THRESHOLD
  ) {
    // Reject mixed-epoch GNSS fields as one sample; publishing only the fresh
    // subset would misrepresent receiver quality and motion at this position.
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
  if (!eki::telemetry::locationTransitionIsPlausible(
    hasCapturedLocation,
    elapsed(lastCaptureAt),
    fix.lat,
    fix.lng,
    lastCapturedLat,
    lastCapturedLng,
    fix.speed,
    lastCapturedSpeed
  )) {
    Serial.printf(
      "[GNSS] Ignoring implausible position jump (%.2fm from last fix).\n",
      eki::telemetry::haversineMeters(
        lastCapturedLat,
        lastCapturedLng,
        fix.lat,
        fix.lng
      )
    );
    return false;
  }
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
  if (
    WiFi.status() == WL_CONNECTED &&
    (!gnssStatusKnown || fix.valid != lastGnssConnected)
  ) {
    gnssStatusKnown = true;
    lastGnssConnected = fix.valid;
    Serial.printf(
      "[GNSS] %s.\n",
      fix.valid ? "Connected" : "Not connected; waiting for valid fix"
    );
  }
  if (!fix.valid) {
    if (trustworthyGpsFixObserved && !gpsFixWasLost) {
      gpsFixWasLost = true;
      lossMessageQueued = false;
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
  }
  trustworthyGpsFixObserved = true;

  if (!clockIsSynchronized()) return;
  if (!shouldCapture(fix)) return;
  enqueueFix(fix);
  rememberCapturedFix(fix);
}

void publisherTask(void *) {
  const esp_err_t watchdogResult = esp_task_wdt_add(nullptr);
  if (watchdogResult != ESP_OK) {
    Serial.printf(
      "[Watchdog] Publisher subscription failed (%d).\n",
      watchdogResult
    );
  }

  for (;;) {
    esp_task_wdt_reset();
    serviceConnectivity();
    reportNtpCrossCheck();
#if EKI_FLEET_BUILD
    enforceOtaValidationDeadline();
#endif

    bool drainedSample = false;
    if (WiFi.status() == WL_CONNECTED) {
      synchronizeClock();
      if (clockIsSynchronized() && !httpsRetryIsPending()) {
        TelemetryFix fix{};
        size_t staleDrops = 0;
        const int64_t minimumTimestamp =
          epochMilliseconds() - eki::telemetry::TELEMETRY_FRESHNESS_MARGIN_MS;
        if (newestFreshFix(minimumTimestamp, fix, staleDrops)) {
          if (staleDrops > 0) {
            Serial.printf(
              "[Telemetry] Dropped %u stale queued sample(s) before publish.\n",
              static_cast<unsigned>(staleDrops)
            );
          }
          if (!credentialFaultActive) {
            const PublishResult result = publishFix(fix);
            if (result == PublishResult::Accepted) {
              acknowledgeQueuedFix(fix.sequence);
              recordPublishResult(true);
            } else if (result == PublishResult::Dropped) {
              removeQueuedFix(fix.sequence);
              recordPublishResult(false);
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
      if (!drainedSample) {
        publishRemoteDiagnostic();
#if EKI_FLEET_BUILD
        checkForSignedFirmware();
#endif
      }
    }

    esp_task_wdt_reset();
    ulTaskNotifyTake(
      pdTRUE,
      pdMS_TO_TICKS(drainedSample ? 1 : PUBLISHER_IDLE_MS)
    );
  }
}

} // namespace

void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);
  const eki::config::ValidationError configurationError = eki::config::validate(
    WIFI_SSID,
    std::strlen(WIFI_SSID),
    WIFI_PASS,
    std::strlen(WIFI_PASS),
    DEVICE_ID,
    std::strlen(DEVICE_ID),
    DEVICE_SECRET,
    std::strlen(DEVICE_SECRET),
    BACKEND_URL,
    std::strlen(BACKEND_URL),
    BACKEND_ROOT_CA,
    std::strlen(BACKEND_ROOT_CA)
  );
  if (configurationError != eki::config::ValidationError::None) {
    Serial.printf(
      "[Boot] Invalid compile-time configuration field %s; halted.\n",
      eki::config::validationErrorName(configurationError)
    );
    haltWithStatusLed(2);
  }
  if (EKI_FLEET_BUILD && !eki::config::backendUrlUsesHttps(BACKEND_URL)) {
    Serial.println("[Security] Fleet firmware requires an HTTPS backend; halted.");
    haltWithStatusLed(4);
  }
  flashEncryptionActive = esp_flash_encryption_enabled();
  secureBootActive = esp_secure_boot_enabled();
  if (EKI_FLEET_BUILD && (!flashEncryptionActive || !secureBootActive)) {
    Serial.println(
      "[Security] Fleet firmware refuses to run until Flash Encryption and Secure Boot V2 are both verified."
    );
    haltWithStatusLed(4);
  }
#if EKI_FLEET_BUILD
  initializeOtaRollbackState();
#endif
  const uint32_t configurationTag = telemetryConfigurationTag();
  const esp_reset_reason_t espBootReason = esp_reset_reason();
  const eki::reset::ResetReason bootReason = resetReasonFromEsp(espBootReason);
  resetStats.initializeOrRecover(configurationTag);
  resetStats.record(bootReason);
  const size_t gpsRxBuffer = gpsSerial.setRxBufferSize(GPS_RX_BUFFER_BYTES);
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
  gpsSerial.onReceiveError(onGpsSerialError);
  delay(500);

  if (
    bootReason == eki::reset::ResetReason::Brownout ||
    bootReason == eki::reset::ResetReason::Panic ||
    bootReason == eki::reset::ResetReason::TaskWatchdog ||
    bootReason == eki::reset::ResetReason::InterruptWatchdog ||
    bootReason == eki::reset::ResetReason::OtherWatchdog
  ) {
    Serial.printf(
      "[Boot] Recovered from %s reset (%d); reset total=%u.\n",
      eki::reset::resetReasonName(bootReason),
      static_cast<int>(espBootReason),
      static_cast<unsigned>(resetStats.total())
    );
  }

  portENTER_CRITICAL(&telemetryQueueMux);
  telemetryQueue.initializeOrRecover(configurationTag);
  portEXIT_CRITICAL(&telemetryQueueMux);
  if (gpsRxBuffer != GPS_RX_BUFFER_BYTES) {
    Serial.printf(
      "[GPS] RX buffer setup returned %u bytes; expected %u.\n",
      static_cast<unsigned>(gpsRxBuffer),
      static_cast<unsigned>(GPS_RX_BUFFER_BYTES)
    );
  }

  if (eki::config::backendUrlUsesHttps(BACKEND_URL)) {
    tlsClient.setCACert(BACKEND_ROOT_CA);
#if EKI_FLEET_BUILD
    firmwareTlsClient.setCACert(BACKEND_ROOT_CA);
#endif
  }
  if (!initializeRequestStrings()) {
    Serial.println("[Boot] Compile-time request configuration is too long; halted.");
    haltWithStatusLed(2);
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
    haltWithStatusLed(2, true);
  }
}

void loop() {
  esp_task_wdt_reset();
  while (gpsSerial.available() > 0) gps.encode(gpsSerial.read());
  disciplineClockFromGnss();

  if (elapsed(lastEvaluationAt) >= 1000) {
    lastEvaluationAt = millis();
    // Expire stale monotonic references while the 32-bit counter is still in
    // its current cycle, so rollover cannot make an old reference look fresh.
    expireGnssEpochReference(lastEvaluationAt);
    // TinyGPSPlus belongs exclusively to this loop task. Only the protected
    // scalar snapshot crosses to the publisher task for diagnostics.
    portENTER_CRITICAL(&healthMetricsMux);
    nmeaChecksumFailureCount = gps.failedChecksum();
    portEXIT_CRITICAL(&healthMetricsMux);
    evaluateTelemetry();
  }

  updateStatusLed();
  delay(5);
}
