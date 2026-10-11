"""Verify real Secure Boot V2 signatures without a device or fuse writes.

CI supplies its compiled fleet artifact and ephemeral signing key. --fixture
generates disposable host-only data/key material for a local harness check.
Neither path provisions a board or produces an approved release signing key.
"""
import argparse
import contextlib
import io
import site
import struct
import sys
import tempfile
import zlib
from pathlib import Path
from types import SimpleNamespace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--esptool-dir", required=True, type=Path)
    parser.add_argument("--image", type=Path)
    parser.add_argument("--key", type=Path)
    parser.add_argument("--fixture", action="store_true")
    args = parser.parse_args()
    if not args.fixture and (args.image is None or args.key is None):
        parser.error("provide --image and --key, or --fixture")
    sys.path.insert(0, str(args.esptool_dir.resolve()))
    # PlatformIO installs this pinned tool's dependencies alongside its source.
    site.addsitedir(str(args.esptool_dir.resolve() / "_contrib"))
    import espsecure
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    def write_key(path):
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        path.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                         serialization.PrivateFormat.TraditionalOpenSSL,
                         serialization.NoEncryption()))

    with tempfile.TemporaryDirectory(prefix="eki-signed-image-test-") as directory:
        tmp = Path(directory)
        image, key = args.image, args.key
        if args.fixture:
            key = tmp / "fixture-key.pem"
            write_key(key)
            unsigned = tmp / "fixture.bin"
            unsigned.write_bytes(bytes(range(256)) * 32)
            image = tmp / "fixture-signed.bin"
            with unsigned.open("rb") as payload, key.open("rb") as signing_key:
                espsecure.sign_data(SimpleNamespace(version="2", keyfile=[signing_key],
                    datafile=payload, output=str(image), append_signatures=False,
                    hsm=False, hsm_config=None, signature=None, pub_key=None))
        data = image.read_bytes()

        def verifies(payload, key_path):
            with key_path.open("rb") as public_key, contextlib.redirect_stdout(io.StringIO()):
                try:
                    espsecure.verify_signature(SimpleNamespace(version="2", keyfile=public_key,
                        datafile=io.BytesIO(payload), hsm=False, hsm_config=None))
                except espsecure.esptool.FatalError:
                    return False
            return True

        if not verifies(data, key):
            raise AssertionError("original fleet artifact failed signature verification")
        if len(data) < 8192 or len(data) % 4096:
            raise AssertionError("signed artifact is not sector-aligned")
        changed_image = bytearray(data)
        changed_image[64] ^= 1
        changed_signature = bytearray(data)
        changed_signature[-4096 + 900] ^= 1
        # Repair the noncryptographic CRC so RSA verification itself must
        # reject the changed signature, rather than stopping at framing.
        block_start = len(data) - 4096
        struct.pack_into("<I", changed_signature, block_start + 1196,
                         zlib.crc32(changed_signature[block_start:block_start + 1196]) & 0xffffffff)
        for label, payload in (("changed application", bytes(changed_image)),
                               ("changed signature", bytes(changed_signature)),
                               ("truncated image", data[:-1]),
                               ("unsigned image", data[:-4096])):
            if verifies(payload, key):
                raise AssertionError(label + " was accepted")
            print("Secure Boot V2: rejected " + label)
        foreign = tmp / "wrong-key.pem"
        write_key(foreign)
        if verifies(data, foreign):
            raise AssertionError("foreign signing key was accepted")
        print("Secure Boot V2: original RSA-3072 artifact passed; foreign key rejected")


if __name__ == "__main__":
    main()
