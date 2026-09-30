#include "http_response.h"

#include <cstdio>
#include <cstdlib>

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

struct FakeClient {
  int pending = 0;
  int stops = 0;
  int writes = 0;
  bool open = true;

  virtual ~FakeClient() = default;
  virtual int available() { return pending; }
  virtual void stop() {
    pending = 0;
    open = false;
    ++stops;
  }
  virtual size_t write(uint8_t data) { return write(&data, 1); }
  virtual size_t write(const uint8_t *, size_t size) {
    if (!open) return 0;
    ++writes;
    return size;
  }
};

using GuardedClient = eki::http::ReuseGuardedClient<FakeClient>;

void bufferedDataAtAvailabilityCheckClosesTransport() {
  GuardedClient client;
  client.pending = 3;
  client.guardNextRequest();

  CHECK(client.available() == 0);
  CHECK(client.stops == 1);
  CHECK(client.writes == 0);
}

void bufferedDataBeforeFirstWriteClosesTransport() {
  GuardedClient client;
  client.guardNextRequest();
  CHECK(client.available() == 0);

  client.pending = 1;
  const uint8_t request[] = {'P', 'O', 'S', 'T'};
  CHECK(client.write(request, sizeof(request)) == 0);
  CHECK(client.stops == 1);
  CHECK(client.writes == 0);
}

void availabilityFailureBeforeFirstWriteClosesTransport() {
  GuardedClient client;
  client.guardNextRequest();
  client.pending = -1;

  CHECK(client.available() == 0);
  CHECK(client.stops == 1);
}

void cleanFirstWriteReleasesTheGuard() {
  GuardedClient client;
  client.guardNextRequest();
  CHECK(client.available() == 0);

  const uint8_t request[] = {'P', 'O', 'S', 'T'};
  CHECK(client.write(request, sizeof(request)) == sizeof(request));
  CHECK(client.stops == 0);
  CHECK(client.writes == 1);

  client.pending = 2;
  CHECK(client.available() == 2);
  CHECK(client.stops == 0);
}

void unarmedClientDoesNotHideResponseBytes() {
  GuardedClient client;
  client.pending = 4;

  CHECK(client.available() == 4);
  CHECK(client.stops == 0);
}

} /* namespace */

#ifndef EKI_STANDALONE_TEST
void setUp() {}
void tearDown() {}
#endif

int main() {
#ifdef EKI_STANDALONE_TEST
  const struct { const char *name; void (*run)(); } tests[] = {
    {"availability check", bufferedDataAtAvailabilityCheckClosesTransport},
    {"first write", bufferedDataBeforeFirstWriteClosesTransport},
    {"availability failure", availabilityFailureBeforeFirstWriteClosesTransport},
    {"clean write", cleanFirstWriteReleasesTheGuard},
    {"unarmed response", unarmedClientDoesNotHideResponseBytes},
  };
  for (const auto &test : tests) {
    test.run();
    std::printf("PASS %s\n", test.name);
  }
  std::printf(
    "%zu host reuse-guard tests passed\n",
    sizeof(tests) / sizeof(tests[0])
  );
#else
  UNITY_BEGIN();
  RUN_TEST(bufferedDataAtAvailabilityCheckClosesTransport);
  RUN_TEST(bufferedDataBeforeFirstWriteClosesTransport);
  RUN_TEST(availabilityFailureBeforeFirstWriteClosesTransport);
  RUN_TEST(cleanFirstWriteReleasesTheGuard);
  RUN_TEST(unarmedClientDoesNotHideResponseBytes);
  return UNITY_END();
#endif
}
