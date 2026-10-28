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

// TinyGPS++ converts any checksummed DDMM digits without a range check. Keep
// the firmware sample inside the same envelope the telemetry API validates.
inline bool coordinatesAreValid(double lat, double lng) {
  return std::isfinite(lat) && std::isfinite(lng) &&
         lat >= -90.0 && lat <= 90.0 &&
         lng >= -180.0 && lng <= 180.0;
}

constexpr double DISTANCE_THRESHOLD_M = 5.0;
constexpr double HEADING_THRESHOLD_DEG = 15.0;
constexpr double SPEED_THRESHOLD_KMH = 5.0;
constexpr double MOVING_SPEED_KMH = 2.5;
constexpr double STOP_SPEED_KMH = 1.5;
constexpr uint32_t GNSS_FIX_MAX_AGE_MS = 5000;
// Keep receiver uncertainty separate from physical travel. The backend
// mirrors this 15..50 m envelope in telemetryMotion.ts.
constexpr double GNSS_ERROR_MIN_M = 15.0;
constexpr double GNSS_ERROR_MAX_M = 50.0;
constexpr double GNSS_STATIONARY_SPEED_KMH = 2.5;
constexpr double GNSS_HDOP_MAX = 4.0;

// TinyGPS++ parses HDOP as a signed decimal. A negative value is not receiver
// quality evidence and the telemetry API rejects it, so treat it as no fix.
inline bool gnssHdopIsAcceptable(double hdop) {
  return std::isfinite(hdop) && hdop >= 0.0 && hdop <= GNSS_HDOP_MAX;
}
// Mirrors TELEMETRY_MAX_TRANSITION_GAP_MS: beyond this gap the backend moves
// its anchor only after three coherent fixes, so the device must forward
// fixes that fit the full-gap travel envelope instead of discarding them.
constexpr uint32_t GNSS_MAX_TRANSITION_GAP_MS = 60UL * 1000;
constexpr uint32_t GNSS_REACQUIRE_AFTER_MS = 5UL * 60 * 1000;
// Telemetry is evaluated from the GNSS owner task at this cadence. Keep the
// motion confirmation count explicit so traces map to a real duration.
constexpr uint32_t TELEMETRY_EVALUATION_INTERVAL_MS = 1000;
constexpr uint32_t MIN_PUBLISH_INTERVAL_MS = 1000;
constexpr uint32_t MOVING_HEARTBEAT_MS = 1000;
// Endpoint arrival and automatic turnaround require fresh stopped telemetry.
// Keep this comfortably below the backend's 60-second freshness window so a
// stationary, connected bus cannot become stale at the exact moment its
// direction needs to change.
constexpr uint32_t STOPPED_HEARTBEAT_MS = 1000;
constexpr uint8_t MOTION_CONFIRMATION_READINGS = 3;
constexpr uint32_t HTTP_REQUEST_TIMEOUT_MS = 1500;
constexpr uint32_t HTTP_CONNECT_TIMEOUT_MS = 1000;
// Arduino's secure client takes seconds, independently of HTTPClient timeouts.
constexpr uint32_t TLS_HANDSHAKE_TIMEOUT_SECONDS = 10;
constexpr uint32_t MAINTENANCE_HTTP_TIMEOUT_MS = 1500;
constexpr uint32_t HTTPS_RETRY_BASE_MS = 1000;
constexpr uint32_t HTTPS_RETRY_MAX_MS = 30000;
constexpr uint32_t HTTPS_RATE_LIMIT_RETRY_MS = 60000;
constexpr uint32_t HTTPS_CONFIGURATION_RETRY_MS = 60000;
constexpr uint32_t HTTPS_REJECTED_SAMPLE_RETRY_MS = 30000;
constexpr uint32_t HTTPS_RETRY_AFTER_MAX_MS = 5 * 60 * 1000;
constexpr int64_t TELEMETRY_FRESHNESS_MARGIN_MS = 55000;
constexpr uint32_t DIAGNOSTIC_RETRY_BASE_MS = 5000;
constexpr uint32_t DIAGNOSTIC_RETRY_MAX_MS = 60UL * 1000;
class FirstDiagnosticDelay {
  uint32_t startedAt_;
  bool ready_ = false;
public:
  explicit FirstDiagnosticDelay(uint32_t startedAt = 0) : startedAt_(startedAt) {}
  bool due(uint32_t now, uint32_t delayMs) {
    if (static_cast<uint32_t>(now - startedAt_) >= delayMs) ready_ = true;
    return ready_;
  }
};

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
         // HDOP is useful quality metadata, but some otherwise valid
         // receivers omit it temporarily. Preserve the location as raw data
         // and let the adaptive policy use its conservative fallback.
         (!hdopValid || hdopAgeMs <= GNSS_FIX_MAX_AGE_MS) &&
         (!speedValid || speedAgeMs <= GNSS_FIX_MAX_AGE_MS) &&
         (!courseValid || courseAgeMs <= GNSS_FIX_MAX_AGE_MS);
}

