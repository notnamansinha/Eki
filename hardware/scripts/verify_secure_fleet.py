Import("env")

from pathlib import Path
import re


project_dir = Path(env.subst("$PROJECT_DIR"))
sdkconfig = (project_dir / "sdkconfig.defaults").read_text(encoding="utf-8")

required_security_options = {
    "CONFIG_ESP32_REV_MIN_3=y",
    "CONFIG_SECURE_BOOT=y",
    "CONFIG_SECURE_BOOT_V2_ENABLED=y",
    "CONFIG_SECURE_BOOT_BUILD_SIGNED_BINARIES=y",
    "CONFIG_SECURE_FLASH_ENC_ENABLED=y",
    "CONFIG_SECURE_FLASH_ENCRYPTION_MODE_RELEASE=y",
    "CONFIG_SECURE_DISABLE_ROM_DL_MODE=y",
    "CONFIG_NVS_ENCRYPTION=y",
    "CONFIG_NVS_SEC_KEY_PROTECT_USING_FLASH_ENC=y",
}

missing_options = sorted(required_security_options.difference(sdkconfig.splitlines()))
if missing_options:
    raise RuntimeError(
        "Fleet build security options are missing from sdkconfig.defaults: "
        + ", ".join(missing_options)
    )

if (project_dir / "include" / "secrets.h").exists():
    raise RuntimeError(
        "Compile-time secrets are forbidden; provision device credentials into encrypted NVS."
    )

credential_name = r"(?:SECRET|PASSWORD|TOKEN|API_KEY|WIFI_SSID)"
credential_definitions = (
    re.compile(rf"^\s*#\s*define\s+\w*{credential_name}\w*", re.IGNORECASE | re.MULTILINE),
    re.compile(rf"(?:^|\s)-D\s*\w*{credential_name}\w*(?:\s*=|=|\s|$)", re.IGNORECASE),
    re.compile(rf"^\s*CONFIG_\w*{credential_name}\w*\s*=", re.IGNORECASE | re.MULTILINE),
)
credential_scan_paths = [project_dir / "platformio.ini", *project_dir.glob("sdkconfig*")]
for source_dir in (project_dir / "include", project_dir / "src"):
    for suffix in ("*.h", "*.hpp", "*.c", "*.cpp", "*.ino"):
        credential_scan_paths.extend(source_dir.rglob(suffix))

for path in credential_scan_paths:
    contents = path.read_text(encoding="utf-8")
    if any(pattern.search(contents) for pattern in credential_definitions):
        raise RuntimeError(
            f"Compile-time credential definition is forbidden in {path.relative_to(project_dir)}."
        )

provisioning_source = (project_dir / "src" / "recovery_portal.cpp").read_text(
    encoding="utf-8"
)
required_nvs_markers = (
    "Preferences preferences;",
    "preferences.putBytes(CONFIG_KEY, &candidate_, sizeof(candidate_))",
)
if not all(marker in provisioning_source for marker in required_nvs_markers):
    raise RuntimeError("Fleet device configuration must be persisted through NVS.")
