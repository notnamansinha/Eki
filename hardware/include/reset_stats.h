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
  Usb,                   // ESP_RST_USB (ESP-IDF >= 5.1)
  Jtag,                  // ESP_RST_JTAG (ESP-IDF >= 5.1)
  Efuse,                 // ESP_RST_EFUSE (ESP-IDF >= 5.1)
  PowerGlitch,           // ESP_RST_PWR_GLITCH (ESP-IDF >= 5.1)
  CpuLockup,             // ESP_RST_CPU_LOCKUP (ESP-IDF >= 5.1)
  Count,
};

constexpr size_t kResetReasonCount = static_cast<size_t>(ResetReason::Count);

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
    case ResetReason::Usb:
      return "usb";
    case ResetReason::Jtag:
      return "jtag";
    case ResetReason::Efuse:
      return "efuse-error";
    case ResetReason::PowerGlitch:
      return "power-glitch";
    case ResetReason::CpuLockup:
      return "cpu-lockup";
    case ResetReason::Unknown:
    default:
      return "unknown";
  }
}

/** Persistent, bounded counters safe for RTC no-init storage. */
struct ResetStats {
  uint32_t magic;
  uint32_t configurationTag;
  uint32_t checksum;
  uint16_t counts[kResetReasonCount];

  static constexpr uint32_t expectedMagic() {
    return 0x52535432u;  // "RST2": checksum-protected layout version 2.
  }

  /**
   * Recover counters across resets; re-initialize when the firmware layout
   * changed (config tag) or the RTC contents were corrupted/power-cycled.
   */
  bool initializeOrRecover(uint32_t tag) {
    if (
      magic == expectedMagic() &&
      configurationTag == tag &&
      checksum == calculatedChecksum() &&
      total() > 0
    ) {
      return true;
    }
    reset(tag);
    return false;
  }

  void reset(uint32_t tag) {
    // Invalidate the payload until every field and its checksum are coherent.
    magic = 0;
    configurationTag = tag;
    for (size_t i = 0; i < kResetReasonCount; ++i) {
      counts[i] = 0;
    }
    checksum = calculatedChecksum();
    magic = expectedMagic();
  }

  /** Record one reset; saturates per reason and ignores unknown indices. */
  void record(ResetReason reason) {
    const size_t index = static_cast<size_t>(reason);
    if (index >= kResetReasonCount || counts[index] == 0xFFFFu) return;
    ++counts[index];
    checksum = calculatedChecksum();
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

 private:
  static uint32_t mixChecksum(uint32_t hash, uint32_t value) {
    for (uint8_t shift = 0; shift < 32; shift += 8) {
      hash ^= (value >> shift) & 0xFFu;
      hash *= 16777619u;
    }
    return hash;
  }

  uint32_t calculatedChecksum() const {
    uint32_t hash = mixChecksum(2166136261u, expectedMagic());
    hash = mixChecksum(hash, configurationTag);
    hash = mixChecksum(hash, static_cast<uint32_t>(kResetReasonCount));
    for (size_t i = 0; i < kResetReasonCount; ++i) {
      hash = mixChecksum(hash, counts[i]);
    }
    return hash;
  }
};

}  // namespace reset
}  // namespace eki
