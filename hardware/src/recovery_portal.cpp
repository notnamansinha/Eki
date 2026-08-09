#include "recovery_portal.h"

#include "connectivity_policy.h"
#include <Arduino.h>
#include <WiFi.h>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <esp_random.h>
#include <esp_system.h>
#include <esp_wifi.h>

namespace eki {
namespace connectivity {
namespace {

constexpr char CONFIG_NAMESPACE[] = "eki-config";
constexpr char CONFIG_KEY[] = "active";
constexpr char RECOVERY_NAMESPACE[] = "eki-recovery";
constexpr char RECOVERY_KEY[] = "password";
// Bound how often /provision may be attempted from the AP subnet. The CSRF
// token is the primary gate; this throttles anything that slips past it.
constexpr uint32_t PROVISION_WINDOW_MS = 60 * 1000;
constexpr uint8_t PROVISION_MAX_ATTEMPTS_PER_WINDOW = 5;

bool constantTimeTokenEquals(const char *left, const char *right) {
  if (left == nullptr || right == nullptr) return false;
  if (std::strlen(left) != 16 || std::strlen(right) != 16) return false;
  uint8_t difference = 0;
  for (size_t index = 0; index < 16; ++index) {
    difference |= static_cast<uint8_t>(left[index] ^ right[index]);
  }
  return difference == 0;
}

const char RECOVERY_HTML[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'">
<title>Eki device provisioning</title><style>body{font:16px system-ui;max-width:38rem;margin:2rem auto;padding:0 1rem;color:#17202a}label{display:block;margin-top:1rem}input,textarea,button{box-sizing:border-box;width:100%;padding:.8rem;margin-top:.35rem}textarea{min-height:12rem;font:12px monospace}button{font-weight:700}</style>
<h1>Eki device provisioning</h1><p>Enter the complete replacement configuration. Values stay on this device, are never returned by this page, and take effect after an automatic restart.</p>
<form method="post" action="/provision"><input type="hidden" name="csrf" value="{{csrf}}"><label>Wi-Fi name<input name="ssid" required maxlength="32" autocomplete="off"></label><label>Wi-Fi password<input name="wifiPassword" type="password" required minlength="8" maxlength="63" autocomplete="new-password"></label><label>Device ID<input name="deviceId" required maxlength="128" pattern="[A-Za-z0-9_-]+" autocomplete="off"></label><label>Device API secret<input name="deviceSecret" type="password" required minlength="20" maxlength="128" pattern="[A-Za-z0-9_-]+" autocomplete="new-password"></label><label>HTTPS backend origin<input name="backendUrl" type="url" required maxlength="256" placeholder="https://api.example.edu" autocomplete="off"></label><label>Backend root CA certificate<textarea name="backendRootCa" required maxlength="3072" spellcheck="false" autocomplete="off"></textarea></label><button type="submit">Store configuration and restart</button></form>
</html>)HTML";

} // namespace

bool DeviceConfiguration::load() {
  Preferences preferences;
  const bool opened = preferences.begin(CONFIG_NAMESPACE, true);
  const bool loaded =
    opened &&
    preferences.getBytesLength(CONFIG_KEY) == sizeof(record_) &&
    preferences.getBytes(CONFIG_KEY, &record_, sizeof(record_)) == sizeof(record_) &&
    deviceConfigurationRecordIsValid(record_);
  if (opened) preferences.end();
  if (!loaded) std::memset(&record_, 0, sizeof(record_));
  provisioned_ = loaded;
  return loaded;
}

bool DeviceConfiguration::save(
  const char *wifiSsid,
  size_t wifiSsidLength,
  const char *wifiPassword,
  size_t wifiPasswordLength,
  const char *deviceId,
  size_t deviceIdLength,
  const char *deviceSecret,
  size_t deviceSecretLength,
  const char *backendUrl,
  size_t backendUrlLength,
  const char *backendRootCa,
  size_t backendRootCaLength
) {
  if (!makeDeviceConfigurationRecord(
    wifiSsid,
    wifiSsidLength,
    wifiPassword,
    wifiPasswordLength,
    deviceId,
    deviceIdLength,
    deviceSecret,
    deviceSecretLength,
    backendUrl,
    backendUrlLength,
    backendRootCa,
    backendRootCaLength,
    candidate_
  )) return false;

  Preferences preferences;
  if (!preferences.begin(CONFIG_NAMESPACE, false)) return false;
  const bool written =
    preferences.putBytes(CONFIG_KEY, &candidate_, sizeof(candidate_)) ==
      sizeof(candidate_);
  preferences.end();
  if (!written) return false;
  record_ = candidate_;
  provisioned_ = true;
  return true;
}

bool RecoveryAccess::loadOrCreate() {
  Preferences preferences;
  bool opened = preferences.begin(RECOVERY_NAMESPACE, true);
  if (opened) {
    const size_t storedLength = preferences.getString(
      RECOVERY_KEY,
      password_,
      sizeof(password_)
    );
    preferences.end();
    const size_t passwordLength =
      storedLength > 0 && password_[storedLength - 1] == '\0'
        ? storedLength - 1
        : storedLength;
    if (recoveryPasswordIsValid(password_, passwordLength)) return true;
  }
  return generateAndPersist();
}

bool RecoveryAccess::rotate() {
  // Explicit rotation replaces the stored password unconditionally; the
  // caller (the authenticated recovery portal) shows the new value once.
  return generateAndPersist();
}

bool RecoveryAccess::generateAndPersist() {
  constexpr char HEX_DIGITS[] = "0123456789abcdef";
  uint8_t randomBytes[12]{};
  esp_fill_random(randomBytes, sizeof(randomBytes));
  for (size_t index = 0; index < sizeof(randomBytes); ++index) {
    password_[index * 2] = HEX_DIGITS[randomBytes[index] >> 4];
    password_[index * 2 + 1] = HEX_DIGITS[randomBytes[index] & 0x0F];
  }
  password_[24] = '\0';

  Preferences preferences;
  if (!preferences.begin(RECOVERY_NAMESPACE, false)) return false;
  const bool written = preferences.putString(RECOVERY_KEY, password_) == 24;
  preferences.end();
  return written;
}

RecoveryPortal::RecoveryPortal() : server_(80) {}

void RecoveryPortal::setSecurityHeaders() {
  server_.sendHeader("Cache-Control", "no-store");
  server_.sendHeader("X-Content-Type-Options", "nosniff");
  server_.sendHeader("X-Frame-Options", "DENY");
  server_.sendHeader("Referrer-Policy", "no-referrer");
}

void RecoveryPortal::handleRoot() {
  setSecurityHeaders();
  if (!clientIsOnAccessPoint()) {
    server_.client().stop();
    return;
  }
  String html(FPSTR(RECOVERY_HTML));
  html.replace("{{csrf}}", csrfToken_);
  server_.send(200, "text/html; charset=utf-8", html);
}

void RecoveryPortal::handleStatus() {
  setSecurityHeaders();
  if (!clientIsOnAccessPoint()) {
    server_.client().stop();
    return;
  }
  const bool connected = WiFi.status() == WL_CONNECTED;
  const bool provisioned = configuration_ != nullptr && configuration_->provisioned();
  server_.send(
    200,
    "application/json",
    String("{\"stationConnected\":") + (connected ? "true" : "false") +
      ",\"provisioned\":" + (provisioned ? "true}" : "false}")
  );
}

void RecoveryPortal::handleProvisioningUpdate() {
  setSecurityHeaders();
  if (!clientIsOnAccessPoint()) {
    server_.client().stop();
    return;
  }
  if (!provisionAttemptAllowed()) {
    server_.send(
      429,
      "application/json",
      "{\"error\":\"Too many attempts; retry later.\"}"
    );
    return;
  }
  if (
    configuration_ == nullptr ||
    !server_.hasArg("csrf") ||
    !server_.hasArg("ssid") ||
    !server_.hasArg("wifiPassword") ||
    !server_.hasArg("deviceId") ||
    !server_.hasArg("deviceSecret") ||
    !server_.hasArg("backendUrl") ||
    !server_.hasArg("backendRootCa")
  ) {
    server_.send(400, "application/json", "{\"error\":\"Missing configuration.\"}");
    return;
  }

  const String csrf = server_.arg("csrf");
  if (!constantTimeTokenEquals(csrf.c_str(), csrfToken_)) {
    server_.send(403, "application/json", "{\"error\":\"Provisioning form expired.\"}");
    return;
  }

  const String ssid = server_.arg("ssid");
  const String wifiPassword = server_.arg("wifiPassword");
  const String deviceId = server_.arg("deviceId");
  const String deviceSecret = server_.arg("deviceSecret");
  const String backendUrl = server_.arg("backendUrl");
  const String backendRootCa = server_.arg("backendRootCa");
  if (!configuration_->save(
    ssid.c_str(),
    ssid.length(),
    wifiPassword.c_str(),
    wifiPassword.length(),
    deviceId.c_str(),
    deviceId.length(),
    deviceSecret.c_str(),
    deviceSecret.length(),
    backendUrl.c_str(),
    backendUrl.length(),
    backendRootCa.c_str(),
    backendRootCa.length()
  )) {
    server_.send(
      400,
      "application/json",
      "{\"error\":\"Configuration is invalid or could not be stored.\"}"
    );
    return;
  }
  configurationUpdated_ = true;
  rotateCsrfToken();
  server_.send(202, "application/json", "{\"saved\":true,\"restarting\":true}");
}

void RecoveryPortal::handleRecoveryRotation() {
  setSecurityHeaders();
  if (!clientIsOnAccessPoint()) {
    server_.client().stop();
    return;
  }
  if (!provisionAttemptAllowed()) {
    server_.send(
      429,
      "application/json",
      "{\"error\":\"Too many attempts; retry later.\"}"
    );
    return;
  }
  if (
    !server_.hasArg("csrf") ||
    !constantTimeTokenEquals(server_.arg("csrf").c_str(), csrfToken_)
  ) {
    server_.send(
      403,
      "application/json",
      "{\"error\":\"Invalid or expired token.\"}"
    );
    return;
  }
  if (recoveryAccess_ == nullptr || !recoveryAccess_->rotate()) {
    server_.send(
      500,
      "application/json",
      "{\"error\":\"Unable to rotate the recovery password.\"}"
    );
    return;
  }
  // Show the new password exactly once; the device restarts shortly so the
  // running AP adopts it. serviceConnectivity delays the restart a couple of
  // seconds so this response reliably reaches the operator.
  const String payload = String("{\"rotated\":true,\"recoveryPassword\":\"") +
    recoveryAccess_->password() + "\",\"restarting\":true}";
  recoveryRotationRequested_ = true;
  server_.send(202, "application/json", payload);
}

bool RecoveryPortal::consumeRecoveryRotationRequested() {
  const bool requested = recoveryRotationRequested_;
  recoveryRotationRequested_ = false;
  return requested;
}

void RecoveryPortal::rotateCsrfToken() {
  std::snprintf(
    csrfToken_,
    sizeof(csrfToken_),
    "%08lx%08lx",
    static_cast<unsigned long>(esp_random()),
    static_cast<unsigned long>(esp_random())
  );
}

void RecoveryPortal::registerHandlers() {
  if (handlersRegistered_) return;
  server_.on("/", HTTP_GET, [this]() { handleRoot(); });
  server_.on("/status", HTTP_GET, [this]() { handleStatus(); });
  server_.on(
    "/provision",
    HTTP_POST,
    [this]() { handleProvisioningUpdate(); }
  );
  server_.on(
    "/rotate-recovery",
    HTTP_POST,
    [this]() { handleRecoveryRotation(); }
  );
  server_.onNotFound([this]() {
    setSecurityHeaders();
    if (!clientIsOnAccessPoint()) {
      server_.client().stop();
      return;
    }
    server_.send(404, "application/json", "{\"error\":\"Not found.\"}");
  });
  handlersRegistered_ = true;
}

bool RecoveryPortal::start(
  const char *deviceLabel,
  RecoveryAccess &recoveryAccess,
  DeviceConfiguration &configuration
) {
  if (active_) return true;
  const char *recoveryPassword = recoveryAccess.password();
  const size_t passwordLength = boundedCStringLength(recoveryPassword, 64);
  if (!recoveryPasswordIsValid(recoveryPassword, passwordLength)) return false;

  char suffix[13]{};
  size_t suffixLength = 0;
  if (deviceLabel != nullptr) {
    for (size_t index = 0; deviceLabel[index] != '\0'; ++index) {
      const unsigned char character = static_cast<unsigned char>(deviceLabel[index]);
      if (!std::isalnum(character)) continue;
      if (suffixLength == sizeof(suffix) - 1) {
        std::memmove(suffix, suffix + 1, sizeof(suffix) - 2);
        --suffixLength;
      }
      suffix[suffixLength++] = static_cast<char>(character);
    }
  }
  if (suffixLength == 0) std::memcpy(suffix, "device", 7);
  std::snprintf(accessPointSsid_, sizeof(accessPointSsid_), "Eki-Recovery-%s", suffix);

  configuration_ = &configuration;
  recoveryAccess_ = &recoveryAccess;
  rotateCsrfToken();
  registerHandlers();
  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAP(accessPointSsid_, recoveryAccess.password(), 1, false, 1)) {
    configuration_ = nullptr;
    recoveryAccess_ = nullptr;
    csrfToken_[0] = '\0';
    WiFi.mode(WIFI_STA);
    return false;
  }
  // The documented configuration is a WPA2 access point. softAP() derives
  // WPA2-PSK only when a non-empty passphrase is supplied; verify the running
  // configuration so a future refactor can never silently expose an open
  // (unauthenticated) recovery AP.
  wifi_config_t accessPointConfig{};
  if (
    esp_wifi_get_config(WIFI_IF_AP, &accessPointConfig) != ESP_OK ||
    accessPointConfig.ap.authmode != WIFI_AUTH_WPA2_PSK
  ) {
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_STA);
    configuration_ = nullptr;
    recoveryAccess_ = nullptr;
    csrfToken_[0] = '\0';
    return false;
  }
  server_.begin();
  active_ = true;
  return true;
}

void RecoveryPortal::handleClient() {
  if (!active_) return;
  // The WebServer binds 0.0.0.0:80 on every interface. Never serve anything
  // that did not arrive through the WPA2-protected soft AP: while the device
  // is in credential-fault mode the portal is also reachable on the campus
  // STA interface, which would bypass the AP password entirely.
  if (server_.client().connected() && !clientIsOnAccessPoint()) {
    server_.client().stop();
  }
  server_.handleClient();
}

bool RecoveryPortal::clientIsOnAccessPoint() {
  const IPAddress clientIp = server_.client().remoteIP();
  if (clientIp == IPAddress(0, 0, 0, 0)) return false;
  const uint32_t client = static_cast<uint32_t>(clientIp);
  const uint32_t accessPoint = static_cast<uint32_t>(WiFi.softAPIP());
  const uint32_t subnetMask = static_cast<uint32_t>(WiFi.softAPSubnetMask());
  return (client & subnetMask) == (accessPoint & subnetMask);
}

bool RecoveryPortal::provisionAttemptAllowed() {
  const uint32_t now = millis();
  if (now - provisionWindowStartedAt_ >= PROVISION_WINDOW_MS) {
    provisionWindowStartedAt_ = now;
    provisionAttempts_ = 0;
  }
  return ++provisionAttempts_ <= PROVISION_MAX_ATTEMPTS_PER_WINDOW;
}

void RecoveryPortal::stop() {
  if (!active_) return;
  server_.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  recoveryAccess_ = nullptr;
  configuration_ = nullptr;
  csrfToken_[0] = '\0';
  recoveryRotationRequested_ = false;
  active_ = false;
}

bool RecoveryPortal::consumeConfigurationUpdated() {
  const bool updated = configurationUpdated_;
  configurationUpdated_ = false;
  return updated;
}

} // namespace connectivity
} // namespace eki
