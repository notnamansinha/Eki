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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-{{nonce}}'; connect-src 'self'; form-action 'self'; base-uri 'none'">
<title>Eki Wi-Fi recovery</title><style>body{font:16px system-ui;max-width:38rem;margin:2rem auto;padding:0 1rem;color:#17202a}label{display:block;margin-top:1rem}input,button{box-sizing:border-box;width:100%;padding:.8rem;margin-top:.35rem}button{font-weight:700}#result{min-height:1.5rem;font-weight:600}</style>
<h1>Eki Wi-Fi recovery</h1><p>Replace only the station Wi-Fi credentials. Device identity, API credentials, backend origin, and backend trust remain unchanged. The update takes effect after an automatic restart.</p>
<form method="post" action="/provision" novalidate><input type="hidden" name="csrf" value="{{csrf}}"><label>Wi-Fi name<input name="ssid" required maxlength="32" autocomplete="off"></label><label>Wi-Fi password<input name="wifiPassword" type="password" required minlength="8" maxlength="63" autocomplete="new-password"></label><button type="submit">Store Wi-Fi credentials and restart</button></form><p id="result" role="alert" aria-live="polite"></p>
<script nonce="{{nonce}}">const form=document.querySelector('form'),result=document.querySelector('#result'),button=form.querySelector('button');form.addEventListener('submit',async event=>{event.preventDefault();form.querySelectorAll('[aria-invalid]').forEach(field=>field.removeAttribute('aria-invalid'));button.disabled=true;result.textContent='Checking and storing Wi-Fi credentials...';try{const response=await fetch(form.action,{method:'POST',body:new FormData(form)}),payload=await response.json();if(!response.ok){result.textContent=payload.error+(payload.hint?' '+payload.hint:'');const field=payload.field&&form.elements.namedItem(payload.field);if(field){field.setAttribute('aria-invalid','true');field.focus()}button.disabled=false;return}result.textContent='Wi-Fi credentials saved. The device is restarting.'}catch(error){result.textContent='The device did not return a valid response. Reconnect to the recovery network and try again.';button.disabled=false}});</script>
</html>)HTML";

const char *configurationValidationPayload(
  DeviceConfigurationValidationError error
) {
  switch (error) {
    case DeviceConfigurationValidationError::WifiSsid:
      return "{\"error\":\"Invalid Wi-Fi name.\",\"field\":\"ssid\",\"hint\":\"Enter a network name between 1 and 32 bytes.\"}";
    case DeviceConfigurationValidationError::WifiPassword:
      return "{\"error\":\"Invalid Wi-Fi password.\",\"field\":\"wifiPassword\",\"hint\":\"Use an 8-63 character printable WPA2 passphrase; 64-character raw keys are not accepted.\"}";
    case DeviceConfigurationValidationError::DeviceId:
    case DeviceConfigurationValidationError::DeviceSecret:
    case DeviceConfigurationValidationError::BackendUrl:
    case DeviceConfigurationValidationError::BackendRootCa:
    case DeviceConfigurationValidationError::None:
      break;
  }
  return "{\"error\":\"Configuration validation failed.\"}";
}

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

