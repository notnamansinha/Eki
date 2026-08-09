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

void test_http_response_actions_cover_transport_and_status_families() {
  TEST_ASSERT_EQUAL_INT(
    static_cast<int>(HttpResponseAction::Accept),
    static_cast<int>(httpResponseAction(200))
  );
  TEST_ASSERT_EQUAL_INT(
    static_cast<int>(HttpResponseAction::Accept),
    static_cast<int>(httpResponseAction(202))
  );
  for (const int code : {-11, 408, 425, 429, 500, 503, 599}) {
    TEST_ASSERT_EQUAL_INT(
      static_cast<int>(HttpResponseAction::RetrySample),
      static_cast<int>(httpResponseAction(code))
    );
  }
  for (const int code : {201, 301, 400, 401, 404, 409, 413, 422}) {
    TEST_ASSERT_EQUAL_INT(
      static_cast<int>(HttpResponseAction::DropSample),
      static_cast<int>(httpResponseAction(code))
    );
  }
}

void test_retry_after_is_strict_bounded_and_status_aware() {
  TEST_ASSERT_EQUAL_UINT32(0, retryAfterDelayMs(nullptr));
  TEST_ASSERT_EQUAL_UINT32(0, retryAfterDelayMs(""));
  TEST_ASSERT_EQUAL_UINT32(0, retryAfterDelayMs("12junk"));
  TEST_ASSERT_EQUAL_UINT32(12000, retryAfterDelayMs(" 12 "));
  TEST_ASSERT_EQUAL_UINT32(HTTPS_RETRY_AFTER_MAX_MS, retryAfterDelayMs("999999"));
  TEST_ASSERT_EQUAL_UINT32(60000, minimumHttpRetryDelayMs(429));
  TEST_ASSERT_EQUAL_UINT32(120000, minimumHttpRetryDelayMs(429, 120000));
  TEST_ASSERT_EQUAL_UINT32(HTTPS_RETRY_AFTER_MAX_MS, minimumHttpRetryDelayMs(429, 999999));
  TEST_ASSERT_EQUAL_UINT32(60000, minimumHttpRetryDelayMs(401));
  TEST_ASSERT_EQUAL_UINT32(30000, minimumHttpRetryDelayMs(400));
  TEST_ASSERT_EQUAL_UINT32(0, minimumHttpRetryDelayMs(503));
}

void test_template_configuration_is_detected_without_logging_secrets() {
  const char *certificate = "-----BEGIN CERTIFICATE-----\nvalid\n-----END CERTIFICATE-----";
  TEST_ASSERT_FALSE(hasTemplateConfiguration(
    "campus-wifi",
    "not-printed",
    "a-real-provisioned-secret",
    "https://api.eki.example.edu",
    certificate
  ));
  TEST_ASSERT_TRUE(hasTemplateConfiguration(
    "YOUR_WIFI_SSID",
    "not-printed",
    "a-real-provisioned-secret",
    "https://api.eki.example.edu",
    certificate
  ));
  TEST_ASSERT_TRUE(hasTemplateConfiguration(
    "campus-wifi",
    "not-printed",
    "GENERATE_AT_LEAST_20_RANDOM_CHARACTERS",
    "https://api.eki.example.edu",
    certificate
  ));
  TEST_ASSERT_TRUE(hasTemplateConfiguration(
    "campus-wifi",
    "not-printed",
    "a-real-provisioned-secret",
    "https://your-backend.example",
    certificate
  ));
  TEST_ASSERT_TRUE(hasTemplateConfiguration(
    "campus-wifi",
    "not-printed",
    "a-real-provisioned-secret",
    "https://api.eki.example.edu",
    "REPLACE_WITH_THE_CA_THAT_ISSUED_THE_BACKEND_CERTIFICATE"
  ));
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
  RUN_TEST(test_http_response_actions_cover_transport_and_status_families);
  RUN_TEST(test_retry_after_is_strict_bounded_and_status_aware);
  RUN_TEST(test_template_configuration_is_detected_without_logging_secrets);
  RUN_TEST(test_publish_policy_handles_floor_changes_and_heartbeats);
  return UNITY_END();
}