// Evaluate at least once per window: once an observation ages out it stays
// invalid, so a 32-bit millis() rollover cannot make it look fresh again.
inline bool latchFreshness(
  bool &valid,
  uint32_t observedAtMs,
  uint32_t nowMs,
  uint32_t maximumAgeMs
) {
  if (valid && static_cast<uint32_t>(nowMs - observedAtMs) > maximumAgeMs) {
    valid = false;
  }
  return valid;
}

inline double adaptiveGnssErrorMeters(
  bool hdopValid,
  double hdop,
  double speedKmh,
  double previousSpeedKmh,
  uint32_t elapsedMs
) {
  const double hdopError = hdopValid && std::isfinite(hdop) && hdop >= 0.0
    ? GNSS_ERROR_MIN_M + hdop * 7.0
    : GNSS_ERROR_MAX_M;
  const double stationaryAllowance =
    std::max(speedKmh, previousSpeedKmh) <= GNSS_STATIONARY_SPEED_KMH
      ? 10.0
      : 0.0;
  const double gapAllowance = std::min(
    10.0,
    static_cast<double>(elapsedMs > 10000 ? elapsedMs - 10000 : 0) / 2000.0
  );
  return std::min(
    GNSS_ERROR_MAX_M,
    std::max(GNSS_ERROR_MIN_M, hdopError + stationaryAllowance + gapAllowance)
  );
}

struct MotionTracker {
  bool moving = false;
  uint8_t movingReadings = 0;
  uint8_t stoppedReadings = 0;

