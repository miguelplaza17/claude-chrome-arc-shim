#!/usr/bin/env python3
"""Download a Chrome Web Store extension, verify it and unpack it.

    fetch_crx.py EXTENSION_ID OUT_DIR

Fetches the CRX from Google's update service (the one Chrome itself uses),
checks that the developer key inside it hashes to EXTENSION_ID, verifies the
developer's RSA signature over the archive with openssl, and extracts it to
OUT_DIR/<version>/. The manifest gets a "key" field derived from that same
public key, so the unpacked copy keeps the extension's ID. Prints the version.
"""

import base64
import hashlib
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

UPDATE_URL = (
    "https://clients2.google.com/service/update2/crx?response=redirect"
    "&prodversion=140.0.0.0&acceptformat=crx3"
    "&x=id%3D{id}%26installsource%3Dondemand%26uc"
)


def fail(msg):
    sys.exit(f"fetch_crx: {msg}")


def read_varint(buf, pos):
    result = shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7


def proto_fields(buf):
    """Yield (field_number, bytes) for the length-delimited fields of a message."""
    pos = 0
    while pos < len(buf):
        key, pos = read_varint(buf, pos)
        field, wire = key >> 3, key & 7
        if wire == 2:
            size, pos = read_varint(buf, pos)
            yield field, buf[pos : pos + size]
            pos += size
        elif wire == 0:
            _, pos = read_varint(buf, pos)
        else:
            fail(f"unexpected protobuf wire type {wire}")


def crx_id(raw16):
    return "".join("abcdefghijklmnop"[int(c, 16)] for c in raw16.hex())


def parse_crx3(data):
    if data[:4] != b"Cr24":
        fail("not a CRX file")
    version, header_size = struct.unpack("<II", data[4:12])
    if version != 3:
        fail(f"unsupported CRX version {version}")
    header = data[12 : 12 + header_size]
    archive = data[12 + header_size :]
    proofs, signed_data = [], None
    for field, value in proto_fields(header):
        if field == 2:  # sha256_with_rsa
            proof = dict(proto_fields(value))
            proofs.append((proof.get(1), proof.get(2)))
        elif field == 10000:
            signed_data = value
    if signed_data is None:
        fail("CRX has no signed header data")
    return proofs, signed_data, archive


def verify(pubkey_der, signature, signed_data, archive):
    message = b"CRX3 SignedData\x00" + struct.pack("<I", len(signed_data)) + signed_data + archive
    with tempfile.TemporaryDirectory() as tmp:
        paths = {name: os.path.join(tmp, name) for name in ("key.der", "key.pem", "sig", "msg")}
        for name, content in (("key.der", pubkey_der), ("sig", signature), ("msg", message)):
            with open(paths[name], "wb") as f:
                f.write(content)
        subprocess.run(
            ["openssl", "pkey", "-pubin", "-inform", "DER", "-in", paths["key.der"], "-out", paths["key.pem"]],
            check=True,
            capture_output=True,
        )
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-verify", paths["key.pem"], "-signature", paths["sig"], paths["msg"]],
            capture_output=True,
        )
        return result.returncode == 0


def main():
    if len(sys.argv) != 3:
        fail(__doc__)
    ext_id, out_dir = sys.argv[1], sys.argv[2]

    with urllib.request.urlopen(UPDATE_URL.format(id=ext_id), timeout=60) as resp:
        data = resp.read()
    proofs, signed_data, archive = parse_crx3(data)

    declared = dict(proto_fields(signed_data)).get(1)
    if declared is None or crx_id(declared) != ext_id:
        fail("CRX was signed for a different extension ID")
    developer = [(k, s) for k, s in proofs if k and crx_id(hashlib.sha256(k).digest()[:16]) == ext_id]
    if not developer:
        fail("no developer key matching the extension ID")
    pubkey, signature = developer[0]
    if not verify(pubkey, signature, signed_data, archive):
        fail("developer signature does not verify")

    with zipfile.ZipFile(io.BytesIO(archive)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        version = manifest["version"]
        dest = os.path.join(out_dir, version)
        if os.path.exists(dest):
            fail(f"{dest} already exists")
        for name in zf.namelist():
            target = os.path.realpath(os.path.join(dest, name))
            if not target.startswith(os.path.realpath(dest) + os.sep):
                fail(f"unsafe path in archive: {name}")
        zf.extractall(dest)

    manifest["key"] = base64.b64encode(pubkey).decode()
    with open(os.path.join(dest, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(version)


if __name__ == "__main__":
    main()