bool DeviceConfiguration::updateWifiCredentials(
  const char *wifiSsid,
  size_t wifiSsidLength,
  const char *wifiPassword,
  size_t wifiPasswordLength
) {
  if (!provisioned_ || !makeWifiUpdatedDeviceConfigurationRecord(
    record_,
    wifiSsid,
    wifiSsidLength,
    wifiPassword,
    wifiPasswordLength,
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
  char candidate[RECOVERY_PASSWORD_LENGTH + 1]{};
  esp_fill_random(randomBytes, sizeof(randomBytes));
  for (size_t index = 0; index < sizeof(randomBytes); ++index) {
    candidate[index * 2] = HEX_DIGITS[randomBytes[index] >> 4];
    candidate[index * 2 + 1] = HEX_DIGITS[randomBytes[index] & 0x0F];
  }
  candidate[RECOVERY_PASSWORD_LENGTH] = '\0';

  Preferences preferences;
  if (!preferences.begin(RECOVERY_NAMESPACE, false)) {
    std::memset(randomBytes, 0, sizeof(randomBytes));
    std::memset(candidate, 0, sizeof(candidate));
    return false;
  }
  const size_t persistedLength = preferences.putString(RECOVERY_KEY, candidate);
  preferences.end();

  char verifiedValue[RECOVERY_PASSWORD_LENGTH + 1]{};
  Preferences verification;
  const bool verificationOpened = verification.begin(RECOVERY_NAMESPACE, true);
  const size_t verifiedLength = verificationOpened
    ? verification.getString(RECOVERY_KEY, verifiedValue, sizeof(verifiedValue))
    : 0;
  if (verificationOpened) verification.end();
  const size_t verifiedPasswordLength =
    verifiedLength > 0 && verifiedValue[verifiedLength - 1] == '\0'
      ? verifiedLength - 1
      : verifiedLength;
  const bool applied =
    verifiedPasswordLength == RECOVERY_PASSWORD_LENGTH &&
    applyPersistedRecoveryPassword(
      password_,
      sizeof(password_),
      candidate,
      persistedLength,
      verifiedValue,
      verifiedPasswordLength
    );
  std::memset(randomBytes, 0, sizeof(randomBytes));
  std::memset(candidate, 0, sizeof(candidate));
  std::memset(verifiedValue, 0, sizeof(verifiedValue));
  return applied;
}

RecoveryPortal::RecoveryPortal()
  : server_(IPAddress(192, 168, 4, 1), 80) {}

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
  html.replace("{{nonce}}", cspNonce_);
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
  if (configuration_ == nullptr) {
    server_.send(
      500,
      "application/json",
      "{\"error\":\"The provisioning service is not ready.\",\"hint\":\"Restart the device and reconnect to the recovery network.\"}"
    );
    return;
  }
  if (!server_.hasArg("csrf")) {
    server_.send(
      400,
      "application/json",
      "{\"error\":\"The provisioning form token is missing.\",\"hint\":\"Reload the form and try again.\"}"
    );
    return;
  }
  const String csrf = server_.arg("csrf");
  if (!constantTimeTokenEquals(csrf.c_str(), csrfToken_)) {
    server_.send(403, "application/json", "{\"error\":\"Provisioning form expired.\"}");
    return;
  }
  if (!configuration_->provisioned()) {
    server_.send(
      409,
      "application/json",
      "{\"error\":\"Device enrollment is incomplete.\",\"hint\":\"Enroll device identity and backend trust through the controlled provisioning process before using Wi-Fi recovery.\"}"
    );
    return;
  }

  const String ssid = server_.arg("ssid");
  const String wifiPassword = server_.arg("wifiPassword");
  DeviceConfigurationValidationError validationError =
    DeviceConfigurationValidationError::None;
  if (!wifiSsidIsValid(ssid.c_str(), ssid.length())) {
    validationError = DeviceConfigurationValidationError::WifiSsid;
  } else if (!wifiPasswordIsValid(
    wifiPassword.c_str(),
    wifiPassword.length()
  )) {
    validationError = DeviceConfigurationValidationError::WifiPassword;
  }
  if (validationError != DeviceConfigurationValidationError::None) {
    server_.send(
      400,
      "application/json",
      configurationValidationPayload(validationError)
    );
    return;
  }
  if (!configuration_->updateWifiCredentials(
    ssid.c_str(),
    ssid.length(),
    wifiPassword.c_str(),
    wifiPassword.length()
  )) {
    server_.send(
      500,
      "application/json",
      "{\"error\":\"The validated Wi-Fi credentials could not be stored.\",\"hint\":\"Restart the device and retry. If this continues, inspect the device NVS partition.\"}"
    );
    return;
  }
  configurationUpdated_ = true;
  rotateFormTokens();
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

void RecoveryPortal::rotateFormTokens() {
  std::snprintf(
    csrfToken_,
    sizeof(csrfToken_),
    "%08lx%08lx",
    static_cast<unsigned long>(esp_random()),
    static_cast<unsigned long>(esp_random())
  );
  std::snprintf(
    cspNonce_,
    sizeof(cspNonce_),
    "%08lx%08lx%08lx%08lx",
    static_cast<unsigned long>(esp_random()),
    static_cast<unsigned long>(esp_random()),
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
  DeviceConfiguration &configuration,
  bool allowStationRecovery
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
  rotateFormTokens();
  registerHandlers();
  const wifi_mode_t requestedMode = allowStationRecovery
    ? WIFI_MODE_APSTA
    : WIFI_MODE_AP;
  if (!WiFi.mode(requestedMode) || WiFi.getMode() != requestedMode) {
    configuration_ = nullptr;
    recoveryAccess_ = nullptr;
    csrfToken_[0] = '\0';
    cspNonce_[0] = '\0';
    WiFi.mode(WIFI_OFF);
    return false;
  }
  // Bind the listener to a fixed AP address instead of INADDR_ANY. Handler
  // checks remain as defence in depth, but STA-originated traffic cannot even
  // reach the listening socket while AP+STA recovery is active.
  const IPAddress recoveryAddress(192, 168, 4, 1);
  if (!WiFi.softAPConfig(
    recoveryAddress,
    recoveryAddress,
    IPAddress(255, 255, 255, 0)
  )) {
    configuration_ = nullptr;
    recoveryAccess_ = nullptr;
    csrfToken_[0] = '\0';
    cspNonce_[0] = '\0';
    WiFi.mode(allowStationRecovery ? WIFI_STA : WIFI_OFF);
    return false;
  }
  if (!WiFi.softAP(accessPointSsid_, recoveryAccess.password(), 1, false, 1)) {
    configuration_ = nullptr;
    recoveryAccess_ = nullptr;
    csrfToken_[0] = '\0';
    cspNonce_[0] = '\0';
    WiFi.mode(allowStationRecovery ? WIFI_STA : WIFI_OFF);
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
    WiFi.mode(allowStationRecovery ? WIFI_STA : WIFI_OFF);
    configuration_ = nullptr;
    recoveryAccess_ = nullptr;
    csrfToken_[0] = '\0';
    cspNonce_[0] = '\0';
    return false;
  }
  server_.begin();
  active_ = true;
  return true;
}

void RecoveryPortal::handleClient() {
  if (!active_) return;
  // WebServer accepts a new socket inside handleClient(), so interface checks
  // live in every registered handler where the socket's local address exists.
  server_.handleClient();
}

bool RecoveryPortal::clientIsOnAccessPoint() {
  return recoveryClientUsesAccessPoint(
    static_cast<uint32_t>(server_.client().localIP()),
    static_cast<uint32_t>(WiFi.softAPIP())
  );
}

bool RecoveryPortal::provisionAttemptAllowed() {
  return recordRecoveryAttempt(
    millis(),
    provisionWindowStartedAt_,
    provisionAttempts_
  );
}

void RecoveryPortal::stop() {
  if (!active_) return;
  server_.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  recoveryAccess_ = nullptr;
  configuration_ = nullptr;
  csrfToken_[0] = '\0';
  cspNonce_[0] = '\0';
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
