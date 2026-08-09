#pragma once

#include <cstddef>
#include <cstdint>

namespace eki {
namespace reset {

/**
 * Reset-reason statistics for brownout/crash recovery visibility.
 *
 * The struct lives in RTC no-init memory (RTC_NOINIT_ATTR in main.cpp), so
 * counts survive brownout, panic, and watchdog resets: RTC slow memory sits
 * on the always-on RTC power domain and is not cleared by a chip reset, only
 * by a full power cut. A full power cut reads back as a fresh PowerOn
 * sequence, which is what a vehicle ignition cycle should look like.
 *
 * initializeOrRecover() mirrors TelemetryQueue: a firmware update with a
 * different configuration tag (device id + backend url) re-initializes the
 * counters instead of misreading a stale layout.
 */
enum class ResetReason : uint8_t {
  Unknown = 0,           // ESP_RST_UNKNOWN
  PowerOn,               // ESP_RST_POWERON
  External,              // ESP_RST_EXT
  Software,              // ESP_RST_SW
  Panic,                 // ESP_RST_PANIC (crash/abort)
  InterruptWatchdog,     // ESP_RST_INT_WDT
  TaskWatchdog,          // ESP_RST_TASK_WDT
  OtherWatchdog,         // ESP_RST_WDT
  DeepSleep,             // ESP_RST_DEEPSLEEP
  Brownout,              // ESP_RST_BROWNOUT
  Sdio,                  // ESP_RST_SDIO
};

constexpr size_t kResetReasonCount = 11;

inline const char *resetReasonName(ResetReason reason) {
  switch (reason) {
    case ResetReason::PowerOn:
      return "power-on";
    case ResetReason::External:
      return "external";
    case ResetReason::Software:
      return "software";
    case ResetReason::Panic:
      return "panic/crash";
    case ResetReason::InterruptWatchdog:
      return "interrupt-wdt";
    case ResetReason::TaskWatchdog:
      return "task-wdt";
    case ResetReason::OtherWatchdog:
      return "watchdog";
    case ResetReason::DeepSleep:
      return "deep-sleep";
    case ResetReason::Brownout:
      return "brownout";
    case ResetReason::Sdio:
      return "sdio";
    case ResetReason::Unknown:
    default:
      return "unknown";
  }
}

/** Persistent, bounded counters safe for RTC no-init storage. */
struct ResetStats {
  uint32_t magic;
  uint32_t configurationTag;
  uint16_t counts[kResetReasonCount];

  static constexpr uint32_t expectedMagic() {
    return 0x52455354u;  // "REST"
  }

  /**
   * Recover counters across resets; re-initialize when the firmware layout
   * changed (config tag) or the RTC contents were corrupted/power-cycled.
   */
  bool initializeOrRecover(uint32_t tag) {
    if (
      magic == expectedMagic() &&
      configurationTag == tag &&
      total() > 0
    ) {
      return true;
    }
    reset(tag);
    return false;
  }

  void reset(uint32_t tag) {
    magic = expectedMagic();
    configurationTag = tag;
    for (size_t i = 0; i < kResetReasonCount; ++i) {
      counts[i] = 0;
    }
  }

  /** Record one reset; saturates per reason and ignores unknown indices. */
  void record(ResetReason reason) {
    const size_t index = static_cast<size_t>(reason);
    if (index < kResetReasonCount && counts[index] < 0xFFFFu) {
      ++counts[index];
    }
  }

  uint16_t count(ResetReason reason) const {
    const size_t index = static_cast<size_t>(reason);
    return index < kResetReasonCount ? counts[index] : 0;
  }

  uint32_t total() const {
    uint32_t sum = 0;
    for (size_t i = 0; i < kResetReasonCount; ++i) {
      sum += counts[i];
    }
    return sum;
  }

  /** Counts outside the reasons surfaced in the [Health] report. */
  uint32_t otherCount() const {
    uint32_t tracked =
      count(ResetReason::PowerOn) + count(ResetReason::Brownout) +
      count(ResetReason::Panic) + count(ResetReason::TaskWatchdog) +
      count(ResetReason::InterruptWatchdog) + count(ResetReason::Software);
    return total() > tracked ? total() - tracked : 0;
  }
};

}  // namespace reset
}  // namespace eki
