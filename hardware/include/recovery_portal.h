#pragma once

#include <Preferences.h>
#include <WebServer.h>
#include <cstddef>
#include <cstdint>

namespace eki {
namespace connectivity {

class StationCredentials {
public:
  bool load(const char *fallbackSsid, const char *fallbackPassword);
  bool save(const char *ssid, size_t ssidLength, const char *password, size_t passwordLength);

  const char *ssid() const { return ssid_; }
  const char *password() const { return password_; }
  bool loadedFromNvs() const { return loadedFromNvs_; }

private:
  bool copyFrom(
    const char *ssid,
    size_t ssidLength,
    const char *password,
    size_t passwordLength
  );

  char ssid_[33]{};
  char password_[64]{};
  bool loadedFromNvs_ = false;
};

class RecoveryPortal {
public:
  RecoveryPortal();

  bool start(
    const char *deviceId,
    const char *recoveryPassword,
    StationCredentials &credentials
  );
  void handleClient();
  void stop();
  bool active() const { return active_; }
  bool consumeCredentialsUpdated();
  const char *accessPointSsid() const { return accessPointSsid_; }

private:
  void registerHandlers();
  void setSecurityHeaders();
  void handleRoot();
  void handleStatus();
  void handleWifiUpdate();
  void rotateCsrfToken();

  WebServer server_;
  StationCredentials *credentials_ = nullptr;
  char accessPointSsid_[33]{};
  char csrfToken_[17]{};
  bool handlersRegistered_ = false;
  bool active_ = false;
  bool credentialsUpdated_ = false;
};

} // namespace connectivity
} // namespace eki
