#include <unity.h>

#include <cstring>

#include "reset_stats.h"

using namespace eki::reset;

void setUp() {}
void tearDown() {}

// RTC no-init memory reads back zeroed after a full power cut; mirror that.
static ResetStats powerCycled() {
  ResetStats stats;
  std::memset(&stats, 0, sizeof(stats));
  return stats;
}

void test_fresh_boot_records_and_recovers() {
  ResetStats stats = powerCycled();
  TEST_ASSERT_FALSE(stats.initializeOrRecover(42));
  stats.record(ResetReason::PowerOn);
  TEST_ASSERT_EQUAL_UINT16(1, stats.count(ResetReason::PowerOn));
  TEST_ASSERT_EQUAL_UINT32(1, stats.total());
  // A brownout reset must retain the counters, not start from zero.
  TEST_ASSERT_TRUE(stats.initializeOrRecover(42));
  stats.record(ResetReason::Brownout);
  TEST_ASSERT_EQUAL_UINT16(1, stats.count(ResetReason::Brownout));
  TEST_ASSERT_EQUAL_UINT32(2, stats.total());
}

void test_configuration_change_reinitializes_counters() {
  ResetStats stats = powerCycled();
  stats.initializeOrRecover(42);
  stats.record(ResetReason::Panic);
  TEST_ASSERT_TRUE(stats.initializeOrRecover(42));
  // A firmware update with a different device/backend tag must not misread
  // the old layout.
  TEST_ASSERT_FALSE(stats.initializeOrRecover(99));
  TEST_ASSERT_EQUAL_UINT32(0, stats.total());
}

void test_corrupted_magic_reinitializes_counters() {
  ResetStats stats = powerCycled();
  stats.initializeOrRecover(1);
  stats.record(ResetReason::Brownout);
  stats.magic = 0xDEADBEEFu;
  TEST_ASSERT_FALSE(stats.initializeOrRecover(1));
  TEST_ASSERT_EQUAL_UINT32(0, stats.total());
}

void test_record_ignores_out_of_range_reasons() {
  ResetStats stats = powerCycled();
  stats.initializeOrRecover(0);
  stats.record(static_cast<ResetReason>(99));
  stats.record(
    static_cast<ResetReason>(static_cast<int>(ResetReason::Sdio) + 1)
  );
  TEST_ASSERT_EQUAL_UINT32(0, stats.total());
}

void test_reason_names_are_readable() {
  TEST_ASSERT_EQUAL_STRING("power-on", resetReasonName(ResetReason::PowerOn));
  TEST_ASSERT_EQUAL_STRING("brownout", resetReasonName(ResetReason::Brownout));
  TEST_ASSERT_EQUAL_STRING("panic/crash", resetReasonName(ResetReason::Panic));
  TEST_ASSERT_EQUAL_STRING("task-wdt", resetReasonName(ResetReason::TaskWatchdog));
  TEST_ASSERT_EQUAL_STRING("unknown", resetReasonName(ResetReason::Unknown));
  TEST_ASSERT_EQUAL_STRING(
    "unknown",
    resetReasonName(static_cast<ResetReason>(99))
  );
}

void test_other_count_excludes_tracked_reasons() {
  ResetStats stats = powerCycled();
  stats.initializeOrRecover(0);
  stats.record(ResetReason::PowerOn);
  stats.record(ResetReason::Brownout);
  stats.record(ResetReason::DeepSleep);  // not one of the tracked six
  TEST_ASSERT_EQUAL_UINT32(1, stats.otherCount());
  TEST_ASSERT_EQUAL_UINT32(3, stats.total());
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_fresh_boot_records_and_recovers);
  RUN_TEST(test_configuration_change_reinitializes_counters);
  RUN_TEST(test_corrupted_magic_reinitializes_counters);
  RUN_TEST(test_record_ignores_out_of_range_reasons);
  RUN_TEST(test_reason_names_are_readable);
  RUN_TEST(test_other_count_excludes_tracked_reasons);
  return UNITY_END();
}