  const char *update(double speedKmh) {
    if (speedKmh >= MOVING_SPEED_KMH) {
      movingReadings = std::min<uint8_t>(
        movingReadings + 1,
        MOTION_CONFIRMATION_READINGS
      );
      stoppedReadings = 0;
      if (movingReadings >= MOTION_CONFIRMATION_READINGS) moving = true;
    } else if (speedKmh <= STOP_SPEED_KMH) {
      stoppedReadings = std::min<uint8_t>(
        stoppedReadings + 1,
        MOTION_CONFIRMATION_READINGS
      );
      movingReadings = 0;
      if (stoppedReadings >= MOTION_CONFIRMATION_READINGS) moving = false;
    } else {
      // Neutral-band samples preserve the confirmed state but break a pending
      // transition, so separated noisy readings cannot confirm a change.
      movingReadings = 0;
      stoppedReadings = 0;
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

// Bounded receiver error plus travel at the faster reported speed over
// elapsedMs. Mirrors withinTravelEnvelope() in backend telemetryMotion.ts.
inline bool withinTravelEnvelope(
  uint32_t elapsedMs,
  double lat,
  double lng,
  double previousLat,
  double previousLng,
  double speedKmh,
  double previousSpeedKmh,
  bool hdopValid,
  double hdop,
  bool previousHdopValid,
  double previousHdop
) {
  const double errorBudget = std::max(
    adaptiveGnssErrorMeters(
      previousHdopValid,
      previousHdop,
      previousSpeedKmh,
      speedKmh,
      elapsedMs
    ),
    adaptiveGnssErrorMeters(
      hdopValid,
      hdop,
      speedKmh,
      previousSpeedKmh,
      elapsedMs
    )
  );
  const double maximumSpeedKmh = std::min(
    200.0,
    std::max({speedKmh, previousSpeedKmh, 0.0})
  );
  const double reachableMeters =
    errorBudget +
    (maximumSpeedKmh / 3.6) * (static_cast<double>(elapsedMs) / 1000.0);
  return haversineMeters(previousLat, previousLng, lat, lng) <= reachableMeters;
}

inline bool locationTransitionIsPlausible(
  bool hasPrevious,
  uint32_t elapsedMs,
  double lat,
  double lng,
  double previousLat,
  double previousLng,
  double speedKmh,
  double previousSpeedKmh,
  bool hdopValid = false,
  double hdop = 99.0,
  bool previousHdopValid = false,
  double previousHdop = 99.0
) {
  if (!hasPrevious) return true;
  if (elapsedMs > GNSS_REACQUIRE_AFTER_MS) return true;
  // Travel is reachable for the whole gap, matching the backend's
  // outage-reacquisition envelope for gaps beyond GNSS_MAX_TRANSITION_GAP_MS.
  // Capping a 1..5 min gap at 60 s of travel discarded every valid fix from
  // a bus that kept moving until the 5 min reacquisition window expired.
  return withinTravelEnvelope(
    elapsedMs,
    lat,
    lng,
    previousLat,
    previousLng,
    speedKmh,
    previousSpeedKmh,
    hdopValid,
    hdop,
    previousHdopValid,
    previousHdop
  );
}

/**
 * Re-anchor the capture reference from corroborated evidence. A rejected but
 * otherwise valid fix may be correct while the reference is wrong (an outlier
 * accepted as the first fix after boot or a prolonged outage), or the bus may
 * have travelled faster during an outage than its reported speeds allow.
 * Mirroring the backend's outage-reacquisition rule, GNSS_REANCHOR_FIXES
 * consecutive rejected fixes with acceptable HDOP, each 0.5..5 s after the
 * previous one and plausible against it, are accepted as the new reference.
 * Each must also be reachable from the old reference at the 200 km/h cap over
 * the time since it, so a farther jump needs longer corroboration and a brief
 * multipath cluster cannot capture the reference. A single outlier, or one
 * receiver sentence evaluated twice, never re-anchors.
 */
constexpr uint8_t GNSS_REANCHOR_FIXES = 3;
constexpr uint32_t GNSS_REANCHOR_MIN_SPACING_MS = 500;
constexpr uint32_t GNSS_REANCHOR_MAX_SPACING_MS = 5000;

struct ReacquisitionCandidate {
  bool has = false;
  double lat = 0;
  double lng = 0;
  double speed = 0;
  double hdop = 99.0;
  uint32_t at = 0;
  uint8_t count = 0;

  void reset() {
    has = false;
    count = 0;
  }

  /**
   * Returns true when this rejected fix completes a coherent chain. nowMs is
   * when the receiver produced the fix; referenceElapsedMs is the time since
   * the current reference was captured.
   */
  bool observeRejected(
    uint32_t nowMs,
    double fixLat,
    double fixLng,
    double fixSpeedKmh,
    bool hdopValid,
    double fixHdop,
    bool hasReference = false,
    uint32_t referenceElapsedMs = 0,
    double referenceLat = 0,
    double referenceLng = 0
  ) {
    if (has && nowMs == at) return false;
    if (
      !hdopValid || !gnssHdopIsAcceptable(fixHdop) ||
      !coordinatesAreValid(fixLat, fixLng) || !speedIsPlausible(fixSpeedKmh) ||
      (hasReference && !withinTravelEnvelope(
        referenceElapsedMs, fixLat, fixLng, referenceLat, referenceLng,
        200.0, 200.0, true, fixHdop, false, 99.0
      ))
    ) {
      reset();
      return false;
    }
    const uint32_t spacingMs = nowMs - at;
    const bool coherent = has &&
      spacingMs >= GNSS_REANCHOR_MIN_SPACING_MS &&
      spacingMs <= GNSS_REANCHOR_MAX_SPACING_MS &&
      locationTransitionIsPlausible(
        true, spacingMs, fixLat, fixLng, lat, lng, fixSpeedKmh, speed,
        true, fixHdop, true, hdop
      );
    count = coherent ? static_cast<uint8_t>(count + 1) : 1;
    has = true;
    lat = fixLat;
    lng = fixLng;
    speed = fixSpeedKmh;
    hdop = fixHdop;
    at = nowMs;
    if (count < GNSS_REANCHOR_FIXES) return false;
    reset();
    return true;
  }
};

inline uint32_t retryDelayMs(uint8_t consecutiveFailures, uint32_t jitter) {
  const uint8_t exponent = std::min<uint8_t>(consecutiveFailures, 5);
  const uint32_t exponentialDelay = HTTPS_RETRY_BASE_MS << exponent;
  return std::min<uint32_t>(
    exponentialDelay + (jitter % HTTPS_RETRY_BASE_MS),
    HTTPS_RETRY_MAX_MS
  );
}

// A single read timeout already consumes up to 1.5s. Retry the retained latest
// fix quickly once so a transient socket expiry does not become a 4-5s RTDB
// gap. Repeated transport failures return to a 1-2s cadence to avoid a tight
// reconnect loop. Explicit server delays still take precedence.
inline uint32_t deliveryRetryDelayMs(uint8_t failures, uint32_t jitter, bool transportFailure) {
  if (!transportFailure) return retryDelayMs(failures, jitter);
  return failures == 0
    ? 250 + jitter % 500
    : 1000 + jitter % 1000;
}

/**
 * Translate the backend/transport result into delivery behavior. Only the two
 * statuses in the telemetry API contract acknowledge a fix. Network errors,
 * throttling, timeouts and server failures retain the latest sample; other
 * HTTP responses reject that sample so a permanent 4xx cannot be replayed.
 * Only invalid credentials latch. A valid device awaiting assignment keeps
 * its radio on and checks again after a bounded configuration delay.
 */
inline HttpResponseAction httpResponseAction(int responseCode) {
  if (responseCode == 200 || responseCode == 202) {
    return HttpResponseAction::Accept;
  }
  if (responseCode == 401) {
    return HttpResponseAction::HaltCredentials;
  }
  if (
    responseCode <= 0 ||
    responseCode == 403 ||
    responseCode == 408 ||
    responseCode == 425 ||
    responseCode == 429 ||
    (responseCode >= 500 && responseCode <= 599)
  ) {
    return HttpResponseAction::RetrySample;
  }
  return HttpResponseAction::DropSample;
}

inline int classifyIngressResponse(int responseCode, const char *ngrokError) {
  // An offline tunnel is a transient transport failure, not an Eki route 404.
  // Do not reinterpret credential errors or arbitrary gateway error codes.
  if (ngrokError == nullptr) return responseCode;
  const bool offlineTunnel = responseCode == 404 &&
    std::strcmp(ngrokError, "ERR_NGROK_3200") == 0;
  const bool unreachableUpstream = responseCode == 502 &&
    std::strcmp(ngrokError, "ERR_NGROK_8012") == 0;
  return offlineTunnel || unreachableUpstream ? 408 : responseCode;
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
    responseCode == 403 || responseCode == 404
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
