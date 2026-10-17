"""E3 primary fix (DRAFT, not run): give every ANE an "Android-x64" platform so the x86_64 AIR runtime
can create its ExtensionContext.

Why: the x86_64 libCore identifies its platform as "Android-x64" (the arm64 one as "Android-ARM64");
both libCores carry exactly one "Android-*" string. In the APK every
assets/META-INF/AIR/extensions/<id>/META-INF/ANE/extension.xml lists only Android-ARM/ARM64/x86
(+ iPhone/default), and only META-INF/ANE/Android-ARM64/ is shipped. With no matching platform the
runtime falls back to "default", so ExtensionContext.createExtensionContext() returns null. Then
ScreenAne (pinball.screen) dereferences null inside Top construction, before the uncaught-error
listener and the frame loop exist, and the boot dies silently: black screen.

What it does (assets only; DEX/SWF/libs/arm64 entries untouched, byte-identical):
  1. in each extension.xml, clone the <platform name="Android-ARM64"> element as name="Android-x64"
     (inserted right after it; the arm64 path keeps matching its own element as before);
  2. copy every META-INF/ANE/Android-ARM64/<file> to META-INF/ANE/Android-x64/<file>.
Output is unsigned; zipalign + sign with the existing perf2 tooling (sign_perf2_apk.py) afterwards.

usage: python ane_x64_patch.py IN.apk OUT.unsigned.apk
"""
import re
import sys
import zipfile
from pathlib import Path

EXT_ROOT = "assets/META-INF/AIR/extensions/"
SRC, DST = "Android-ARM64", "Android-x64"
PLATFORM_RE = re.compile(r'([ \t]*)<platform name="Android-ARM64">.*?</platform>[ \t]*\r?\n', re.S)


def signature(name):
    return name.startswith("META-INF/") and "/" not in name[9:] and (
        name.endswith((".SF", ".RSA", ".DSA", ".EC")) or name == "META-INF/MANIFEST.MF")


def patch_xml(text, ane_id):
    if f'<platform name="{DST}">' in text:
        return text, False
    m = PLATFORM_RE.search(text)
    assert m, f"{ane_id}: no Android-ARM64 platform element"
    clone = m.group(0).replace(f'name="{SRC}"', f'name="{DST}"', 1)
    return text[:m.end()] + clone + text[m.end():], True


def main():
    src_apk, out = Path(sys.argv[1]), Path(sys.argv[2])
    assert not out.exists(), "refusing to overwrite"
    added_xml, added_files = [], 0
    with zipfile.ZipFile(src_apk) as src, zipfile.ZipFile(out, "w") as dst:
        names = set(src.namelist())
        for item in src.infolist():
            n = item.filename
            if signature(n):
                continue
            data = src.read(n)
            if n.startswith(EXT_ROOT) and n.endswith("/META-INF/ANE/extension.xml"):
                ane_id = n[len(EXT_ROOT):].split("/", 1)[0]
                text, changed = patch_xml(data.decode("utf-8"), ane_id)
                if changed:
                    data = text.encode("utf-8")
                    added_xml.append(ane_id)
            dst.writestr(item, data)
            marker = f"/META-INF/ANE/{SRC}/"
            if n.startswith(EXT_ROOT) and marker in n and not n.endswith("/"):
                twin = n.replace(marker, f"/META-INF/ANE/{DST}/", 1)
                if twin not in names:
                    info = zipfile.ZipInfo(twin, date_time=item.date_time)
                    info.compress_type = item.compress_type
                    info.external_attr = item.external_attr
                    dst.writestr(info, data)
                    added_files += 1
    print(f"extension.xml patched: {len(added_xml)} -> {sorted(added_xml)}")
    print(f"Android-x64 files added: {added_files}")
    print(out)


if __name__ == "__main__":
    main()
