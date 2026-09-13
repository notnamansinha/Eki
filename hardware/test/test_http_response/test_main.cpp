#include "http_response.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#ifndef EKI_STANDALONE_TEST
#include <unity.h>
#endif

namespace {

#ifdef EKI_STANDALONE_TEST
void check(bool condition, const char *expression, int line) {
  if (!condition) {
    std::fprintf(stderr, "line %d: %s\n", line, expression);
    std::exit(EXIT_FAILURE);
  }
}
#define CHECK(expression) check((expression), #expression, __LINE__)
#else
#define CHECK(expression) TEST_ASSERT_TRUE(expression)
#endif

struct Clock {
  static uint32_t tick;
  static uint32_t now() { return tick; }
  static void idle() { ++tick; }
};
uint32_t Clock::tick = 0;

struct Stream {
  bool open = true;
  bool readFails = false;
  bool availableFails = false;
  bool closeAfterBody = false;
  uint32_t byteDelay = 0;
  uint32_t readCost = 0;
  uint32_t lastRead = 0;
  size_t readLimit = 128;
  size_t offset = 0;
  std::string bytes;

  int available() {
    if (availableFails) return -1;
    if (!open || static_cast<uint32_t>(Clock::now() - lastRead) < byteDelay) {
      return 0;
    }
    return static_cast<int>(bytes.size() - offset);
  }

  bool connected() const { return open; }

  int read(uint8_t *target, size_t count) {
    if (readFails) return -1;
    const size_t size = std::min(
      count,
      std::min(readLimit, bytes.size() - offset)
    );
    std::memcpy(target, bytes.data() + offset, size);
    offset += size;
    Clock::tick += readCost;
    lastRead = Clock::now();
    if (closeAfterBody && offset == bytes.size()) open = false;
    return static_cast<int>(size);
  }
};

struct Http {
  Stream stream;
  bool missingStream = false;
  int contentLength = 2;
  std::string rawContentLength = "2";
  std::string transferEncoding;

  int getSize() const { return contentLength; }
  std::string header(const char *name) const {
    return std::strcmp(name, "Content-Length") == 0
      ? rawContentLength
      : transferEncoding;
  }
  Stream *getStreamPtr() { return missingStream ? nullptr : &stream; }
};

void lengthsAreStrictAndBounded() {
  size_t length = 0;
  for (
    int value = 0;
    value <= static_cast<int>(eki::http::TELEMETRY_RESPONSE_BODY_LIMIT);
    ++value
  ) {
    const std::string text = std::to_string(value);
    CHECK(eki::http::acceptedResponseBodyLength(
      200, text.c_str(), "", value, length
    ));
    CHECK(length == static_cast<size_t>(value));
    CHECK(eki::http::acceptedResponseBodyLength(
      202, text.c_str(), "", value, length
    ));
  }
  const char *invalid[] = {
    "", "-1", "+2", "2x", "2,2", " 2", "2 ", "1025",
    "9999999999999999999999999",
  };
  for (const char *text : invalid) {
    CHECK(!eki::http::acceptedResponseBodyLength(202, text, "", 2, length));
  }
  CHECK(!eki::http::acceptedResponseBodyLength(204, "0", "", 0, length));
  CHECK(!eki::http::acceptedResponseBodyLength(500, "0", "", 0, length));
  CHECK(!eki::http::acceptedResponseBodyLength(202, nullptr, "", 2, length));
  CHECK(!eki::http::acceptedResponseBodyLength(202, "2", nullptr, 2, length));
  CHECK(!eki::http::acceptedResponseBodyLength(202, "2", "chunked", 2, length));
  CHECK(!eki::http::acceptedResponseBodyLength(202, "2", "identity", 2, length));
  CHECK(!eki::http::acceptedResponseBodyLength(202, "2", "", -1, length));
  CHECK(!eki::http::acceptedResponseBodyLength(202, "2", "", 3, length));
}

void completeBodiesDrainAcrossFragments() {
  Http http;
  http.contentLength = 17;
  http.rawContentLength = "17";
  http.stream.bytes = "{\"accepted\":true}";
  http.stream.readLimit = 1;
  http.stream.byteDelay = 3;
  CHECK((eki::http::consumeAcceptedResponse<Clock>(http, 202)));
  CHECK(http.stream.offset == http.stream.bytes.size());
}

void zeroLengthDoesNotRequireAnOpenStream() {
  Http http;
  http.contentLength = 0;
  http.rawContentLength = "0";
  http.missingStream = true;
  CHECK((eki::http::consumeAcceptedResponse<Clock>(http, 200)));
}

void peerCloseAfterCompleteBodyIsAccepted() {
  Http http;
  http.stream.bytes = "{}";
  http.stream.closeAfterBody = true;
  CHECK((eki::http::consumeAcceptedResponse<Clock>(http, 202)));
}

void zeroLengthRejectsBufferedBytes() {
  Http http;
  http.contentLength = 0;
  http.rawContentLength = "0";
  http.stream.bytes = "unexpected";
  CHECK((!eki::http::consumeAcceptedResponse<Clock>(http, 202)));
}

void unsupportedFramingPreventsReuse() {
  Http http;
  http.stream.bytes = "{}";
  http.transferEncoding = "chunked";
  CHECK((!eki::http::consumeAcceptedResponse<Clock>(http, 202)));
  http.transferEncoding.clear();
  http.rawContentLength = "2x";
  CHECK((!eki::http::consumeAcceptedResponse<Clock>(http, 202)));
}

void trailingBytesPreventReuse() {
  Http http;
  http.stream.bytes = "{}late";
  CHECK((!eki::http::consumeAcceptedResponse<Clock>(http, 202)));
}

void truncationUsesOneTotalDeadline() {
  Http http;
  http.contentLength = 3;
  http.rawContentLength = "3";
  http.stream.bytes = "{}";
  const uint32_t startedAt = Clock::now();
  CHECK((!eki::http::consumeAcceptedResponse<Clock>(http, 202)));
  CHECK(
    Clock::now() - startedAt ==
    eki::http::TELEMETRY_RESPONSE_DRAIN_TIMEOUT_MS
  );
}

void slowDripDoesNotRestartTheDeadline() {
  Http http;
  http.stream.bytes = "{}";
  http.stream.readLimit = 1;
  http.stream.byteDelay = 600;
  const uint32_t startedAt = Clock::now();
  CHECK((!eki::http::consumeAcceptedResponse<Clock>(http, 202)));
  CHECK(http.stream.offset == 1);
  CHECK(
    Clock::now() - startedAt ==
    eki::http::TELEMETRY_RESPONSE_DRAIN_TIMEOUT_MS
  );
}

void finalReadMustFinishInsideTheDeadline() {
  for (uint32_t cost : {999U, 1000U, 1001U}) {
    Http http;
    http.stream.bytes = "{}";
    http.stream.readCost = cost;
    CHECK((
      eki::http::consumeAcceptedResponse<Clock>(http, 202) ==
      (cost < eki::http::TELEMETRY_RESPONSE_DRAIN_TIMEOUT_MS)
    ));
    Clock::tick = 0;
  }
}

void rolloverKeepsTheDeadlineBounded() {
  Http http;
  http.contentLength = 3;
  http.rawContentLength = "3";
  http.stream.bytes = "{}";
  Clock::tick = UINT32_MAX - 100;
  CHECK((!eki::http::consumeAcceptedResponse<Clock>(http, 202)));
  CHECK(
    Clock::tick == eki::http::TELEMETRY_RESPONSE_DRAIN_TIMEOUT_MS - 101
  );
}

void streamFailuresCloseReuseEligibility() {
  for (unsigned failure = 0; failure < 4; ++failure) {
    Http http;
    http.stream.bytes = "{}";
    if (failure == 0) http.stream.readFails = true;
    if (failure == 1) http.stream.availableFails = true;
    if (failure == 2) http.stream.open = false;
    if (failure == 3) http.missingStream = true;
    CHECK((!eki::http::consumeAcceptedResponse<Clock>(http, 202)));
    Clock::tick = 0;
  }
}

} /* namespace */

