#include "recovery_portal.h"

#include "connectivity_policy.h"
#include <Arduino.h>
#include <WiFi.h>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <esp_random.h>

namespace eki {
namespace connectivity {
namespace {

constexpr char PREFERENCES_NAMESPACE[] = "eki-network";
constexpr char PREFERENCES_KEY[] = "station";

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
<title>Eki Wi-Fi recovery</title><style>body{font:16px system-ui;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#17202a}label{display:block;margin-top:1rem}input,button{box-sizing:border-box;width:100%;padding:.8rem;margin-top:.35rem}button{font-weight:700}</style>
<h1>Eki Wi-Fi recovery</h1><p>Enter the replacement station network. Credentials stay on this device and are never returned by this page.</p>
<form method="post" action="/wifi"><input type="hidden" name="csrf" value="{{csrf}}"><label>Wi-Fi name<input name="ssid" required maxlength="32" autocomplete="off"></label><label>Wi-Fi password<input name="password" type="password" required minlength="8" maxlength="63" autocomplete="new-password"></label><button type="submit">Save and reconnect</button></form>
</html>)HTML";

} // namespace

bool StationCredentials::copyFrom(
  const char *ssid,
  size_t ssidLength,
  const char *password,
  size_t passwordLength
) {
  if (!wifiCredentialsAreValid(ssid, ssidLength, password, passwordLength)) {
    return false;
  }
  std::memcpy(ssid_, ssid, ssidLength);
  ssid_[ssidLength] = '\0';
  std::memcpy(password_, password, passwordLength);
  password_[passwordLength] = '\0';
  return true;
}

bool StationCredentials::load(
  const char *fallbackSsid,
  const char *fallbackPassword
) {
  Preferences preferences;
  WifiCredentialRecord record{};
  const bool opened = preferences.begin(PREFERENCES_NAMESPACE, true);
  if (
    opened &&
    preferences.getBytesLength(PREFERENCES_KEY) == sizeof(record) &&
    preferences.getBytes(PREFERENCES_KEY, &record, sizeof(record)) == sizeof(record) &&
    wifiCredentialRecordIsValid(record)
  ) {
    preferences.end();
    loadedFromNvs_ = copyFrom(
      record.ssid,
      boundedCStringLength(record.ssid, sizeof(record.ssid)),
      record.password,
      boundedCStringLength(record.password, sizeof(record.password))
    );
    return loadedFromNvs_;
  }
  if (opened) preferences.end();
  loadedFromNvs_ = false;
  return copyFrom(
    fallbackSsid,
    boundedCStringLength(fallbackSsid, 33),
    fallbackPassword,
    boundedCStringLength(fallbackPassword, 64)
  );
}

bool StationCredentials::save(
  const char *ssid,
  size_t ssidLength,
  const char *password,
  size_t passwordLength
) {
  WifiCredentialRecord record{};
  if (!makeWifiCredentialRecord(
    ssid,
    ssidLength,
    password,
    passwordLength,
    record
  )) return false;

  Preferences preferences;
  if (!preferences.begin(PREFERENCES_NAMESPACE, false)) return false;
  const bool written =
    preferences.putBytes(PREFERENCES_KEY, &record, sizeof(record)) == sizeof(record);
  preferences.end();
  if (!written || !copyFrom(ssid, ssidLength, password, passwordLength)) {
    return false;
  }
  loadedFromNvs_ = true;
  return true;
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
  String html(FPSTR(RECOVERY_HTML));
  html.replace("{{csrf}}", csrfToken_);
  server_.send(200, "text/html; charset=utf-8", html);
}

void RecoveryPortal::handleStatus() {
  setSecurityHeaders();
  server_.send(
    200,
    "application/json",
    WiFi.status() == WL_CONNECTED
      ? "{\"stationConnected\":true}"
      : "{\"stationConnected\":false}"
  );
}

void RecoveryPortal::handleWifiUpdate() {
  setSecurityHeaders();
  if (
    credentials_ == nullptr ||
    !server_.hasArg("csrf") ||
    !server_.hasArg("ssid") ||
    !server_.hasArg("password")
  ) {
    server_.send(400, "application/json", "{\"error\":\"Missing Wi-Fi credentials.\"}");
    return;
  }

  const String csrf = server_.arg("csrf");
  if (!constantTimeTokenEquals(csrf.c_str(), csrfToken_)) {
    server_.send(403, "application/json", "{\"error\":\"Recovery form expired.\"}");
    return;
  }

  const String ssid = server_.arg("ssid");
  const String password = server_.arg("password");
  if (!credentials_->save(ssid.c_str(), ssid.length(), password.c_str(), password.length())) {
    server_.send(400, "application/json", "{\"error\":\"Wi-Fi name or password is invalid.\"}");
    return;
  }
  credentialsUpdated_ = true;
  rotateCsrfToken();
  server_.send(202, "application/json", "{\"saved\":true,\"reconnecting\":true}");
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
  server_.on("/wifi", HTTP_POST, [this]() { handleWifiUpdate(); });
  server_.onNotFound([this]() {
    setSecurityHeaders();
    server_.send(404, "application/json", "{\"error\":\"Not found.\"}");
  });
  handlersRegistered_ = true;
}

bool RecoveryPortal::start(
  const char *deviceId,
  const char *recoveryPassword,
  StationCredentials &credentials
) {
  if (active_) return true;
  const size_t passwordLength = boundedCStringLength(recoveryPassword, 64);
  if (!recoveryPasswordIsValid(recoveryPassword, passwordLength)) return false;

  char suffix[13]{};
  size_t suffixLength = 0;
  if (deviceId != nullptr) {
    for (size_t index = 0; deviceId[index] != '\0'; ++index) {
      const unsigned char character = static_cast<unsigned char>(deviceId[index]);
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

  credentials_ = &credentials;
  rotateCsrfToken();
  registerHandlers();
  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAP(accessPointSsid_, recoveryPassword, 1, false, 1)) {
    credentials_ = nullptr;
    csrfToken_[0] = '\0';
    WiFi.mode(WIFI_STA);
    return false;
  }
  server_.begin();
  active_ = true;
  return true;
}

void RecoveryPortal::handleClient() {
  if (active_) server_.handleClient();
}

void RecoveryPortal::stop() {
  if (!active_) return;
  server_.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  credentials_ = nullptr;
  csrfToken_[0] = '\0';
  active_ = false;
}

bool RecoveryPortal::consumeCredentialsUpdated() {
  const bool updated = credentialsUpdated_;
  credentialsUpdated_ = false;
  return updated;
}

} // namespace connectivity
} // namespace eki
