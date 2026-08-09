#include <unity.h>

#include "clock_policy.h"
#include "connectivity_policy.h"
#include "telemetry_policy.h"
#include "telemetry_queue.h"

using namespace eki::telemetry;

void setUp() {}
void tearDown() {}

struct QueuedSample {
  int64_t timestamp;
  uint32_t sequence;
  int value;
};

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
  for (const int code : {201, 301, 400, 404, 409, 413, 422}) {
    TEST_ASSERT_EQUAL_INT(
      static_cast<int>(HttpResponseAction::DropSample),
      static_cast<int>(httpResponseAction(code))
    );
  }
  for (const int code : {401, 403}) {
    TEST_ASSERT_EQUAL_INT(
      static_cast<int>(HttpResponseAction::HaltCredentials),
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
  TEST_ASSERT_EQUAL_UINT32(0, minimumHttpRetryDelayMs(401));
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
    certificate,
    "a-unique-recovery-password"
  ));
  TEST_ASSERT_TRUE(hasTemplateConfiguration(
    "YOUR_WIFI_SSID",
    "not-printed",
    "a-real-provisioned-secret",
    "https://api.eki.example.edu",
    certificate,
    "a-unique-recovery-password"
  ));
  TEST_ASSERT_TRUE(hasTemplateConfiguration(
    "campus-wifi",
    "not-printed",
    "GENERATE_AT_LEAST_20_RANDOM_CHARACTERS",
    "https://api.eki.example.edu",
    certificate,
    "a-unique-recovery-password"
  ));
  TEST_ASSERT_TRUE(hasTemplateConfiguration(
    "campus-wifi",
    "not-printed",
    "a-real-provisioned-secret",
    "https://your-backend.example",
    certificate,
    "a-unique-recovery-password"
  ));
  TEST_ASSERT_TRUE(hasTemplateConfiguration(
    "campus-wifi",
    "not-printed",
    "a-real-provisioned-secret",
    "https://api.eki.example.edu",
    "REPLACE_WITH_THE_CA_THAT_ISSUED_THE_BACKEND_CERTIFICATE",
    "a-unique-recovery-password"
  ));
  TEST_ASSERT_TRUE(hasTemplateConfiguration(
    "campus-wifi",
    "not-printed",
    "a-real-provisioned-secret",
    "https://api.eki.example.edu",
    certificate,
    "GENERATE_UNIQUE_RECOVERY_PASSWORD"
  ));
}

void test_gnss_utc_conversion_and_clock_discipline_are_strict() {
  eki::clock::UtcDateTime utc{2024, 1, 1, 0, 0, 0, 0};
  int64_t epochMs = 0;
  TEST_ASSERT_TRUE(eki::clock::utcToEpochMilliseconds(utc, epochMs));
  TEST_ASSERT_TRUE(epochMs == 1704067200000LL);

  utc = {2024, 2, 29, 12, 34, 56, 78};
  TEST_ASSERT_TRUE(eki::clock::utcToEpochMilliseconds(utc, epochMs));
  TEST_ASSERT_TRUE(epochMs == 1709210096780LL);

  utc = {2023, 2, 29, 12, 0, 0, 0};
  TEST_ASSERT_FALSE(eki::clock::utcToEpochMilliseconds(utc, epochMs));
  utc = {2024, 1, 1, 24, 0, 0, 0};
  TEST_ASSERT_FALSE(eki::clock::utcToEpochMilliseconds(utc, epochMs));

  TEST_ASSERT_TRUE(eki::clock::shouldApplyGnssClock(
    false, 0, 0, 1704067200000LL
  ));
  TEST_ASSERT_FALSE(eki::clock::shouldApplyGnssClock(
    true, eki::clock::GNSS_CLOCK_REFRESH_MS - 1,
    1704067200000LL, 1704067205000LL
  ));
  TEST_ASSERT_FALSE(eki::clock::shouldApplyGnssClock(
    true, eki::clock::GNSS_CLOCK_REFRESH_MS,
    1704067200000LL, 1704067201000LL
  ));
  TEST_ASSERT_TRUE(eki::clock::shouldApplyGnssClock(
    true, eki::clock::GNSS_CLOCK_REFRESH_MS,
    1704067200000LL, 1704067202000LL
  ));
}

