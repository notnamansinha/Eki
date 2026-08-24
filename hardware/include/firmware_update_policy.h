#pragma once

#include <cstddef>
#include <cstdint>

namespace eki {
namespace update {

constexpr size_t VERSION_MAX_LENGTH = 31;
constexpr size_t URL_MAX_LENGTH = 512;
constexpr size_t SHA256_HEX_LENGTH = 64;
constexpr size_t MAX_SIGNED_IMAGE_BYTES = 0x1E0000;
constexpr uint32_t FIRST_CHECK_DELAY_MS = 2UL * 60 * 1000;
constexpr uint32_t CHECK_INTERVAL_MS = 6UL * 60 * 60 * 1000;
constexpr uint32_t FAILED_CHECK_RETRY_MS = 15UL * 60 * 1000;
constexpr uint32_t ROLLBACK_VALIDATION_TIMEOUT_MS = 5UL * 60 * 1000;

inline bool sha256IsValid(const char *value) {
  if (value == nullptr) return false;
  for (size_t index = 0; index < SHA256_HEX_LENGTH; ++index) {
    const char character = value[index];
    if (!(
      (character >= '0' && character <= '9') ||
      (character >= 'a' && character <= 'f') ||
      (character >= 'A' && character <= 'F')
    )) return false;
  }
  return value[SHA256_HEX_LENGTH] == '\0';
}

inline bool versionIsValid(const char *value) {
  if (value == nullptr || value[0] == '\0') return false;
  size_t length = 0;
  for (; value[length] != '\0'; ++length) {
    if (length >= VERSION_MAX_LENGTH) return false;
    const char character = value[length];
    if (!(
      (character >= 'a' && character <= 'z') ||
      (character >= 'A' && character <= 'Z') ||
      (character >= '0' && character <= '9') ||
      character == '.' || character == '_' || character == '-'
    )) return false;
  }
  return length > 0;
}

inline bool signedVersionSequence(const char *value, uint32_t &sequence) {
  if (!versionIsValid(value) || value[0] != 's') return false;
  uint64_t parsed = 0;
  size_t index = 1;
  const size_t firstDigit = index;
  while (value[index] >= '0' && value[index] <= '9') {
    parsed = parsed * 10 + static_cast<uint8_t>(value[index] - '0');
    if (parsed > UINT32_MAX) return false;
    ++index;
  }
  if (
    index == firstDigit ||
    value[index] != '-' ||
    value[index + 1] == '\0' ||
    (value[firstDigit] == '0' && index - firstDigit > 1)
  ) return false;
  sequence = static_cast<uint32_t>(parsed);
  return sequence > 0;
}

inline bool httpsUrlIsValid(const char *value) {
  constexpr char PREFIX[] = "https://";
  if (value == nullptr) return false;
  size_t index = 0;
  for (; index < sizeof(PREFIX) - 1; ++index) {
    if (value[index] != PREFIX[index]) return false;
  }
  bool authorityCharacter = false;
  bool inAuthority = true;
  for (; value[index] != '\0'; ++index) {
    if (index >= URL_MAX_LENGTH) return false;
    const uint8_t character = static_cast<uint8_t>(value[index]);
    if (
      character <= 0x20 ||
      character > 0x7E ||
      character == '#' ||
      (inAuthority && character == '@')
    ) {
      return false;
    }
    if (inAuthority && (character == '/' || character == '?')) {
      inAuthority = false;
    } else if (inAuthority) {
      authorityCharacter = true;
    }
  }
  return authorityCharacter;
}

inline bool manifestIsValid(
  const char *version,
  uint32_t sequence,
  const char *url,
  const char *sha256,
  size_t size,
  uint32_t currentSequence
) {
  uint32_t signedSequence = 0;
  return signedVersionSequence(version, signedSequence) &&
         signedSequence == sequence &&
         sequence > currentSequence &&
         httpsUrlIsValid(url) &&
         sha256IsValid(sha256) &&
         size > 0 &&
         size <= MAX_SIGNED_IMAGE_BYTES;
}

inline bool locallySafeToUpdate(
  bool credentialFault,
  bool clockSynchronized,
  size_t queueDepth,
  bool hasLocation,
  bool stopped,
  bool rollbackValidationPending
) {
  return !credentialFault &&
         clockSynchronized &&
         queueDepth == 0 &&
         (!hasLocation || stopped) &&
         !rollbackValidationPending;
}

inline bool checkIsDue(
  uint32_t now,
  bool checkedBefore,
  uint32_t lastCheckAt,
  bool previousCheckFailed
) {
  if (!checkedBefore) return now >= FIRST_CHECK_DELAY_MS;
  const uint32_t interval = previousCheckFailed
    ? FAILED_CHECK_RETRY_MS
    : CHECK_INTERVAL_MS;
  return now - lastCheckAt >= interval;
}

} // namespace update
} // namespace eki
