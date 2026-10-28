# -*- coding: utf-8 -*-
"""1008093 APK 内置包补 M 字：battle/common/layer1 的 png+atlas 在 APK assets/bundle.zip 的 production/android_bundle 里（白名单内置，
CDN 覆盖无效 → 只发 1.4.324 时进战斗 C8004「unit_prefix_m的纹理尚未加载」，栈 AccumulationDamageIndicatorView/createDigit）。
把 1.4.324 的两个成员（与 CDN 同一份存储态字节）写进 bundle.zip，并重算 assets/bundle.zip.sha1。其余成员逐字节、逐压缩方式保留。

用法（签名之前调用）：
  python -B -X utf8 bundle_m_glyph.py --apk-in <未签名或已签名 apk> --out-dir <目录>
    → <目录>/bundle.zip、<目录>/bundle.zip.sha1（直接替换 APK 里的 assets/bundle.zip 与 assets/bundle.zip.sha1，再签名）
  python -B -X utf8 bundle_m_glyph.py --apk-in <apk> --check     只核对 APK 里是否已是新字节
"""
import argparse, hashlib, io, json, sys, zipfile
from pathlib import Path

EDGE = Path(r"<WORKDIR>/outputs/work/balance-1022/patch340/pinball-1.4.339-1.4.340-1-damage-font-units-1027-local.zip")   # 1.4.340：M 青 + B 粉 + T 紫（1008094 起）；1008093 用的是 patch324 的 M
MEMBERS = {  # 内置包路径 ← 字形边成员（324/340 同一对逻辑路径）（salted sha1 路径同名）
    "production/android_bundle/82/328225a589e4b85e0bbdc84e9046a573697f2c": "production/upload/82/328225a589e4b85e0bbdc84e9046a573697f2c",  # battle/common/layer1.png
    "production/android_bundle/19/722166c96272eb26217732327db9130a8c4dc5": "production/upload/19/722166c96272eb26217732327db9130a8c4dc5",  # battle/common/layer1.atlas.amf3.deflate
}
OLD_SHA256 = {  # 1008092 内置的原字节（= store131）
    "production/android_bundle/82/328225a589e4b85e0bbdc84e9046a573697f2c": None,
    "production/android_bundle/19/722166c96272eb26217732327db9130a8c4dc5": None,
}


def new_bytes():
    integ = json.loads(EDGE.with_name(EDGE.stem + ".integrity.json").read_text("utf-8"))
    out = {}
    with zipfile.ZipFile(EDGE) as z:
        for bm, em in MEMBERS.items():
            b = z.read(em)
            assert hashlib.sha256(b).hexdigest() == integ["member_sha256"][em], em
            out[bm] = b
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apk-in", required=True)
    ap.add_argument("--out-dir")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--edge", help="字形边 zip（默认 1.4.340）")
    a = ap.parse_args()
    global EDGE
    if a.edge: EDGE = Path(a.edge)
    nb = new_bytes()
    apk = zipfile.ZipFile(a.apk_in)
    raw = apk.read("assets/bundle.zip")
    assert apk.read("assets/bundle.zip.sha1").decode().strip() == hashlib.sha1(raw).hexdigest()
    src = zipfile.ZipFile(io.BytesIO(raw))
    cur = {m: src.read(m) for m in MEMBERS}
    if a.check:
        ok = all(cur[m] == nb[m] for m in MEMBERS)
        print("bundle has M glyph:", ok); sys.exit(0 if ok else 1)
    if all(cur[m] == nb[m] for m in MEMBERS):
        print("already patched");
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as dst:
        for info in src.infolist():
            data = nb[info.filename] if info.filename in MEMBERS else src.read(info.filename)
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type, zi.external_attr, zi.create_system = info.compress_type, info.external_attr, info.create_system
            dst.writestr(zi, data)
    out = buf.getvalue()
    chk = zipfile.ZipFile(io.BytesIO(out))
    assert chk.namelist() == src.namelist() and chk.testzip() is None
    for info in src.infolist():
        if info.filename not in MEMBERS:
            assert chk.read(info.filename) == src.read(info.filename)
    for m in MEMBERS:
        assert chk.read(m) == nb[m] and chk.getinfo(m).compress_type == src.getinfo(m).compress_type
    od = Path(a.out_dir); od.mkdir(parents=True, exist_ok=True)
    (od / "bundle.zip").write_bytes(out)
    (od / "bundle.zip.sha1").write_bytes(hashlib.sha1(out).hexdigest().encode())
    print("bundle.zip", len(raw), "->", len(out), "sha1", hashlib.sha1(out).hexdigest())


if __name__ == "__main__":
    main()
