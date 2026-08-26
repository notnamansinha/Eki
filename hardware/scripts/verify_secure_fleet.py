Import("env")

from pathlib import Path
import re


project_dir = Path(env.subst("$PROJECT_DIR"))
sdkconfig = (project_dir / "sdkconfig.defaults").read_text(encoding="utf-8")
platform_build_flags = str(env.GetProjectOption("build_flags"))
sequence_match = re.search(r"\bEKI_FIRMWARE_SEQUENCE=(\d+)\b", platform_build_flags)
if not sequence_match or int(sequence_match.group(1)) <= 0:
    raise RuntimeError("Fleet builds require a positive EKI_FIRMWARE_SEQUENCE.")
if "DISABLE_OTA" in platform_build_flags:
    raise RuntimeError("Fleet builds must not disable the signed OTA path.")
release_sequence = int(sequence_match.group(1))
cmake_source = (project_dir / "CMakeLists.txt").read_text(encoding="utf-8")
version_match = re.search(r'set\s*\(\s*PROJECT_VER\s+"([^"]+)"\s*\)', cmake_source)
if not version_match:
    raise RuntimeError("Fleet builds require an explicit signed PROJECT_VER.")
signed_version = version_match.group(1)
if not signed_version.startswith(f"s{release_sequence}-") or len(signed_version) > 31:
    raise RuntimeError(
        "PROJECT_VER must use s<sequence>-<name> and match EKI_FIRMWARE_SEQUENCE."
    )

required_security_options = {
    "CONFIG_ESP32_REV_MIN_3=y",
    "CONFIG_SECURE_BOOT=y",
    "CONFIG_SECURE_BOOT_V2_ENABLED=y",
    "CONFIG_SECURE_BOOT_BUILD_SIGNED_BINARIES=y",
    "CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y",
    "CONFIG_SECURE_FLASH_ENC_ENABLED=y",
    "CONFIG_SECURE_FLASH_ENCRYPTION_MODE_RELEASE=y",
    "CONFIG_SECURE_DISABLE_ROM_DL_MODE=y",
}
disabled_security_options = {"CONFIG_ESP32_WIFI_NVS_ENABLED"}

missing_options = sorted(required_security_options.difference(sdkconfig.splitlines()))
if missing_options:
    raise RuntimeError(
        "Fleet build security options are missing from sdkconfig.defaults: "
        + ", ".join(missing_options)
    )

missing_disabled_options = sorted(
    option
    for option in disabled_security_options
    if f"{option}=n" not in sdkconfig.splitlines()
    and f"# {option} is not set" not in sdkconfig.splitlines()
)
if missing_disabled_options:
    raise RuntimeError(
        "Fleet build options must be disabled in sdkconfig.defaults: "
        + ", ".join(missing_disabled_options)
    )

effective_sdkconfig_path = project_dir / f"sdkconfig.{env.subst('$PIOENV')}"
if effective_sdkconfig_path.exists():
    effective_sdkconfig = effective_sdkconfig_path.read_text(encoding="utf-8")
    missing_effective_options = sorted(
        required_security_options.difference(effective_sdkconfig.splitlines())
    )
    if missing_effective_options:
        raise RuntimeError(
            "Fleet build security options are missing from the effective sdkconfig: "
            + ", ".join(missing_effective_options)
        )
    incorrectly_enabled_options = sorted(
        option
        for option in disabled_security_options
        if f"{option}=y" in effective_sdkconfig.splitlines()
    )
    if incorrectly_enabled_options:
        raise RuntimeError(
            "Fleet build options are unexpectedly enabled in the effective sdkconfig: "
            + ", ".join(incorrectly_enabled_options)
        )
    missing_effective_disabled_options = sorted(
        option
        for option in disabled_security_options
        if f"{option}=n" not in effective_sdkconfig.splitlines()
        and f"# {option} is not set" not in effective_sdkconfig.splitlines()
    )
    if missing_effective_disabled_options:
        raise RuntimeError(
            "Fleet build options must be explicitly disabled in the effective sdkconfig: "
            + ", ".join(missing_effective_disabled_options)
        )

secrets_path = project_dir / "include" / "secrets.h"
if not secrets_path.exists():
    raise RuntimeError(
        "include/secrets.h is required. Copy secrets.example.h, set the "
        "device-specific values, then rebuild."
    )

