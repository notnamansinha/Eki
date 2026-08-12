#pragma once

#include "connectivity_policy.h"
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace eki {
namespace connectivity {

constexpr uint32_t DEVICE_CONFIG_MAGIC = 0x454B4943UL;
constexpr uint16_t DEVICE_CONFIG_VERSION = 1;
constexpr size_t DEVICE_ID_MAX_LENGTH = 128;
constexpr size_t DEVICE_SECRET_MAX_LENGTH = 128;
constexpr size_t BACKEND_URL_MAX_LENGTH = 256;
constexpr size_t BACKEND_ROOT_CA_MAX_LENGTH = 3072;

struct DeviceConfigurationRecord {
  uint32_t magic;
  uint16_t version;
  uint16_t reserved;
  char wifiSsid[33];
  char wifiPassword[64];
  char deviceId[DEVICE_ID_MAX_LENGTH + 1];
  char deviceSecret[DEVICE_SECRET_MAX_LENGTH + 1];
  char backendUrl[BACKEND_URL_MAX_LENGTH + 1];
  char backendRootCa[BACKEND_ROOT_CA_MAX_LENGTH + 1];
  uint32_t checksum;
};

enum class DeviceConfigurationValidationError : uint8_t {
  None,
  WifiSsid,
  WifiPassword,
  DeviceId,
  DeviceSecret,
  BackendUrl,
  BackendRootCa,
};

inline bool deviceIdIsValid(const char *value, size_t length) {
  if (value == nullptr || length == 0 || length > DEVICE_ID_MAX_LENGTH) {
    return false;
  }
  for (size_t index = 0; index < length; ++index) {
    const char character = value[index];
    const bool valid =
      (character >= 'a' && character <= 'z') ||
      (character >= 'A' && character <= 'Z') ||
      (character >= '0' && character <= '9') ||
      character == '_' ||
      character == '-';
    if (!valid) return false;
  }
  return true;
}

inline bool deviceSecretIsValid(const char *value, size_t length) {
  if (value == nullptr || length < 20 || length > DEVICE_SECRET_MAX_LENGTH) {
    return false;
  }
  // The backend provisioner emits base64url. Restricting the local form to
  // that alphabet keeps the Authorization header unambiguous.
  return deviceIdIsValid(value, length);
}

inline bool backendUrlIsValid(const char *value, size_t length) {
  constexpr char HTTPS_PREFIX[] = "https://";
  constexpr size_t PREFIX_LENGTH = sizeof(HTTPS_PREFIX) - 1;
  if (
    value == nullptr ||
    length <= PREFIX_LENGTH ||
    length > BACKEND_URL_MAX_LENGTH ||
    std::memcmp(value, HTTPS_PREFIX, PREFIX_LENGTH) != 0
  ) return false;

  bool hasAuthorityCharacter = false;
  bool pathStarted = false;
  for (size_t index = PREFIX_LENGTH; index < length; ++index) {
    const uint8_t character = static_cast<uint8_t>(value[index]);
    if (character <= 0x20 || character > 0x7E) return false;
    if (character == '@' || character == '?' || character == '#') return false;
    if (character == '/') {
      pathStarted = true;
      continue;
    }
    if (pathStarted) return false;
    hasAuthorityCharacter = true;
  }
  return hasAuthorityCharacter;
}

inline bool backendRootCaIsValid(const char *value, size_t length) {
  constexpr char BEGIN_MARKER[] = "-----BEGIN CERTIFICATE-----";
  constexpr char END_MARKER[] = "-----END CERTIFICATE-----";
  if (
    value == nullptr ||
    length < sizeof(BEGIN_MARKER) + sizeof(END_MARKER) - 2 ||
    length > BACKEND_ROOT_CA_MAX_LENGTH
  ) return false;
  for (size_t index = 0; index < length; ++index) {
    if (value[index] == '\0') return false;
  }
  return std::strstr(value, BEGIN_MARKER) != nullptr &&
         std::strstr(value, END_MARKER) != nullptr;
}

inline DeviceConfigurationValidationError validateDeviceConfiguration(
  const char *wifiSsid,
  size_t wifiSsidLength,
  const char *wifiPassword,
  size_t wifiPasswordLength,
  const char *deviceId,
  size_t deviceIdLength,
  const char *deviceSecret,
  size_t deviceSecretLength,
  const char *backendUrl,
  size_t backendUrlLength,
  const char *backendRootCa,
  size_t backendRootCaLength
) {
  if (!wifiSsidIsValid(wifiSsid, wifiSsidLength)) {
    return DeviceConfigurationValidationError::WifiSsid;
  }
  if (!wifiPasswordIsValid(wifiPassword, wifiPasswordLength)) {
    return DeviceConfigurationValidationError::WifiPassword;
  }
  if (!deviceIdIsValid(deviceId, deviceIdLength)) {
    return DeviceConfigurationValidationError::DeviceId;
  }
  if (!deviceSecretIsValid(deviceSecret, deviceSecretLength)) {
    return DeviceConfigurationValidationError::DeviceSecret;
  }
  if (!backendUrlIsValid(backendUrl, backendUrlLength)) {
    return DeviceConfigurationValidationError::BackendUrl;
  }
  if (!backendRootCaIsValid(backendRootCa, backendRootCaLength)) {
    return DeviceConfigurationValidationError::BackendRootCa;
  }
  return DeviceConfigurationValidationError::None;
}

inline uint32_t deviceConfigurationChecksum(
  const DeviceConfigurationRecord &record
) {
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&record);
  uint32_t hash = 2166136261UL;
  for (
    size_t index = 0;
    index < offsetof(DeviceConfigurationRecord, checksum);
    ++index
  ) {
    hash ^= bytes[index];
    hash *= 16777619UL;
  }
  return hash;
}

inline bool makeDeviceConfigurationRecord(
  const char *wifiSsid,
  size_t wifiSsidLength,
  const char *wifiPassword,
  size_t wifiPasswordLength,
  const char *deviceId,
  size_t deviceIdLength,
  const char *deviceSecret,
  size_t deviceSecretLength,
  const char *backendUrl,
  size_t backendUrlLength,
  const char *backendRootCa,
  size_t backendRootCaLength,
  DeviceConfigurationRecord &record
) {
  if (validateDeviceConfiguration(
    wifiSsid,
    wifiSsidLength,
    wifiPassword,
    wifiPasswordLength,
    deviceId,
    deviceIdLength,
    deviceSecret,
    deviceSecretLength,
    backendUrl,
    backendUrlLength,
    backendRootCa,
    backendRootCaLength
  ) != DeviceConfigurationValidationError::None) return false;

  std::memset(&record, 0, sizeof(record));
  record.magic = DEVICE_CONFIG_MAGIC;
  record.version = DEVICE_CONFIG_VERSION;
  std::memcpy(record.wifiSsid, wifiSsid, wifiSsidLength);
  std::memcpy(record.wifiPassword, wifiPassword, wifiPasswordLength);
  std::memcpy(record.deviceId, deviceId, deviceIdLength);
  std::memcpy(record.deviceSecret, deviceSecret, deviceSecretLength);
  std::memcpy(record.backendUrl, backendUrl, backendUrlLength);
  std::memcpy(record.backendRootCa, backendRootCa, backendRootCaLength);
  record.checksum = deviceConfigurationChecksum(record);
  return true;
}

inline bool deviceConfigurationRecordIsValid(
  const DeviceConfigurationRecord &record
) {
  const size_t ssidLength = boundedCStringLength(
    record.wifiSsid,
    sizeof(record.wifiSsid)
  );
  const size_t wifiPasswordLength = boundedCStringLength(
    record.wifiPassword,
    sizeof(record.wifiPassword)
  );
  const size_t deviceIdLength = boundedCStringLength(
    record.deviceId,
    sizeof(record.deviceId)
  );
  const size_t deviceSecretLength = boundedCStringLength(
    record.deviceSecret,
    sizeof(record.deviceSecret)
  );
  const size_t backendUrlLength = boundedCStringLength(
    record.backendUrl,
    sizeof(record.backendUrl)
  );
  const size_t backendRootCaLength = boundedCStringLength(
    record.backendRootCa,
    sizeof(record.backendRootCa)
  );
  return
    record.magic == DEVICE_CONFIG_MAGIC &&
    record.version == DEVICE_CONFIG_VERSION &&
    ssidLength < sizeof(record.wifiSsid) &&
    wifiPasswordLength < sizeof(record.wifiPassword) &&
    deviceIdLength < sizeof(record.deviceId) &&
    deviceSecretLength < sizeof(record.deviceSecret) &&
    backendUrlLength < sizeof(record.backendUrl) &&
    backendRootCaLength < sizeof(record.backendRootCa) &&
    wifiCredentialsAreValid(
      record.wifiSsid,
      ssidLength,
      record.wifiPassword,
      wifiPasswordLength
    ) &&
    deviceIdIsValid(record.deviceId, deviceIdLength) &&
    deviceSecretIsValid(record.deviceSecret, deviceSecretLength) &&
    backendUrlIsValid(record.backendUrl, backendUrlLength) &&
    backendRootCaIsValid(record.backendRootCa, backendRootCaLength) &&
    record.checksum == deviceConfigurationChecksum(record);
}

inline bool makeWifiUpdatedDeviceConfigurationRecord(
  const DeviceConfigurationRecord &existing,
  const char *wifiSsid,
  size_t wifiSsidLength,
  const char *wifiPassword,
  size_t wifiPasswordLength,
  DeviceConfigurationRecord &updated
) {
  if (
    !deviceConfigurationRecordIsValid(existing) ||
    !wifiCredentialsAreValid(
      wifiSsid,
      wifiSsidLength,
      wifiPassword,
      wifiPasswordLength
    )
  ) return false;

  updated = existing;
  std::memset(updated.wifiSsid, 0, sizeof(updated.wifiSsid));
  std::memset(updated.wifiPassword, 0, sizeof(updated.wifiPassword));
  std::memcpy(updated.wifiSsid, wifiSsid, wifiSsidLength);
  std::memcpy(updated.wifiPassword, wifiPassword, wifiPasswordLength);
  updated.checksum = deviceConfigurationChecksum(updated);
  return true;
}

} // namespace connectivity
} // namespace eki