void test_wifi_retry_escalates_and_led_codes_are_deterministic() {
  using namespace eki::connectivity;
  WifiRetrySupervisor supervisor;
  supervisor.observe(false, 100);
  TEST_ASSERT_TRUE(supervisor.attemptDue(100));
  supervisor.recordAttempt(100);
  TEST_ASSERT_FALSE(supervisor.attemptDue(5099));
  TEST_ASSERT_TRUE(supervisor.attemptDue(5100));
  supervisor.recordAttempt(5100);
  TEST_ASSERT_FALSE(supervisor.recoveryDue(120099));
  TEST_ASSERT_TRUE(supervisor.recoveryDue(120100));
  TEST_ASSERT_TRUE(supervisor.recoveryStartDue(120100));
  supervisor.recordRecoveryStartAttempt(120100);
  TEST_ASSERT_FALSE(supervisor.recoveryStartDue(180099));
  TEST_ASSERT_TRUE(supervisor.recoveryStartDue(180100));
  supervisor.restartAfterConfiguration(120100);
  TEST_ASSERT_TRUE(supervisor.attemptDue(120100));
  supervisor.observe(true, 120101);
  TEST_ASSERT_FALSE(supervisor.attemptDue(120101));

  TEST_ASSERT_TRUE(wifiCredentialsAreValid(
    "campus", 6, "password", 8
  ));
  TEST_ASSERT_FALSE(wifiCredentialsAreValid(
    "campus", 6, "short", 5
  ));
  TEST_ASSERT_FALSE(wifiCredentialsAreValid(
    "bad\0ssid", 8, "password", 8
  ));
  TEST_ASSERT_FALSE(wifiCredentialsAreValid(
    "campus", 6, "bad\npassword", 12
  ));
  WifiCredentialRecord record{};
  TEST_ASSERT_TRUE(makeWifiCredentialRecord(
    "campus", 6, "password", 8, record
  ));
  TEST_ASSERT_TRUE(wifiCredentialRecordIsValid(record));
  record.password[0] = 'P';
  TEST_ASSERT_FALSE(wifiCredentialRecordIsValid(record));
  TEST_ASSERT_TRUE(makeWifiCredentialRecord(
    "campus", 6, "password", 8, record
  ));
  ++record.version;
  TEST_ASSERT_FALSE(wifiCredentialRecordIsValid(record));
  TEST_ASSERT_FALSE(statusLedOn(FaultCode::None, 0));
  TEST_ASSERT_TRUE(statusLedOn(FaultCode::WifiRecovery, 0));
  TEST_ASSERT_TRUE(statusLedOn(FaultCode::WifiRecovery, 300));
  TEST_ASSERT_FALSE(statusLedOn(FaultCode::WifiRecovery, 600));
  TEST_ASSERT_TRUE(statusLedOn(FaultCode::CredentialRejected, 600));
  TEST_ASSERT_FALSE(statusLedOn(FaultCode::CredentialRejected, 900));
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

void test_queue_delivers_newest_first_and_retains_failed_samples() {
  NewestFirstTelemetryQueue<QueuedSample, 4> queue;
  queue.reset(42);
  const uint32_t first = queue.push({1000, 0, 1});
  const uint32_t second = queue.push({2000, 0, 2});
  const uint32_t third = queue.push({3000, 0, 3});

  QueuedSample sample{};
  TEST_ASSERT_TRUE(queue.newest(sample));
  TEST_ASSERT_EQUAL_INT(3, sample.value);
  TEST_ASSERT_EQUAL_UINT32(third, sample.sequence);

  // A retry does not mutate the queue. If a fresher fix arrives, it is the
  // next candidate while the failed sample remains available behind it.
  TEST_ASSERT_TRUE(queue.newest(sample));
  TEST_ASSERT_EQUAL_UINT32(third, sample.sequence);
  const uint32_t fourth = queue.push({4000, 0, 4});
  TEST_ASSERT_TRUE(queue.newest(sample));
  TEST_ASSERT_EQUAL_UINT32(fourth, sample.sequence);
  TEST_ASSERT_TRUE(queue.remove(fourth));
  TEST_ASSERT_TRUE(queue.remove(third));
  TEST_ASSERT_TRUE(queue.newest(sample));
  TEST_ASSERT_EQUAL_UINT32(second, sample.sequence);
  TEST_ASSERT_TRUE(queue.remove(first));
  TEST_ASSERT_EQUAL_UINT32(1, queue.size());
}

void test_queue_wraparound_drops_oldest_and_counts_overflow() {
  NewestFirstTelemetryQueue<QueuedSample, 3> queue;
  queue.reset();
  const uint32_t evicted = queue.push({1000, 0, 1});
  const uint32_t oldest = queue.push({2000, 0, 2});
  const uint32_t middle = queue.push({3000, 0, 3});
  const uint32_t newest = queue.push({4000, 0, 4});

  const auto stats = queue.stats();
  TEST_ASSERT_EQUAL_UINT32(3, stats.depth);
  TEST_ASSERT_EQUAL_UINT32(3, stats.highWaterMark);
  TEST_ASSERT_EQUAL_UINT32(1, stats.overflowDrops);
  TEST_ASSERT_FALSE(queue.remove(evicted));

  QueuedSample sample{};
  TEST_ASSERT_TRUE(queue.newest(sample));
  TEST_ASSERT_EQUAL_UINT32(newest, sample.sequence);
  TEST_ASSERT_EQUAL_INT(4, sample.value);

  // head_ is non-zero after wraparound. Exercise both the wrapped middle
  // shift and the O(1) oldest-removal path without disturbing the newest fix.
  TEST_ASSERT_TRUE(queue.remove(middle));
  TEST_ASSERT_EQUAL_UINT32(2, queue.size());
  TEST_ASSERT_TRUE(queue.newest(sample));
  TEST_ASSERT_EQUAL_INT(4, sample.value);
  TEST_ASSERT_TRUE(queue.remove(oldest));
  TEST_ASSERT_EQUAL_UINT32(1, queue.size());
  TEST_ASSERT_TRUE(queue.newest(sample));
  TEST_ASSERT_EQUAL_UINT32(newest, sample.sequence);
}

void test_queue_purges_stale_samples_and_validates_rtc_identity() {
  NewestFirstTelemetryQueue<QueuedSample, 5> queue;
  queue.reset(7);
  queue.push({1000, 0, 1});
  queue.push({4000, 0, 4});
  queue.push({2000, 0, 2});
  TEST_ASSERT_EQUAL_UINT32(2, queue.dropOlderThan(3000));

  const auto stats = queue.stats();
  TEST_ASSERT_EQUAL_UINT32(1, stats.depth);
  TEST_ASSERT_EQUAL_UINT32(2, stats.staleDrops);
  TEST_ASSERT_TRUE(queue.initializeOrRecover(7));
  TEST_ASSERT_FALSE(queue.initializeOrRecover(8));
  TEST_ASSERT_EQUAL_UINT32(0, queue.size());
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_haversine_and_heading_wrap);
  RUN_TEST(test_motion_hysteresis_filters_single_noisy_readings);
  RUN_TEST(test_retry_backoff_is_jittered_and_bounded);
  RUN_TEST(test_http_response_actions_cover_transport_and_status_families);
  RUN_TEST(test_retry_after_is_strict_bounded_and_status_aware);
  RUN_TEST(test_template_configuration_is_detected_without_logging_secrets);
  RUN_TEST(test_gnss_utc_conversion_and_clock_discipline_are_strict);
  RUN_TEST(test_wifi_retry_escalates_and_led_codes_are_deterministic);
  RUN_TEST(test_publish_policy_handles_floor_changes_and_heartbeats);
  RUN_TEST(test_queue_delivers_newest_first_and_retains_failed_samples);
  RUN_TEST(test_queue_wraparound_drops_oldest_and_counts_overflow);
  RUN_TEST(test_queue_purges_stale_samples_and_validates_rtc_identity);
  return UNITY_END();
}
