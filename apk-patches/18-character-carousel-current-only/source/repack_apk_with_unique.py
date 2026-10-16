#!/usr/bin/env python3
"""Replace the game SWF and AIR cache UUID in an approved StarPoint CN APK."""

from __future__ import annotations

import argparse
import hashlib
import shutil
import tempfile
import zipfile
from pathlib import Path


MANIFEST = "AndroidManifest.xml"
TARGET_SWF = "assets/worldflipper_android_release.swf"
OLD_SIGNATURES = {
    "META-INF/MANIFEST.MF",
    "META-INF/WF.SF",
    "META-INF/WF.RSA",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def replace_unique(manifest: bytes, old_unique: str, new_unique: str) -> bytes:
    if len(old_unique) != len(new_unique):
        raise RuntimeError("old and new uniqueappversionid values must have equal length")

    old_utf16 = old_unique.encode("utf-16le")
    new_utf16 = new_unique.encode("utf-16le")
    old_utf8 = old_unique.encode("utf-8")

    if manifest.count(old_utf16) != 1:
        raise RuntimeError(
            "expected exactly one UTF-16LE uniqueappversionid in AndroidManifest.xml, "
            f"found {manifest.count(old_utf16)}"
        )
    if manifest.count(old_utf8) != 0:
        raise RuntimeError("unexpected UTF-8 duplicate of uniqueappversionid")

    patched = manifest.replace(old_utf16, new_utf16, 1)
    if patched.count(old_utf16) != 0 or patched.count(new_utf16) != 1:
        raise RuntimeError("uniqueappversionid replacement verification failed")
    if len(patched) != len(manifest):
        raise RuntimeError("AndroidManifest.xml size changed unexpectedly")
    return patched


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_apk", type=Path)
    parser.add_argument("replacement_swf", type=Path)
    parser.add_argument("output_apk", type=Path)
    parser.add_argument("--expected-base-apk-sha256", required=True)
    parser.add_argument("--expected-base-swf-sha256", required=True)
    parser.add_argument("--old-unique", required=True)
    parser.add_argument("--new-unique", required=True)
    args = parser.parse_args()

    base_apk = args.base_apk.resolve()
    replacement_swf = args.replacement_swf.resolve()
    output_apk = args.output_apk.resolve()
    expected_base_apk_hash = args.expected_base_apk_sha256.upper()
    expected_base_swf_hash = args.expected_base_swf_sha256.upper()

    actual_base_apk_hash = file_sha256(base_apk)
    if actual_base_apk_hash != expected_base_apk_hash:
        raise RuntimeError(
            "LAN APK does not match the approved baseline: "
            f"expected {expected_base_apk_hash}, got {actual_base_apk_hash}"
        )

    replacement = replacement_swf.read_bytes()
    output_apk.parent.mkdir(parents=True, exist_ok=True)
    temporary_dir = Path(tempfile.mkdtemp(prefix="character-carousel-apk-", dir=output_apk.parent))
    temporary_apk = temporary_dir / output_apk.name

    try:
        with zipfile.ZipFile(base_apk, "r") as source:
            names = [item.filename for item in source.infolist()]
            if names.count(MANIFEST) != 1:
                raise RuntimeError(f"expected exactly one {MANIFEST}, found {names.count(MANIFEST)}")
            if names.count(TARGET_SWF) != 1:
                raise RuntimeError(f"expected exactly one {TARGET_SWF}, found {names.count(TARGET_SWF)}")

            original_swf = source.read(TARGET_SWF)
            actual_base_swf_hash = sha256(original_swf)
            if actual_base_swf_hash != expected_base_swf_hash:
                raise RuntimeError(
                    "LAN APK embedded SWF does not match the approved baseline: "
                    f"expected {expected_base_swf_hash}, got {actual_base_swf_hash}"
                )

            removed = {name for name in names if name in OLD_SIGNATURES}
            if removed != OLD_SIGNATURES:
                raise RuntimeError(
                    f"unexpected legacy signature set: expected {sorted(OLD_SIGNATURES)}, "
                    f"got {sorted(removed)}"
                )

            original_manifest = source.read(MANIFEST)
            patched_manifest = replace_unique(
                original_manifest,
                args.old_unique,
                args.new_unique,
            )

            with zipfile.ZipFile(temporary_apk, "w", allowZip64=True) as target:
                target.comment = source.comment
                for item in source.infolist():
                    if item.filename in OLD_SIGNATURES:
                        continue
                    if item.filename == TARGET_SWF:
                        data = replacement
                    elif item.filename == MANIFEST:
                        data = patched_manifest
                    else:
                        data = source.read(item.filename)
                    target.writestr(item, data)

        with zipfile.ZipFile(temporary_apk, "r") as result:
            result_names = [item.filename for item in result.infolist()]
            if len(result_names) != len(names) - len(OLD_SIGNATURES):
                raise RuntimeError("repacked APK entry count is inconsistent")
            if any(name in result_names for name in OLD_SIGNATURES):
                raise RuntimeError("legacy signature entry remained in repacked APK")
            if sha256(result.read(TARGET_SWF)) != sha256(replacement):
                raise RuntimeError("repacked APK SWF payload does not match replacement")
            verified_manifest = result.read(MANIFEST)
            if verified_manifest.count(args.new_unique.encode("utf-16le")) != 1:
                raise RuntimeError("repacked APK does not contain the new uniqueappversionid")

        shutil.move(temporary_apk, output_apk)
    finally:
        shutil.rmtree(temporary_dir, ignore_errors=True)

    print(f"base_apk_sha256={expected_base_apk_hash}")
    print(f"base_swf_sha256={expected_base_swf_hash}")
    print(f"replacement_swf_sha256={sha256(replacement)}")
    print(f"old_unique={args.old_unique}")
    print(f"new_unique={args.new_unique}")
    print(f"output={output_apk}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
