#pragma once

#include <cstddef>
#include <cstdint>

namespace eki {
namespace http {

constexpr size_t TELEMETRY_RESPONSE_BODY_LIMIT = 1024;
constexpr uint32_t TELEMETRY_RESPONSE_DRAIN_TIMEOUT_MS = 1000;

inline bool acceptedResponseBodyLength(
  int status,
  const char *contentLength,
  const char *transferEncoding,
  int parsedLength,
  size_t &length
) {
  length = 0;
  if (
    (status != 200 && status != 202) ||
    contentLength == nullptr ||
    contentLength[0] == '\0' ||
    transferEncoding == nullptr ||
    transferEncoding[0] != '\0' ||
    parsedLength < 0
  ) {
    return false;
  }
  for (const char *cursor = contentLength; *cursor != '\0'; ++cursor) {
    if (*cursor < '0' || *cursor > '9') return false;
    const size_t digit = static_cast<size_t>(*cursor - '0');
    if (length > (TELEMETRY_RESPONSE_BODY_LIMIT - digit) / 10) return false;
    length = length * 10 + digit;
  }
  return static_cast<size_t>(parsedLength) == length;
}

/* consume one bounded body without extending the total deadline. */
template <typename Clock, typename Stream>
bool drainResponseBody(Stream &stream, size_t length) {
  uint8_t buffer[128];
  size_t consumed = 0;
  const uint32_t startedAt = Clock::now();
  while (consumed < length) {
    if (
      static_cast<uint32_t>(Clock::now() - startedAt) >=
      TELEMETRY_RESPONSE_DRAIN_TIMEOUT_MS
    ) {
      return false;
    }
    const int available = stream.available();
    if (available < 0 || (available == 0 && !stream.connected())) return false;
    if (available == 0) {
      Clock::idle();
      continue;
    }
    size_t count = length - consumed;
    if (count > sizeof(buffer)) count = sizeof(buffer);
    if (count > static_cast<size_t>(available)) {
      count = static_cast<size_t>(available);
    }
    const int received = stream.read(buffer, count);
    if (received <= 0 || static_cast<size_t>(received) > count) return false;
    consumed += static_cast<size_t>(received);
  }
  if (
    length > 0 &&
    static_cast<uint32_t>(Clock::now() - startedAt) >=
      TELEMETRY_RESPONSE_DRAIN_TIMEOUT_MS
  ) {
    return false;
  }
  return stream.available() == 0;
}

/* retain only a complete, length-delimited telemetry acknowledgement. */
template <typename Clock, typename HttpClient>
bool consumeAcceptedResponse(HttpClient &http, int status) {
  const auto contentLength = http.header("Content-Length");
  const auto transferEncoding = http.header("Transfer-Encoding");
  size_t length = 0;
  if (!acceptedResponseBodyLength(
        status,
        contentLength.c_str(),
        transferEncoding.c_str(),
        http.getSize(),
        length
      )) {
    return false;
  }
  auto *stream = http.getStreamPtr();
  if (length == 0) return stream == nullptr || stream->available() == 0;
  return stream != nullptr && drainResponseBody<Clock>(*stream, length);
}

} /* namespace http */
} /* namespace eki */
