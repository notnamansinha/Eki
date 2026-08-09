#pragma once

#include "device_config.h"
#include <Preferences.h>
#include <WebServer.h>
#include <cstddef>
#include <cstdint>

namespace eki {
namespace connectivity {

class DeviceConfiguration {
public:
  bool load();
  bool save(
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
  );

  const char *wifiSsid() const { return record_.wifiSsid; }
  const char *wifiPassword() const { return record_.wifiPassword; }
  const char *deviceId() const { return record_.deviceId; }
  const char *deviceSecret() const { return record_.deviceSecret; }
  const char *backendUrl() const { return record_.backendUrl; }
  const char *backendRootCa() const { return record_.backendRootCa; }
  bool provisioned() const { return provisioned_; }

private:
  DeviceConfigurationRecord record_{};
  DeviceConfigurationRecord candidate_{};
  bool provisioned_ = false;
};

class RecoveryAccess {
public:
  bool loadOrCreate();
  const char *password() const { return password_; }

private:
  char password_[25]{};
};

class RecoveryPortal {
public:
  RecoveryPortal();

  bool start(
    const char *deviceLabel,
    const char *recoveryPassword,
    DeviceConfiguration &configuration
  );
  void handleClient();
  void stop();
  bool active() const { return active_; }
  bool consumeConfigurationUpdated();
  const char *accessPointSsid() const { return accessPointSsid_; }

private:
  void registerHandlers();
  void setSecurityHeaders();
  void handleRoot();
  void handleStatus();
  void handleProvisioningUpdate();
  void rotateCsrfToken();

  WebServer server_;
  DeviceConfiguration *configuration_ = nullptr;
  char accessPointSsid_[33]{};
  char csrfToken_[17]{};
  bool handlersRegistered_ = false;
  bool active_ = false;
  bool configurationUpdated_ = false;
};

} // namespace connectivity
} // namespace eki
