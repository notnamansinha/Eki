"""Real checkpoint crypto, TLS wrapper and TinyGPS++ parsing, without board I/O.

Run `pio test -e native` first to install the pinned TinyGPSPlus dependency.
Mbed TLS 2.28.7 matches the upstream version in the pinned Arduino SDK;
this portable build does not certify ESP-specific accelerators or entropy.
"""
import hashlib
import os
import shutil
import subprocess
import urllib.request
import zipfile
from pathlib import Path

HARDWARE = Path(__file__).resolve().parents[1]
BUILD = HARDWARE / ".pio" / "host-protocols"
ARCHIVE_URL = "https://codeload.github.com/Mbed-TLS/mbedtls/zip/refs/tags/v2.28.7"
ARCHIVE_SHA256 = "527ff2472f6c51436808242f4b626500555145a472ca0a2f30a3e68d52d9806e"


def run(args):
    subprocess.run([str(arg) for arg in args], cwd=BUILD, check=True, timeout=120)


def main():
    cc, cxx = shutil.which("gcc"), shutil.which("g++")
    if not cc or not cxx:
        raise SystemExit("Host protocol tests require gcc and g++ on PATH")
    BUILD.mkdir(parents=True, exist_ok=True)
    archive = BUILD / "mbedtls-v2.28.7.zip"
    if not archive.exists():
        with urllib.request.urlopen(ARCHIVE_URL, timeout=60) as response:
            data = response.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            raise SystemExit("Mbed TLS archive exceeds download bound")
        if hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
            raise SystemExit("Mbed TLS source checksum mismatch")
        archive.write_bytes(data)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise SystemExit("Cached Mbed TLS source checksum mismatch")
    # Extract only source/header members, with a fixed root and safe paths.
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            parts = Path(member.filename).parts
            if len(parts) < 3 or parts[0] != "mbedtls-2.28.7" or parts[1] not in ("include", "library"):
                continue
            if ".." in parts or Path(member.filename).is_absolute():
                raise SystemExit("Unsafe source archive path")
            target = BUILD.joinpath(*parts)
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read(member))
    source = BUILD / "mbedtls-2.28.7"
    adapters = HARDWARE / "test-support" / "crypto"
    flags = ["-O1", "-Wall", "-Wextra", '-DMBEDTLS_CONFIG_FILE="mbedtls_config.h"',
             "-I" + str(adapters), "-I" + str(source / "include")]
    objects = []
    for name in ("aes", "cipher", "cipher_wrap", "gcm", "md", "sha256", "platform_util", "constant_time"):
        obj = BUILD / (name + ".o")
        run([cc, "-std=c99", *flags, "-c", source / "library" / (name + ".c"), "-o", obj])
        objects.append(obj)
    crypto = BUILD / "checkpoint-crypto.exe"
    run([cxx, "-std=c++11", *flags, "-I" + str(HARDWARE / "include"),
         adapters / "checkpoint_crypto.cpp", *objects, "-o", crypto])
    run([crypto])

    tinygps = HARDWARE / ".pio" / "libdeps" / "native" / "TinyGPSPlus" / "src"
    if not (tinygps / "TinyGPS++.cpp").is_file():
        raise SystemExit("Run PlatformIO native tests first to install pinned TinyGPSPlus 1.1.0")
    nmea = HARDWARE / "test-support" / "nmea"
    parser = BUILD / "nmea-parser.exe"
    run([cxx, "-std=c++11", "-O1", "-Wall", "-Wextra", "-DARDUINO=100",
         "-I" + str(nmea), "-I" + str(tinygps), "-I" + str(HARDWARE / "include"),
         nmea / "nmea_parser.cpp", tinygps / "TinyGPS++.cpp", "-o", parser])
    run([parser])

    # Compile the upstream portable default library for the production TLS
    # wrapper. No replacement cipher, SSL configuration or ECDH functions.
    tls_objects = []
    tls_flags = ["-DMBEDTLS_PLATFORM_GMTIME_R_ALT"] if os.name == "nt" else []
    for implementation in sorted((source / "library").glob("*.c")):
        if implementation.stem == "net_sockets":
            continue  # No OS socket adapter is used by these wrapper tests.
        obj = BUILD / ("tls-" + implementation.stem + ".o")
        run([cc, "-std=c99", "-O1", *tls_flags, "-I" + str(source / "include"),
             "-c", implementation, "-o", obj])
        tls_objects.append(obj)
    tls = HARDWARE / "test-support" / "tls"
    profile = BUILD / "tls-profile.exe"
    system_libraries = ["-ladvapi32"] if os.name == "nt" else []
    run([cxx, "-std=c++11", "-O1", "-Wall", "-Wextra", "-DARDUINO_ARCH_ESP32", *tls_flags,
         "-I" + str(tls), "-I" + str(source / "include"),
         tls / "tls_profile.cpp", HARDWARE / "src" / "tls_profile.cpp",
         *tls_objects, *system_libraries, "-o", profile])
    run([profile])


if __name__ == "__main__":
    main()