#ifndef EKI_STANDALONE_TEST
void setUp() { Clock::tick = 0; }
void tearDown() {}
#endif

int main() {
#ifdef EKI_STANDALONE_TEST
  const struct { const char *name; void (*run)(); } tests[] = {
    {"strict framing", lengthsAreStrictAndBounded},
    {"fragmented body", completeBodiesDrainAcrossFragments},
    {"zero length", zeroLengthDoesNotRequireAnOpenStream},
    {"peer close", peerCloseAfterCompleteBodyIsAccepted},
    {"zero-length trailing bytes", zeroLengthRejectsBufferedBytes},
    {"unsupported framing", unsupportedFramingPreventsReuse},
    {"trailing bytes", trailingBytesPreventReuse},
    {"truncated body", truncationUsesOneTotalDeadline},
    {"slow drip", slowDripDoesNotRestartTheDeadline},
    {"final read", finalReadMustFinishInsideTheDeadline},
    {"clock rollover", rolloverKeepsTheDeadlineBounded},
    {"stream failures", streamFailuresCloseReuseEligibility},
  };
  for (const auto &test : tests) {
    Clock::tick = 0;
    test.run();
    std::printf("PASS %s\n", test.name);
  }
  std::printf(
    "%zu host response tests passed\n",
    sizeof(tests) / sizeof(tests[0])
  );
#else
  UNITY_BEGIN();
  RUN_TEST(lengthsAreStrictAndBounded);
  RUN_TEST(completeBodiesDrainAcrossFragments);
  RUN_TEST(zeroLengthDoesNotRequireAnOpenStream);
  RUN_TEST(peerCloseAfterCompleteBodyIsAccepted);
  RUN_TEST(zeroLengthRejectsBufferedBytes);
  RUN_TEST(unsupportedFramingPreventsReuse);
  RUN_TEST(trailingBytesPreventReuse);
  RUN_TEST(truncationUsesOneTotalDeadline);
  RUN_TEST(slowDripDoesNotRestartTheDeadline);
  RUN_TEST(finalReadMustFinishInsideTheDeadline);
  RUN_TEST(rolloverKeepsTheDeadlineBounded);
  RUN_TEST(streamFailuresCloseReuseEligibility);
  return UNITY_END();
#endif
}
