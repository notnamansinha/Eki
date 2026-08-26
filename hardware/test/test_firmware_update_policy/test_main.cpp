#include <unity.h>

#include "firmware_update_policy.h"

using namespace eki::update;

void setUp() {}
void tearDown() {}

void test_manifest_requires_newer_bounded_https_release() {
  constexpr char DIGEST[] =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  TEST_ASSERT_TRUE(manifestIsValid(
    "s2-gnss-v2.0.0", 2, "https://releases.example.edu/firmware.bin",
    DIGEST, 1500000, 1
  ));
  TEST_ASSERT_FALSE(manifestIsValid(
    "s1-gnss-v1.0.0", 1, "https://releases.example.edu/firmware.bin",
    DIGEST, 1500000, 1
  ));
  TEST_ASSERT_FALSE(manifestIsValid(
    "s2-gnss-v2.0.0", 2, "http://releases.example.edu/firmware.bin",
    DIGEST, 1500000, 1
  ));
  TEST_ASSERT_FALSE(manifestIsValid(
    "s2-gnss-v2.0.0", 2, "https://user:pass@releases.example.edu/firmware.bin",
    DIGEST, 1500000, 1
  ));
  TEST_ASSERT_FALSE(manifestIsValid(
    "s2-gnss-v2.0.0", 2, "https://releases.example.edu/firmware.bin",
    "short", 1500000, 1
  ));
  TEST_ASSERT_FALSE(manifestIsValid(
    "s2-gnss-v2.0.0", 2, "https://releases.example.edu/firmware.bin",
    DIGEST, MAX_SIGNED_IMAGE_BYTES + 1, 1
  ));
  TEST_ASSERT_FALSE(httpsUrlIsValid("https://releases.example.edu/image.bin#fragment"));
}

void test_signed_version_binds_the_release_sequence() {
  uint32_t sequence = 0;
  TEST_ASSERT_TRUE(signedVersionSequence("s12-gnss-v2.1.0", sequence));
  TEST_ASSERT_EQUAL_UINT32(12, sequence);
  TEST_ASSERT_FALSE(signedVersionSequence("gnss-v2.1.0", sequence));
  TEST_ASSERT_FALSE(signedVersionSequence("s02-gnss-v2.1.0", sequence));
  TEST_ASSERT_FALSE(signedVersionSequence("s0-gnss-v2.1.0", sequence));
}

void test_update_requires_idle_stopped_healthy_device() {
  TEST_ASSERT_TRUE(locallySafeToUpdate(false, true, 0, true, true, false));
  TEST_ASSERT_TRUE(locallySafeToUpdate(false, true, 0, false, false, false));
  TEST_ASSERT_FALSE(locallySafeToUpdate(true, true, 0, true, true, false));
  TEST_ASSERT_FALSE(locallySafeToUpdate(false, false, 0, true, true, false));
  TEST_ASSERT_FALSE(locallySafeToUpdate(false, true, 1, true, true, false));
  TEST_ASSERT_FALSE(locallySafeToUpdate(false, true, 0, true, false, false));
  TEST_ASSERT_FALSE(locallySafeToUpdate(false, true, 0, true, true, true));
}

void test_update_schedule_uses_long_success_and_short_failure_intervals() {
  TEST_ASSERT_FALSE(checkIsDue(FIRST_CHECK_DELAY_MS - 1, false, 0, false));
  TEST_ASSERT_TRUE(checkIsDue(FIRST_CHECK_DELAY_MS, false, 0, false));
  TEST_ASSERT_FALSE(checkIsDue(CHECK_INTERVAL_MS - 1, true, 0, false));
  TEST_ASSERT_TRUE(checkIsDue(CHECK_INTERVAL_MS, true, 0, false));
  TEST_ASSERT_FALSE(checkIsDue(FAILED_CHECK_RETRY_MS - 1, true, 0, true));
  TEST_ASSERT_TRUE(checkIsDue(FAILED_CHECK_RETRY_MS, true, 0, true));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_manifest_requires_newer_bounded_https_release);
  RUN_TEST(test_signed_version_binds_the_release_sequence);
  RUN_TEST(test_update_requires_idle_stopped_healthy_device);
  RUN_TEST(test_update_schedule_uses_long_success_and_short_failure_intervals);
  return UNITY_END();
}
