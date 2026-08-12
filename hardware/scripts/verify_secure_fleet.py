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
}

missing_options = sorted(required_security_options.difference(sdkconfig.splitlines()))
if missing_options:
    raise RuntimeError(
        "Fleet build security options are missing from sdkconfig.defaults: "
        + ", ".join(missing_options)
    )

effective_sdkconfig_path = project_dir / f"sdkconfig.{env.subst('$PIOENV')}"
if effective_sdkconfig_path.exists():
    effective_sdkconfig = effective_sdkconfig_path.read_text(encoding="utf-8")
    missing_effective_options = sorted(
        required_security_options.difference(effective_sdkconfig.splitlines())
    )
    if missing_effective_options:
        raise RuntimeError(
            "Fleet build security options are disabled in the effective sdkconfig: "
            + ", ".join(missing_effective_options)
        )

partition_rows = [
    [column.strip() for column in line.split(",")]
    for line in (project_dir / "partitions_secure.csv").read_text(encoding="utf-8").splitlines()
    if line.strip() and not line.lstrip().startswith("#")
]
has_nvs_partition = any(
    len(row) >= 3 and row[1] == "data" and row[2] == "nvs"
    for row in partition_rows
)
has_encrypted_nvs_keys = any(
    len(row) >= 6
    and row[1] == "data"
    and row[2] == "nvs_keys"
    and "encrypted" in {flag.strip() for flag in row[5].split(":")}
    for row in partition_rows
)
if not has_nvs_partition or not has_encrypted_nvs_keys:
    raise RuntimeError("Fleet partition table must contain NVS and encrypted NVS keys partitions.")

if (project_dir / "include" / "secrets.h").exists():
    raise RuntimeError(
        "Compile-time secrets are forbidden; provision device credentials into encrypted NVS."
    )

credential_name = r"(?:SECRET|PASSWORD|TOKEN|API_KEY|WIFI_SSID)"
credential_definitions = (
    re.compile(rf"^\s*#\s*define\s+\w*{credential_name}\w*", re.IGNORECASE | re.MULTILINE),
    re.compile(rf"(?:^|\s)-D\s*\w*{credential_name}\w*(?:\s*=|=|\s|$)", re.IGNORECASE),
    re.compile(rf"^\s*CONFIG_\w*{credential_name}\w*\s*=", re.IGNORECASE | re.MULTILINE),
    re.compile(
        rf"^\s*(?:inline\s+)?(?:constexpr|const)\s+[^;=]*\w*{credential_name}\w*[^;=]*=\s*(?:R)?[\"']",
        re.IGNORECASE | re.MULTILINE,
    ),
)
credential_scan_paths = [project_dir / "platformio.ini", *project_dir.glob("sdkconfig*")]
for source_dir in (project_dir / "include", project_dir / "src", project_dir / "lib"):
    for suffix in ("*.h", "*.hh", "*.hpp", "*.c", "*.cc", "*.cpp", "*.cxx", "*.ino"):
        credential_scan_paths.extend(source_dir.rglob(suffix))

for path in credential_scan_paths:
    if any(part == ".pio" for part in path.parts):
        continue
    if any(name in path.stem.lower() for name in ("secret", "credential", "token")):
        raise RuntimeError(
            f"Compile-time credential file is forbidden: {path.relative_to(project_dir)}."
        )

for path in credential_scan_paths:
    if any(part == ".pio" for part in path.parts):
        continue
    contents = path.read_text(encoding="utf-8")
    if any(pattern.search(contents) for pattern in credential_definitions):
        raise RuntimeError(
            f"Compile-time credential definition is forbidden in {path.relative_to(project_dir)}."
        )

provisioning_source = (project_dir / "src" / "recovery_portal.cpp").read_text(
    encoding="utf-8"
)
update_start = provisioning_source.find(
    "bool DeviceConfiguration::updateWifiCredentials("
)
update_end = provisioning_source.find(
    "bool RecoveryAccess::loadOrCreate()", update_start
)
update_source = provisioning_source[update_start:update_end]
persists_configuration = re.search(
    r"preferences\.putBytes\s*\(\s*CONFIG_KEY\s*,\s*&?candidate_\s*,\s*sizeof\s*\(\s*candidate_\s*\)\s*\)",
    update_source,
)
if (
    update_start < 0
    or update_end < 0
    or "makeWifiUpdatedDeviceConfigurationRecord(" not in update_source
    or "Preferences preferences;" not in update_source
    or not persists_configuration
):
    raise RuntimeError("Fleet device configuration must be persisted through NVS.")

for protected_field in ("deviceId", "deviceSecret", "backendUrl", "backendRootCa"):
    if f'name="{protected_field}"' in provisioning_source:
        raise RuntimeError(
            f"Recovery portal must not render the protected {protected_field} field."
        )
    if f'server_.arg("{protected_field}")' in provisioning_source:
        raise RuntimeError(
            f"Recovery portal must not accept the protected {protected_field} field."
        )
