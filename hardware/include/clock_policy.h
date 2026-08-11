#pragma once

#include <cstdint>

namespace eki {
namespace clock {

constexpr int UTC_YEAR_MIN = 2023;
constexpr int UTC_YEAR_MAX = 2099;
constexpr int64_t TRUSTED_EPOCH_MIN_MS = 1700000000000LL;
constexpr uint32_t GNSS_CLOCK_REFRESH_MS = 60000;
constexpr int64_t GNSS_CLOCK_CORRECTION_THRESHOLD_MS = 1500;

struct UtcDateTime {
  int year;
  int month;
  int day;
  int hour;
  int minute;
  int second;
  int centisecond;
};

inline bool isLeapYear(int year) {
  return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
}

inline int daysInMonth(int year, int month) {
  constexpr uint8_t days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (month < 1 || month > 12) return 0;
  return month == 2 && isLeapYear(year) ? 29 : days[month - 1];
}

inline bool isValidUtc(const UtcDateTime &utc) {
  return
    utc.year >= UTC_YEAR_MIN &&
    utc.year <= UTC_YEAR_MAX &&
    utc.month >= 1 &&
    utc.month <= 12 &&
    utc.day >= 1 &&
    utc.day <= daysInMonth(utc.year, utc.month) &&
    utc.hour >= 0 &&
    utc.hour <= 23 &&
    utc.minute >= 0 &&
    utc.minute <= 59 &&
    utc.second >= 0 &&
    utc.second <= 59 &&
    utc.centisecond >= 0 &&
    utc.centisecond <= 99;
}

// Howard Hinnant's civil-calendar conversion, expressed relative to the Unix
// epoch. It avoids timezone-sensitive mktime behavior on the device.
inline int64_t daysSinceUnixEpoch(int year, int month, int day) {
  year -= month <= 2;
  const int era = (year >= 0 ? year : year - 399) / 400;
  const unsigned yearOfEra = static_cast<unsigned>(year - era * 400);
  const unsigned shiftedMonth = static_cast<unsigned>(month + (month > 2 ? -3 : 9));
  const unsigned dayOfYear = (153 * shiftedMonth + 2) / 5 +
    static_cast<unsigned>(day - 1);
  const unsigned dayOfEra = yearOfEra * 365 + yearOfEra / 4 -
    yearOfEra / 100 + dayOfYear;
  return static_cast<int64_t>(era) * 146097 +
    static_cast<int64_t>(dayOfEra) - 719468;
}

inline bool utcToEpochMilliseconds(const UtcDateTime &utc, int64_t &epochMs) {
  if (!isValidUtc(utc)) return false;
  const int64_t seconds = daysSinceUnixEpoch(utc.year, utc.month, utc.day) * 86400 +
    utc.hour * 3600 + utc.minute * 60 + utc.second;
  epochMs = seconds * 1000 + utc.centisecond * 10;
  return epochMs >= TRUSTED_EPOCH_MIN_MS;
}

inline int64_t absoluteDifference(int64_t left, int64_t right) {
  return left >= right ? left - right : right - left;
}

inline int64_t projectEpochMilliseconds(
  int64_t referenceEpochMs,
  uint32_t referenceMonotonicMs,
  uint32_t nowMonotonicMs
) {
  return referenceEpochMs +
    static_cast<int64_t>(nowMonotonicMs - referenceMonotonicMs);
}

inline bool projectEpochMillisecondsIfFresh(
  int64_t referenceEpochMs,
  uint32_t referenceMonotonicMs,
  uint32_t nowMonotonicMs,
  uint32_t maximumAgeMs,
  int64_t &projectedEpochMs
) {
  const uint32_t ageMs = nowMonotonicMs - referenceMonotonicMs;
  if (ageMs > maximumAgeMs) return false;
  projectedEpochMs = referenceEpochMs + static_cast<int64_t>(ageMs);
  return true;
}

inline bool projectEpochMillisecondsFromReference(
  bool &referenceValid,
  int64_t referenceEpochMs,
  uint32_t referenceMonotonicMs,
  uint32_t nowMonotonicMs,
  uint32_t maximumAgeMs,
  int64_t &projectedEpochMs
) {
  if (!referenceValid) return false;
  if (!projectEpochMillisecondsIfFresh(
    referenceEpochMs,
    referenceMonotonicMs,
    nowMonotonicMs,
    maximumAgeMs,
    projectedEpochMs
  )) {
    referenceValid = false;
    return false;
  }
  return true;
}

inline bool shouldApplyGnssClock(
  bool gnssClockHasBeenApplied,
  uint32_t elapsedSinceLastApplication,
  int64_t systemEpochMs,
  int64_t gnssEpochMs
) {
  if (gnssEpochMs < TRUSTED_EPOCH_MIN_MS) return false;
  if (!gnssClockHasBeenApplied || systemEpochMs < TRUSTED_EPOCH_MIN_MS) return true;
  return
    elapsedSinceLastApplication >= GNSS_CLOCK_REFRESH_MS &&
    absoluteDifference(systemEpochMs, gnssEpochMs) >=
      GNSS_CLOCK_CORRECTION_THRESHOLD_MS;
}

} // namespace clock
} // namespace eki
