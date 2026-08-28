#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace eki {
namespace telemetry {

inline bool speedIsPlausible(double speedKmh) {
  return std::isfinite(speedKmh) && speedKmh >= 0.0 && speedKmh <= 200.0;
}

constexpr double DISTANCE_THRESHOLD_M = 5.0;
constexpr double HEADING_THRESHOLD_DEG = 15.0;
constexpr double SPEED_THRESHOLD_KMH = 5.0;
constexpr double MOVING_SPEED_KMH = 2.5;
constexpr double STOP_SPEED_KMH = 1.5;
constexpr uint32_t GNSS_FIX_MAX_AGE_MS = 5000;
constexpr double GNSS_JUMP_MARGIN_M = 250.0;
constexpr uint32_t GNSS_MAX_TRANSITION_GAP_MS = 60UL * 1000;
constexpr uint32_t GNSS_REACQUIRE_AFTER_MS = 5UL * 60 * 1000;
constexpr uint32_t MIN_PUBLISH_INTERVAL_MS = 1000;
constexpr uint32_t MOVING_HEARTBEAT_MS = 1000;
// Endpoint arrival and automatic turnaround require fresh stopped telemetry.
// Keep this comfortably below the backend's 60-second freshness window so a
// stationary, connected bus cannot become stale at the exact moment its
// direction needs to change.
constexpr uint32_t STOPPED_HEARTBEAT_MS = 5000;
constexpr uint32_t HTTPS_RETRY_BASE_MS = 1000;
constexpr uint32_t HTTPS_RETRY_MAX_MS = 30000;
constexpr uint32_t HTTPS_RATE_LIMIT_RETRY_MS = 60000;
constexpr uint32_t HTTPS_CONFIGURATION_RETRY_MS = 60000;
constexpr uint32_t HTTPS_REJECTED_SAMPLE_RETRY_MS = 30000;
constexpr uint32_t HTTPS_RETRY_AFTER_MAX_MS = 5 * 60 * 1000;
constexpr int64_t TELEMETRY_FRESHNESS_MARGIN_MS = 55000;
constexpr uint32_t DIAGNOSTIC_RETRY_BASE_MS = 5000;
constexpr uint32_t DIAGNOSTIC_RETRY_MAX_MS = 60UL * 1000;

inline uint32_t diagnosticRetryDelayMs(
  uint8_t consecutiveFailures,
  uint32_t jitter = 0
) {
  if (consecutiveFailures == 0) return 0;
  const uint8_t exponent = std::min<uint8_t>(consecutiveFailures - 1, 4);
  return std::min<uint32_t>(
    (DIAGNOSTIC_RETRY_BASE_MS << exponent) +
      (jitter % DIAGNOSTIC_RETRY_BASE_MS),
    DIAGNOSTIC_RETRY_MAX_MS
  );
}

enum class HttpResponseAction : uint8_t {
  Accept,
  RetrySample,
  DropSample,
  HaltCredentials,
};

inline bool gnssFixFieldsAreFresh(
  bool locationValid,
  uint32_t locationAgeMs,
  bool hdopValid,
  uint32_t hdopAgeMs,
  bool speedValid,
  uint32_t speedAgeMs,
  bool courseValid,
  uint32_t courseAgeMs
) {
  return locationValid &&
         locationAgeMs <= GNSS_FIX_MAX_AGE_MS &&
         hdopValid &&
         hdopAgeMs <= GNSS_FIX_MAX_AGE_MS &&
         (!speedValid || speedAgeMs <= GNSS_FIX_MAX_AGE_MS) &&
         (!courseValid || courseAgeMs <= GNSS_FIX_MAX_AGE_MS);
}

struct MotionTracker {
  bool moving = false;
  uint8_t movingReadings = 0;
  uint8_t stoppedReadings = 0;

