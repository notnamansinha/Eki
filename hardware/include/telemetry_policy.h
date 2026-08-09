#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace eki {
namespace telemetry {

constexpr double DISTANCE_THRESHOLD_M = 5.0;
constexpr double HEADING_THRESHOLD_DEG = 15.0;
constexpr double SPEED_THRESHOLD_KMH = 5.0;
constexpr double MOVING_SPEED_KMH = 2.5;
constexpr double STOP_SPEED_KMH = 1.5;
constexpr uint32_t MIN_PUBLISH_INTERVAL_MS = 3000;
constexpr uint32_t MOVING_HEARTBEAT_MS = 30000;
constexpr uint32_t STOPPED_HEARTBEAT_MS = 60000;
constexpr uint32_t HTTPS_RETRY_BASE_MS = 1000;
constexpr uint32_t HTTPS_RETRY_MAX_MS = 30000;

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

inline uint32_t retryDelayMs(uint8_t consecutiveFailures, uint32_t jitter) {
  const uint8_t exponent = std::min<uint8_t>(consecutiveFailures, 5);
  const uint32_t exponentialDelay = HTTPS_RETRY_BASE_MS << exponent;
  return std::min<uint32_t>(
    exponentialDelay + (jitter % HTTPS_RETRY_BASE_MS),
    HTTPS_RETRY_MAX_MS
  );
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
