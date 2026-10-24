"""Make a new test APK from a signed base: replace the main SWF and set android:versionCode.

usage: python swap_swf_bump.py BASE.apk NEW.swf NEW_VERSION_CODE OUT.unsigned.apk
Signature files are dropped (zipalign + sign afterwards). Every other entry is copied byte-for-byte
with its original compression and order.
"""
import hashlib
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from bump_versioncode import patch_axml  # noqa: E402

SWF = "assets/worldflipper_android_release.swf"


def is_sig(n):
    return n.startswith("META-INF/") and "/" not in n[9:] and (
        n.endswith((".SF", ".RSA", ".DSA", ".EC")) or n == "META-INF/MANIFEST.MF")


def main():
    base, swf, code, out = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4])
    assert not out.exists(), "refusing to overwrite"
    new_swf = swf.read_bytes()
    with zipfile.ZipFile(base) as zin, zipfile.ZipFile(out, "w") as zout:
        assert SWF in zin.namelist()
        for item in zin.infolist():
            n = item.filename
            if is_sig(n):
                continue
            data = zin.read(n)
            if n == SWF:
                print("swf", hashlib.sha256(data).hexdigest()[:16], "->", hashlib.sha256(new_swf).hexdigest()[:16])
                data = new_swf
            elif n == "AndroidManifest.xml":
                data, old = patch_axml(data, code)
                print(f"versionCode {old} -> {code}")
            zout.writestr(item, data)
    print(out, hashlib.sha256(out.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
