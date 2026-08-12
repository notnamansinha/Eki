#pragma once

#include "connectivity_policy.h"

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace eki {
namespace config {

constexpr size_t DEVICE_ID_MAX_LENGTH = 128;
constexpr size_t DEVICE_SECRET_MAX_LENGTH = 128;
constexpr size_t BACKEND_URL_MAX_LENGTH = 256;
constexpr size_t BACKEND_ROOT_CA_MAX_LENGTH = 3072;

enum class ValidationError : uint8_t {
  None,
  WifiSsid,
  WifiPassword,
  DeviceId,
  DeviceSecret,
  BackendUrl,
  BackendRootCa,
};

constexpr bool literalStartsWith(
  const char *value,
  size_t valueLength,
  const char *prefix,
  size_t prefixLength
) {
  return prefixLength == 0
    ? true
    : value == nullptr || prefix == nullptr || valueLength == 0
      ? false
      : value[0] == prefix[0] && literalStartsWith(
          value + 1,
          valueLength - 1,
          prefix + 1,
          prefixLength - 1
        );
}

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
  // The backend provisioner emits base64url. Keep the Authorization header
  // unambiguous even though the value is now supplied at compile time.
  return deviceIdIsValid(value, length);
}

inline bool backendUrlUsesHttps(const char *value) {
  constexpr char HTTPS_PREFIX[] = "https://";
  return value != nullptr && literalStartsWith(
    value,
    std::strlen(value),
    HTTPS_PREFIX,
    sizeof(HTTPS_PREFIX) - 1
  );
}

inline bool backendUrlIsValid(const char *value, size_t length) {
  constexpr char HTTPS_PREFIX[] = "https://";
  constexpr char HTTP_PREFIX[] = "http://";
  size_t prefixLength = 0;
  if (
    value != nullptr &&
    length > sizeof(HTTPS_PREFIX) - 1 &&
    literalStartsWith(
      value,
      length,
      HTTPS_PREFIX,
      sizeof(HTTPS_PREFIX) - 1
    )
  ) {
    prefixLength = sizeof(HTTPS_PREFIX) - 1;
  } else if (
    value != nullptr &&
    length > sizeof(HTTP_PREFIX) - 1 &&
    literalStartsWith(
      value,
      length,
      HTTP_PREFIX,
      sizeof(HTTP_PREFIX) - 1
    )
  ) {
    prefixLength = sizeof(HTTP_PREFIX) - 1;
  } else {
    return false;
  }
  if (length > BACKEND_URL_MAX_LENGTH) return false;

  bool hasAuthorityCharacter = false;
  bool pathStarted = false;
  for (size_t index = prefixLength; index < length; ++index) {
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

inline size_t boundedFind(
  const char *value,
  size_t length,
  const char *marker,
  size_t markerLength,
  size_t start
) {
  if (markerLength == 0 || start > length || markerLength > length - start) {
    return length;
  }
  for (size_t index = start; index <= length - markerLength; ++index) {
    if (std::memcmp(value + index, marker, markerLength) == 0) return index;
  }
  return length;
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
  if (value[length] != '\0') return false;

  const size_t begin = boundedFind(
    value,
    length,
    BEGIN_MARKER,
    sizeof(BEGIN_MARKER) - 1,
    0
  );
  if (begin == length) return false;
  return boundedFind(
    value,
    length,
    END_MARKER,
    sizeof(END_MARKER) - 1,
    begin + sizeof(BEGIN_MARKER) - 1
  ) != length;
}

inline ValidationError validate(
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
  if (!connectivity::wifiSsidIsValid(wifiSsid, wifiSsidLength)) {
    return ValidationError::WifiSsid;
  }
  if (!connectivity::wifiPasswordIsValid(wifiPassword, wifiPasswordLength)) {
    return ValidationError::WifiPassword;
  }
  if (!deviceIdIsValid(deviceId, deviceIdLength)) {
    return ValidationError::DeviceId;
  }
  if (!deviceSecretIsValid(deviceSecret, deviceSecretLength)) {
    return ValidationError::DeviceSecret;
  }
  if (!backendUrlIsValid(backendUrl, backendUrlLength)) {
    return ValidationError::BackendUrl;
  }
  if (
    backendUrlUsesHttps(backendUrl) &&
    !backendRootCaIsValid(backendRootCa, backendRootCaLength)
  ) {
    return ValidationError::BackendRootCa;
  }
  return ValidationError::None;
}

inline const char *validationErrorName(ValidationError error) {
  switch (error) {
    case ValidationError::WifiSsid:
      return "WIFI_SSID";
    case ValidationError::WifiPassword:
      return "WIFI_PASS";
    case ValidationError::DeviceId:
      return "DEVICE_ID";
    case ValidationError::DeviceSecret:
      return "DEVICE_SECRET";
    case ValidationError::BackendUrl:
      return "BACKEND_URL";
    case ValidationError::BackendRootCa:
      return "BACKEND_ROOT_CA";
    case ValidationError::None:
    default:
      return "none";
  }
}

} // namespace config
} // namespace eki
