#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace eki {
namespace connectivity {

constexpr uint32_t WIFI_RETRY_BASE_MS = 5000;
constexpr uint32_t WIFI_RETRY_MAX_MS = 60000;
enum class FaultCode : uint8_t {
  None,
  CredentialRejected,
};

inline uint32_t wifiRetryDelayMs(uint8_t completedAttempts) {
  if (completedAttempts == 0) return 0;
  const uint8_t exponent = std::min<uint8_t>(completedAttempts - 1, 4);
  return std::min<uint32_t>(WIFI_RETRY_BASE_MS << exponent, WIFI_RETRY_MAX_MS);
}

class WifiRetrySupervisor {
public:
  void observe(bool connected, uint32_t nowMs) {
    if (connected) {
      reset();
      return;
    }
    if (!outageActive_) {
      outageActive_ = true;
      outageStartedAt_ = nowMs;
    }
  }

  bool attemptDue(uint32_t nowMs) const {
    if (!outageActive_) return false;
    if (completedAttempts_ == 0) return true;
    return nowMs - lastAttemptAt_ >= wifiRetryDelayMs(completedAttempts_);
  }

  void recordAttempt(uint32_t nowMs) {
    lastAttemptAt_ = nowMs;
    completedAttempts_ = std::min<uint8_t>(completedAttempts_ + 1, 31);
  }

  uint8_t completedAttempts() const { return completedAttempts_; }

private:
  void reset() {
    outageActive_ = false;
    outageStartedAt_ = 0;
    lastAttemptAt_ = 0;
    completedAttempts_ = 0;
  }

  bool outageActive_ = false;
  uint32_t outageStartedAt_ = 0;
  uint32_t lastAttemptAt_ = 0;
  uint8_t completedAttempts_ = 0;
};

inline bool wifiSsidIsValid(const char *ssid, size_t ssidLength) {
  if (ssid == nullptr || ssidLength < 1 || ssidLength > 32) return false;
  for (size_t index = 0; index < ssidLength; ++index) {
    if (ssid[index] == '\0') return false;
  }
  return true;
}

inline bool wifiPasswordIsValid(const char *password, size_t passwordLength) {
  if (password == nullptr || passwordLength < 8 || passwordLength > 63) {
    return false;
  }
  for (size_t index = 0; index < passwordLength; ++index) {
    const uint8_t character = static_cast<uint8_t>(password[index]);
    if (character < 0x20 || character > 0x7E) return false;
  }
  return true;
}

inline bool wifiCredentialsAreValid(
  const char *ssid,
  size_t ssidLength,
  const char *password,
  size_t passwordLength
) {
  return wifiSsidIsValid(ssid, ssidLength) &&
    wifiPasswordIsValid(password, passwordLength);
}

inline bool statusLedOn(FaultCode fault, uint32_t nowMs) {
  if (fault == FaultCode::None) return false;
  const uint32_t phase = nowMs % 2000;
  return phase < 900 && phase % 300 < 150;
}

} // namespace connectivity
} // namespace eki