secret_source = secrets_path.read_text(encoding="utf-8")
required_definitions = {
    "WIFI_SSID",
    "WIFI_PASS",
    "DEVICE_ID",
    "DEVICE_SECRET",
    "BACKEND_URL",
    "BACKEND_ROOT_CA",
}
defined_names = set(
    re.findall(r"^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)", secret_source, re.MULTILINE)
)
missing_definitions = sorted(required_definitions.difference(defined_names))
if missing_definitions:
    raise RuntimeError(
        "include/secrets.h is missing required definitions: "
        + ", ".join(missing_definitions)
    )

for removed_path in (
    project_dir / "include" / "device_config.h",
    project_dir / "include" / "recovery_portal.h",
    project_dir / "src" / "recovery_portal.cpp",
):
    if removed_path.exists():
        raise RuntimeError(f"Removed persistent configuration component returned: {removed_path.name}")

application_paths = [
    *(project_dir / "include").glob("*.h"),
    *(project_dir / "src").glob("*.cpp"),
]
for path in application_paths:
    if path.name in {"secrets.h", "secrets.example.h"}:
        continue
    contents = path.read_text(encoding="utf-8")
    if re.search(r"\bPreferences\b|#\s*include\s*[<\"]nvs|\bnvs_(?:open|set|get|commit)", contents):
        raise RuntimeError(
            f"Application persistent storage is forbidden: {path.relative_to(project_dir)}"
        )

main_source = (project_dir / "src" / "main.cpp").read_text(encoding="utf-8")
if '#include "secrets.h"' not in main_source:
    raise RuntimeError("Firmware must load its only configuration from include/secrets.h.")

persistent_call = main_source.find("WiFi.persistent(false)")
mode_call = main_source.find("WiFi.mode(WIFI_STA)")
if persistent_call < 0 or mode_call < 0 or persistent_call > mode_call:
    raise RuntimeError(
        "Wi-Fi RAM-only storage must be selected before the driver is initialized."
    )

partition_rows = [
    [column.strip() for column in line.split(",")]
    for line in (project_dir / "partitions_secure.csv").read_text(encoding="utf-8").splitlines()
    if line.strip() and not line.lstrip().startswith("#")
]
if any(len(row) >= 3 and row[2] == "nvs_keys" for row in partition_rows):
    raise RuntimeError("The removed encrypted application storage partition must not return.")

# Arduino-ESP32 2.x unconditionally initializes a default system partition at
# startup. Keep the minimal framework partition so Wi-Fi can boot, while the
# configuration and driver state remain compile-time/RAM-only respectively.
if not any(
    len(row) >= 5
    and row[0] == "nvs"
    and row[1] == "data"
    and row[2] == "nvs"
    and int(row[4], 0) <= 0x6000
    for row in partition_rows
):
    raise RuntimeError("The minimal Arduino framework system partition is missing or oversized.")

ota_apps = {
    row[2]: row
    for row in partition_rows
    if len(row) >= 5 and row[1] == "app" and row[2] in {"ota_0", "ota_1"}
}
if set(ota_apps) != {"ota_0", "ota_1"}:
    raise RuntimeError("Fleet builds require exactly two OTA application slots.")
if any(int(row[4], 0) < 0x1E0000 for row in ota_apps.values()):
    raise RuntimeError("Fleet OTA application slots are smaller than the release limit.")
if not any(
    len(row) >= 3 and row[0] == "otadata" and row[1] == "data" and row[2] == "ota"
    for row in partition_rows
):
    raise RuntimeError("Fleet builds require an OTA selection-data partition.")
if any(len(row) >= 3 and row[1] == "app" and row[2] == "factory" for row in partition_rows):
    raise RuntimeError("Fleet builds must boot from rollback-capable OTA slots, not a factory-only app.")

partition_regions = []
for row in partition_rows:
    if len(row) < 5:
        raise RuntimeError(f"Malformed fleet partition row: {row}")
    offset = int(row[3], 0)
    size = int(row[4], 0)
    if size <= 0 or offset < 0x11000 or offset + size > 0x400000:
        raise RuntimeError(f"Fleet partition is outside the 4 MiB flash layout: {row[0]}")
    partition_regions.append((offset, offset + size, row[0]))
partition_regions.sort()
for previous, current in zip(partition_regions, partition_regions[1:]):
    if previous[1] > current[0]:
        raise RuntimeError(
            f"Fleet partitions overlap: {previous[2]} and {current[2]}"
        )
