"""Exercise the real fleet verifier without signing keys or a connected board."""
from pathlib import Path
import runpy
import tempfile
import unittest


PROJECT = Path(__file__).resolve().parents[1]


class Environment:
    def __init__(self, root):
        self.root = root

    def subst(self, value):
        return {"$PROJECT_DIR": str(self.root), "$PIOENV": "esp32dev-secure"}[value]

    def GetProjectOption(self, name):
        return "-D EKI_FIRMWARE_SEQUENCE=1"


class FleetJtagConfigurationTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        for name in ("sdkconfig.defaults", "partitions_secure.csv", "CMakeLists.txt"):
            (self.root / name).write_bytes((PROJECT / name).read_bytes())
        (self.root / "include").mkdir()
        (self.root / "src").mkdir()
        (self.root / "include/secrets.h").write_bytes((PROJECT / "include/secrets.example.h").read_bytes())
        (self.root / "src/main.cpp").write_text(
            '#include "secrets.h"\nWiFi.persistent(false);\nWiFi.mode(WIFI_STA);\n', encoding="utf-8")

    def verify(self):
        runpy.run_path(str(PROJECT / "scripts/verify_secure_fleet.py"),
                       init_globals={"Import": lambda name: None, "env": Environment(self.root)})

    def test_checked_in_secure_defaults_pass(self):
        self.verify()

    def test_jtag_must_be_explicitly_disabled(self):
        config = self.root / "sdkconfig.defaults"
        config.write_text(config.read_text().replace("# CONFIG_SECURE_BOOT_ALLOW_JTAG is not set", ""))
        with self.assertRaisesRegex(RuntimeError, "CONFIG_SECURE_BOOT_ALLOW_JTAG"):
            self.verify()

    def test_enabled_jtag_is_rejected_even_with_disabled_default(self):
        with (self.root / "sdkconfig.defaults").open("a") as config:
            config.write("\nCONFIG_SECURE_BOOT_ALLOW_JTAG=y\n")
        with self.assertRaisesRegex(RuntimeError, "forbidden options"):
            self.verify()

    def test_effective_config_cannot_reenable_jtag(self):
        source = (self.root / "sdkconfig.defaults").read_text()
        effective = self.root / "sdkconfig.esp32dev-secure"
        for value in ("CONFIG_SECURE_BOOT_ALLOW_JTAG=y", ""):
            with self.subTest(value=value):
                effective.write_text(source.replace("# CONFIG_SECURE_BOOT_ALLOW_JTAG is not set", value))
                with self.assertRaisesRegex(RuntimeError, "CONFIG_SECURE_BOOT_ALLOW_JTAG"):
                    self.verify()

    def test_effective_secure_config_passes(self):
        (self.root / "sdkconfig.esp32dev-secure").write_bytes((self.root / "sdkconfig.defaults").read_bytes())
        self.verify()


if __name__ == "__main__":
    unittest.main()