  const char *update(double speedKmh) {
    if (speedKmh >= MOVING_SPEED_KMH) {
      movingReadings = std::min<uint8_t>(movingReadings + 1, 3);
      stoppedReadings = 0;
      if (movingReadings >= 3) moving = true;
    } else if (speedKmh <= STOP_SPEED_KMH) {
      stoppedReadings = std::min<uint8_t>(stoppedReadings + 1, 3);
      movingReadings = 0;
      if (stoppedReadings >= 3) moving = false;
    }
    return moving ? "moving" : "stopped";
  }
};

inline double degreesToRadians(double degrees) {
  return degrees * 0.017453292519943295;
}

inline double haversineMeters(
  double lat1,
  double lng1,
  double lat2,
  double lng2
) {
  const double dLat = degreesToRadians(lat2 - lat1);
  const double dLng = degreesToRadians(lng2 - lng1);
  const double a = std::sin(dLat / 2) * std::sin(dLat / 2) +
                   std::cos(degreesToRadians(lat1)) *
                     std::cos(degreesToRadians(lat2)) *
                   std::sin(dLng / 2) * std::sin(dLng / 2);
  return 6371000.0 * 2 * std::atan2(std::sqrt(a), std::sqrt(1 - a));
}

inline double headingDelta(double current, double previous) {
  const double delta = std::fabs(current - previous);
  return delta > 180 ? 360 - delta : delta;
}

inline bool locationTransitionIsPlausible(
  bool hasPrevious,
  uint32_t elapsedMs,
  double lat,
  double lng,
  double previousLat,
  double previousLng,
  double speedKmh,
  double previousSpeedKmh
) {
  if (!hasPrevious) return true;
  if (elapsedMs > GNSS_REACQUIRE_AFTER_MS) return true;
  const uint32_t boundedElapsedMs = std::min(
    elapsedMs,
    GNSS_MAX_TRANSITION_GAP_MS
  );
  const double reachableMeters =
    GNSS_JUMP_MARGIN_M +
    (std::max(speedKmh, previousSpeedKmh) / 3.6) *
      (static_cast<double>(boundedElapsedMs) / 1000.0);
  return haversineMeters(previousLat, previousLng, lat, lng) <= reachableMeters;
}

inline uint32_t retryDelayMs(uint8_t consecutiveFailures, uint32_t jitter) {
  const uint8_t exponent = std::min<uint8_t>(consecutiveFailures, 5);
  const uint32_t exponentialDelay = HTTPS_RETRY_BASE_MS << exponent;
  return std::min<uint32_t>(
    exponentialDelay + (jitter % HTTPS_RETRY_BASE_MS),
    HTTPS_RETRY_MAX_MS
  );
}

/**
 * Translate the backend/transport result into delivery behavior. Only the two
 * statuses in the telemetry API contract acknowledge a fix. Network errors,
 * throttling, timeouts and server failures retain the latest sample; other
 * HTTP responses reject that sample so a permanent 4xx cannot be replayed.
 * Credential/assignment rejection is distinct so the runtime can latch a
 * technician-visible fault instead of trying a doomed secret forever.
 */
inline HttpResponseAction httpResponseAction(int responseCode) {
  if (responseCode == 200 || responseCode == 202) {
    return HttpResponseAction::Accept;
  }
  if (responseCode == 401 || responseCode == 403) {
    return HttpResponseAction::HaltCredentials;
  }
  if (
    responseCode <= 0 ||
    responseCode == 408 ||
    responseCode == 425 ||
    responseCode == 429 ||
    (responseCode >= 500 && responseCode <= 599)
  ) {
    return HttpResponseAction::RetrySample;
  }
  return HttpResponseAction::DropSample;
}

/** Parse the delta-seconds Retry-After form emitted by the Eki backend. */
inline uint32_t retryAfterDelayMs(const char *value) {
  if (value == nullptr) return 0;
  while (*value == ' ' || *value == '\t') ++value;

  uint32_t seconds = 0;
  bool hasDigit = false;
  constexpr uint32_t maximumSeconds = HTTPS_RETRY_AFTER_MAX_MS / 1000;
  while (*value >= '0' && *value <= '9') {
    hasDigit = true;
    const uint32_t digit = static_cast<uint32_t>(*value - '0');
    seconds = seconds > (maximumSeconds - digit) / 10
      ? maximumSeconds
      : seconds * 10 + digit;
    ++value;
  }
  while (*value == ' ' || *value == '\t') ++value;
  if (!hasDigit || *value != '\0') return 0;
  return std::min<uint32_t>(seconds * 1000, HTTPS_RETRY_AFTER_MAX_MS);
}

inline uint32_t minimumHttpRetryDelayMs(
  int responseCode,
  uint32_t retryAfterMs = 0
) {
  if (responseCode == 429) {
    return retryAfterMs > 0
      ? std::min<uint32_t>(retryAfterMs, HTTPS_RETRY_AFTER_MAX_MS)
      : HTTPS_RATE_LIMIT_RETRY_MS;
  }
  if (
    responseCode == 404
  ) {
    return HTTPS_CONFIGURATION_RETRY_MS;
  }
  return httpResponseAction(responseCode) == HttpResponseAction::DropSample
    ? HTTPS_REJECTED_SAMPLE_RETRY_MS
    : 0;
}

inline bool retryKeepsSampleFresh(
  int64_t sampleTimestampMs,
  int64_t nowMs,
  uint32_t retryDelayMs,
  int64_t freshnessMarginMs
) {
  const int64_t ageMs = nowMs - sampleTimestampMs;
  // Future timestamps are dropped even though the backend has a small clock
  // tolerance: retrying an ambiguously ordered sample is less safe than loss.
  if (ageMs < 0 || ageMs >= freshnessMarginMs) return false;
  return static_cast<int64_t>(retryDelayMs) < freshnessMarginMs - ageMs;
}

inline bool shouldPublishFix(
  bool valid,
  bool hasPublishedLocation,
  uint32_t elapsedSincePublish,
  bool moving,
  const char *motionState,
  const char *lastMotionState,
  double lat,
  double lng,
  double lastLat,
  double lastLng,
  double speed,
  double lastSpeed,
  double heading,
  double lastHeading
) {
  if (!valid) return false;
  if (!hasPublishedLocation) return true;
  if (elapsedSincePublish < MIN_PUBLISH_INTERVAL_MS) return false;

  const bool motionStateChanged =
    lastMotionState == nullptr ||
    std::strcmp(motionState, lastMotionState) != 0;
  const bool materiallyChanged =
    motionStateChanged ||
    haversineMeters(lastLat, lastLng, lat, lng) >= DISTANCE_THRESHOLD_M ||
    headingDelta(heading, lastHeading) >= HEADING_THRESHOLD_DEG ||
    std::fabs(speed - lastSpeed) >= SPEED_THRESHOLD_KMH;
  const uint32_t heartbeat = moving
    ? MOVING_HEARTBEAT_MS
    : STOPPED_HEARTBEAT_MS;
  return materiallyChanged || elapsedSincePublish >= heartbeat;
}

} // namespace telemetry
} // namespace eki
