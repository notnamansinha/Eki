#include <unity.h>

#include "telemetry_policy.h"

using namespace eki::telemetry;

void setUp() {}
void tearDown() {}

void test_haversine_and_heading_wrap() {
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, static_cast<float>(haversineMeters(23.0, 72.0, 23.0, 72.0)));
  TEST_ASSERT_FLOAT_WITHIN(1.0f, 111.2f, static_cast<float>(haversineMeters(0.0, 0.0, 0.001, 0.0)));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 2.0f, static_cast<float>(headingDelta(1.0, 359.0)));
}

void test_motion_hysteresis_filters_single_noisy_readings() {
  MotionTracker tracker;
  TEST_ASSERT_EQUAL_STRING("stopped", tracker.update(3.0));
  TEST_ASSERT_EQUAL_STRING("stopped", tracker.update(3.0));
  TEST_ASSERT_EQUAL_STRING("moving", tracker.update(3.0));
  TEST_ASSERT_EQUAL_STRING("moving", tracker.update(2.0));
  TEST_ASSERT_EQUAL_STRING("moving", tracker.update(1.0));
  TEST_ASSERT_EQUAL_STRING("moving", tracker.update(1.0));
  TEST_ASSERT_EQUAL_STRING("stopped", tracker.update(1.0));
}

void test_retry_backoff_is_jittered_and_bounded() {
  TEST_ASSERT_EQUAL_UINT32(1000, retryDelayMs(0, 0));
  TEST_ASSERT_EQUAL_UINT32(1999, retryDelayMs(0, 999));
  TEST_ASSERT_EQUAL_UINT32(16042, retryDelayMs(4, 42));
  TEST_ASSERT_EQUAL_UINT32(30000, retryDelayMs(5, 999));
  TEST_ASSERT_EQUAL_UINT32(30000, retryDelayMs(99, 999));
}

void test_publish_policy_handles_floor_changes_and_heartbeats() {
  const auto decide = [](
    bool valid,
    bool hasPrevious,
    uint32_t age,
    bool moving,
    const char *state,
    const char *previousState,
    double lat,
    double speed,
    double heading
  ) {
    return shouldPublishFix(
      valid,
      hasPrevious,
      age,
      moving,
      state,
      previousState,
      lat,
      72.0,
      23.0,
      72.0,
      speed,
      10.0,
      heading,
      100.0
    );
  };

  TEST_ASSERT_FALSE(decide(false, false, 0, false, "stopped", nullptr, 23.0, 0, 0));
  TEST_ASSERT_TRUE(decide(true, false, 0, false, "stopped", nullptr, 23.0, 0, 0));
  TEST_ASSERT_FALSE(decide(true, true, 2999, true, "moving", "stopped", 23.1, 50, 200));
  TEST_ASSERT_TRUE(decide(true, true, 3000, true, "moving", "stopped", 23.0, 10, 100));
  TEST_ASSERT_TRUE(decide(true, true, 3000, true, "moving", "moving", 23.0001, 10, 100));
  TEST_ASSERT_TRUE(decide(true, true, 3000, true, "moving", "moving", 23.0, 15, 100));
  TEST_ASSERT_TRUE(decide(true, true, 3000, true, "moving", "moving", 23.0, 10, 115));
  TEST_ASSERT_FALSE(decide(true, true, 29999, true, "moving", "moving", 23.0, 10, 100));
  TEST_ASSERT_TRUE(decide(true, true, 30000, true, "moving", "moving", 23.0, 10, 100));
  TEST_ASSERT_FALSE(decide(true, true, 59999, false, "stopped", "stopped", 23.0, 10, 100));
  TEST_ASSERT_TRUE(decide(true, true, 60000, false, "stopped", "stopped", 23.0, 10, 100));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_haversine_and_heading_wrap);
  RUN_TEST(test_motion_hysteresis_filters_single_noisy_readings);
  RUN_TEST(test_retry_backoff_is_jittered_and_bounded);
  RUN_TEST(test_publish_policy_handles_floor_changes_and_heartbeats);
  return UNITY_END();
}
