#if defined(ARDUINO_ARCH_ESP32)
#include <mbedtls/ssl.h>
#include <mbedtls/ecp.h>
#include <mbedtls/ecdh.h>
#include <atomic>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

// The pinned Arduino core has no public cipher/curve configuration API.
// Wrap configuration initialization rather than modifying the installed SDK.
// ECDHE preserves forward secrecy; GCM and certificate verification remain
// enabled. RSA-authenticated chains avoid this ESP32's very slow ECDSA chain
// verification against the tunnel. P-256 bounds ephemeral curve CPU cost.
extern "C" int __real_mbedtls_ssl_config_defaults(
  mbedtls_ssl_config *, int, int, int);
extern "C" int __wrap_mbedtls_ssl_config_defaults(
  mbedtls_ssl_config *config, int endpoint, int transport, int preset) {
  const int result = __real_mbedtls_ssl_config_defaults(config, endpoint, transport, preset);
  if (result != 0 || endpoint != MBEDTLS_SSL_IS_CLIENT) return result;
  static const int suites[] = {
    MBEDTLS_TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
    MBEDTLS_TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
    0
  };
  static const mbedtls_ecp_group_id curves[] = {
    MBEDTLS_ECP_DP_SECP256R1, MBEDTLS_ECP_DP_NONE
  };
  mbedtls_ssl_conf_ciphersuites(config, suites);
  mbedtls_ssl_conf_curves(config, curves);
  return result;
}
// Each network task owns a separate single-use key. Atomic slot ownership
// prevents diagnostics from consuming or freeing the publisher's key.
struct PreparedKey {
  mbedtls_ecp_keypair key{};
  std::atomic<TaskHandle_t> owner{nullptr};
  bool ready = false;
};
static PreparedKey preparedKeys[3];
static PreparedKey *currentKey() {
  const TaskHandle_t task = xTaskGetCurrentTaskHandle();
  for (auto &slot : preparedKeys) if (slot.owner.load() == task) return &slot;
  return nullptr;
}
static int hardwareRandom(void *, unsigned char *out, size_t size) {
  esp_fill_random(out, size);
  return 0;
}
void prepareTelemetryTlsKey() {
  for (auto &slot : preparedKeys) {
    TaskHandle_t expected = nullptr;
    if (!slot.owner.compare_exchange_strong(expected, xTaskGetCurrentTaskHandle())) continue;
    mbedtls_ecp_keypair_init(&slot.key);
    slot.ready = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1,
      &slot.key, hardwareRandom, nullptr) == 0;
    return;
  }
}
void releaseTelemetryTlsKey() {
  auto *slot = currentKey();
  if (slot == nullptr) return;
  slot->ready = false;
  mbedtls_ecp_keypair_free(&slot->key);
  slot->owner.store(nullptr);
}
extern "C" int __real_mbedtls_ecdh_make_public(mbedtls_ecdh_context *, size_t *,
  unsigned char *, size_t, int (*)(void *, unsigned char *, size_t), void *);
extern "C" int __wrap_mbedtls_ecdh_make_public(mbedtls_ecdh_context *ctx, size_t *olen,
  unsigned char *buf, size_t blen, int (*rng)(void *, unsigned char *, size_t), void *rngContext) {
  auto *slot = currentKey();
  if (slot == nullptr || !slot->ready || ctx->grp.id != slot->key.grp.id) {
    return __real_mbedtls_ecdh_make_public(ctx, olen, buf, blen, rng, rngContext);
  }
  slot->ready = false;
  const int result = mbedtls_ecdh_get_params(ctx, &slot->key, MBEDTLS_ECDH_OURS);
  if (result != 0) return result;
  return mbedtls_ecp_tls_write_point(&ctx->grp, &ctx->Q, ctx->point_format, olen, buf, blen);
}
#endif
