#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

namespace eki {
namespace telemetry {

/**
 * Fixed-capacity ring used by the firmware's capture and publisher tasks.
 *
 * Samples remain ordered by capture time, but delivery peeks at the newest
 * sample first so live state recovers before the backend freshness window
 * closes. A failed delivery stays queued. Acknowledgement can remove a sample
 * that stopped being newest while the network request was in flight.
 *
 * The type deliberately has trivial construction so an instance can live in
 * ESP32 RTC no-init memory and be validated explicitly during setup().
 */
template <typename Sample, size_t Capacity>
class NewestFirstTelemetryQueue {
  static_assert(Capacity > 0, "Telemetry queue capacity must be positive.");
  static_assert(Capacity <= UINT16_MAX, "Telemetry queue capacity is too large.");
  static_assert(
    std::is_trivial<Sample>::value && std::is_trivially_copyable<Sample>::value,
    "RTC telemetry samples must be trivial values without startup constructors."
  );

 public:
  struct Stats {
    uint16_t depth;
    uint16_t highWaterMark;
    uint32_t overflowDrops;
    uint32_t staleDrops;
  };

  /** Return true when a structurally valid queue was recovered. */
  bool initializeOrRecover(uint32_t configurationTag = 0) {
    if (
      magic_ == expectedMagic() &&
      configurationTag_ == configurationTag &&
      head_ < Capacity &&
      count_ <= Capacity &&
      highWaterMark_ <= Capacity &&
      nextSequence_ != 0 &&
      integrityIsValid()
    ) {
      return true;
    }
    reset(configurationTag);
    return false;
  }

  void reset(uint32_t configurationTag = 0) {
    std::memset(this, 0, sizeof(*this));
    configurationTag_ = configurationTag;
    nextSequence_ = 1;
    finishMutation();
  }

  /**
   * Add a sample and assign its monotonic queue sequence. When full, discard
   * the oldest sample so the most useful live state is always retained.
   */
  uint32_t push(Sample sample) {
    beginMutation();
    sample.sequence = nextSequence_++;
    if (nextSequence_ == 0) nextSequence_ = 1;

    size_t writeIndex;
    if (count_ == Capacity) {
      writeIndex = head_;
      head_ = increment(head_);
      ++overflowDrops_;
    } else {
      writeIndex = physicalIndex(count_);
      ++count_;
      if (count_ > highWaterMark_) highWaterMark_ = count_;
    }
    samples_[writeIndex] = sample;
    finishMutation();
    return sample.sequence;
  }

  bool newest(Sample &sample) const {
    if (count_ == 0) return false;
    sample = samples_[physicalIndex(count_ - 1)];
    return true;
  }

  /** Remove an acknowledged or permanently rejected in-flight sample. */
  bool remove(uint32_t sequence) {
    for (uint16_t logicalIndex = 0; logicalIndex < count_; ++logicalIndex) {
      if (samples_[physicalIndex(logicalIndex)].sequence != sequence) continue;
      beginMutation();
      eraseAt(logicalIndex);
      finishMutation();
      return true;
    }
    return false;
  }

  /** Remove every sample outside the backend's safe freshness horizon. */
  size_t dropOlderThan(int64_t minimumTimestamp) {
    beginMutation();
    const uint16_t originalCount = count_;
    uint16_t retained = 0;
    for (uint16_t index = 0; index < originalCount; ++index) {
      const Sample sample = samples_[physicalIndex(index)];
      if (sample.timestamp >= minimumTimestamp) {
        if (retained != index) samples_[physicalIndex(retained)] = sample;
        ++retained;
      }
    }
    count_ = retained;
    if (count_ == 0) head_ = 0;
    const size_t dropped = originalCount - retained;
    staleDrops_ += static_cast<uint32_t>(dropped);
    finishMutation();
    return dropped;
  }

  Stats stats() const {
    return {
      count_,
      highWaterMark_,
      overflowDrops_,
      staleDrops_,
    };
  }

  size_t size() const {
    return count_;
  }

  static constexpr size_t capacity() {
    return Capacity;
  }

  bool integrityIsValid() const {
    return magic_ == expectedMagic() && checksum_ == calculatedChecksum();
  }

 private:
  static constexpr uint32_t expectedMagic() {
    return 0x454B4903UL ^
           static_cast<uint32_t>(sizeof(Sample) << 8) ^
           static_cast<uint32_t>(Capacity);
  }

  uint16_t increment(uint16_t index) const {
    return static_cast<uint16_t>((index + 1) % Capacity);
  }

  size_t physicalIndex(uint16_t logicalIndex) const {
    return (static_cast<size_t>(head_) + logicalIndex) % Capacity;
  }

  void eraseAt(uint16_t logicalIndex) {
    if (logicalIndex == 0) {
      head_ = increment(head_);
      --count_;
      if (count_ == 0) head_ = 0;
      return;
    }
    for (uint16_t index = logicalIndex; index + 1 < count_; ++index) {
      samples_[physicalIndex(index)] = samples_[physicalIndex(index + 1)];
    }
    --count_;
    if (count_ == 0) head_ = 0;
  }

  void beginMutation() {
    magic_ = 0;
  }

  void finishMutation() {
    checksum_ = calculatedChecksum();
    magic_ = expectedMagic();
  }

  uint32_t calculatedChecksum() const {
    uint32_t hash = 2166136261UL;
    const auto hashBytes = [&hash](const void *value, size_t length) {
      const uint8_t *bytes = static_cast<const uint8_t *>(value);
      for (size_t index = 0; index < length; ++index) {
        hash ^= bytes[index];
        hash *= 16777619UL;
      }
    };
    hashBytes(&configurationTag_, sizeof(configurationTag_));
    hashBytes(&nextSequence_, sizeof(nextSequence_));
    hashBytes(&overflowDrops_, sizeof(overflowDrops_));
    hashBytes(&staleDrops_, sizeof(staleDrops_));
    hashBytes(&head_, sizeof(head_));
    hashBytes(&count_, sizeof(count_));
    hashBytes(&highWaterMark_, sizeof(highWaterMark_));
    hashBytes(samples_, sizeof(samples_));
    return hash;
  }

  uint32_t magic_;
  uint32_t configurationTag_;
  uint32_t nextSequence_;
  uint32_t overflowDrops_;
  uint32_t staleDrops_;
  uint16_t head_;
  uint16_t count_;
  uint16_t highWaterMark_;
  Sample samples_[Capacity];
  uint32_t checksum_;
};

} // namespace telemetry
} // namespace eki
