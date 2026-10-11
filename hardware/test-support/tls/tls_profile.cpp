#include <mbedtls/ssl.h>
#include <mbedtls/ecdh.h>
#include <cassert>
#include <cstdio>
#include <cstring>
#include <ctime>
#include "freertos/task.h"

TaskHandle_t testTask = reinterpret_cast<TaskHandle_t>(1);
#if defined(MBEDTLS_PLATFORM_GMTIME_R_ALT)
// Older MinGW lacks gmtime_s. Only this single-threaded host adapter uses it.
extern "C" struct tm *mbedtls_platform_gmtime_r(const time_t *input, struct tm *out) {
  const auto *converted = std::gmtime(input);
  if (!converted) return nullptr;
  *out = *converted;
  return out;
}
#endif
static unsigned randomCounter = 1;
static unsigned fallbackCalls = 0;
// Repeatable test RNG; does not represent device entropy quality.
void esp_fill_random(void *out, size_t size) {
  auto *bytes = static_cast<unsigned char *>(out);
  for (size_t i = 0; i < size; ++i) {
    randomCounter = randomCounter * 1664525u + 1013904223u;
    bytes[i] = static_cast<unsigned char>(randomCounter >> 24);
  }
}
static int rng(void *, unsigned char *out, size_t size) { esp_fill_random(out, size); return 0; }
extern "C" int __real_mbedtls_ssl_config_defaults(mbedtls_ssl_config *conf, int endpoint, int transport, int preset) {
  return mbedtls_ssl_config_defaults(conf, endpoint, transport, preset);
}
extern "C" int __real_mbedtls_ecdh_make_public(mbedtls_ecdh_context *ctx, size_t *len,
  unsigned char *buf, size_t size, int (*random)(void *, unsigned char *, size_t), void *arg) {
  ++fallbackCalls;
  return mbedtls_ecdh_make_public(ctx, len, buf, size, random, arg);
}
extern "C" int __wrap_mbedtls_ssl_config_defaults(mbedtls_ssl_config *, int, int, int);
extern "C" int __wrap_mbedtls_ecdh_make_public(mbedtls_ecdh_context *, size_t *,
  unsigned char *, size_t, int (*)(void *, unsigned char *, size_t), void *);
void prepareTelemetryTlsKey();
void releaseTelemetryTlsKey();

static void publicKey(mbedtls_ecp_group_id group, unsigned char *out) {
  mbedtls_ecdh_context ctx;
  mbedtls_ecdh_init(&ctx);
  assert(mbedtls_ecdh_setup(&ctx, group) == 0);
  size_t size = 0;
  assert(__wrap_mbedtls_ecdh_make_public(&ctx, &size, out, 100, rng, nullptr) == 0);
  assert(size == (group == MBEDTLS_ECP_DP_SECP256R1 ? 66u : 98u));
  mbedtls_ecdh_free(&ctx);
}
int main() {
  mbedtls_ssl_config client, server;
  mbedtls_ssl_config_init(&client); mbedtls_ssl_config_init(&server);
  assert(__wrap_mbedtls_ssl_config_defaults(&client, MBEDTLS_SSL_IS_CLIENT,
    MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT) == 0);
  assert(client.ciphersuite_list[0][0] == MBEDTLS_TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256);
  assert(client.ciphersuite_list[0][1] == MBEDTLS_TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384);
  assert(client.ciphersuite_list[0][2] == 0);
  assert(client.curve_list[0] == MBEDTLS_ECP_DP_SECP256R1 && client.curve_list[1] == MBEDTLS_ECP_DP_NONE);
  assert(client.authmode == MBEDTLS_SSL_VERIFY_REQUIRED);
  assert(__wrap_mbedtls_ssl_config_defaults(&server, MBEDTLS_SSL_IS_SERVER,
    MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT) == 0);
  assert(server.ciphersuite_list[0][2] != 0);
  mbedtls_ssl_config_free(&client); mbedtls_ssl_config_free(&server);
  std::puts("TLS profile: real client config restricts ECDHE-RSA/GCM/P-256 and retains required certificate verification");

  unsigned char first[100]{}, next[100]{}, other[100]{};
  prepareTelemetryTlsKey();
  testTask = reinterpret_cast<TaskHandle_t>(2);
  prepareTelemetryTlsKey();
  publicKey(MBEDTLS_ECP_DP_SECP256R1, other);
  assert(fallbackCalls == 0);
  releaseTelemetryTlsKey();
  testTask = reinterpret_cast<TaskHandle_t>(1);
  publicKey(MBEDTLS_ECP_DP_SECP256R1, first);
  assert(fallbackCalls == 0 && std::memcmp(first, other, 66) != 0);
  publicKey(MBEDTLS_ECP_DP_SECP256R1, next);
  assert(fallbackCalls == 1 && std::memcmp(first, next, 66) != 0);
  releaseTelemetryTlsKey();
  std::puts("TLS profile: task-owned real ECDH prepared keys are distinct and single-use");

  prepareTelemetryTlsKey();
  publicKey(MBEDTLS_ECP_DP_SECP384R1, other);
  assert(fallbackCalls == 2);
  publicKey(MBEDTLS_ECP_DP_SECP256R1, first);
  assert(fallbackCalls == 2);
  releaseTelemetryTlsKey();
  publicKey(MBEDTLS_ECP_DP_SECP256R1, other);
  assert(fallbackCalls == 3);
  std::puts("TLS profile: group mismatch and released key use normal real ECDH fallback");
}
