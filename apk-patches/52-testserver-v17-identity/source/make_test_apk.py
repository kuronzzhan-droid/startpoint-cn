"""Build the side-by-side test-server APK from v17.

Equal-length rewrites only: admission build id + key in the SWF ABC string pools,
package name in manifest/arsc, app label in arsc, new AIR UUID. Secrets never printed.
usage: python make_test_apk.py <in.apk> <out-unsigned.apk> <secrets-dir>
"""
import json, os, re, secrets, struct, sys, uuid, zipfile, zlib

SWF = "assets/worldflipper_android_release.swf"
MAN = "AndroidManifest.xml"
ARSC = "resources.arsc"
SIG = re.compile(r"^META-INF/.*\.(SF|RSA|DSA|EC|MF)$")
OLD_ID = b"android-181-author-1047-public-20261001"
NEW_ID = b"android-181-testserver-wt-v17b-20261007"
OLD_PKG, NEW_PKG = "com.leiting.wf", "com.leiting.wt"
OLD_LABEL, NEW_LABEL = "世界弹射物语", "世界弹射测试"
HEX64 = re.compile(rb"^[0-9a-f]{64}$")
KEY_POOL_INDEX = 6
assert len(OLD_ID) == len(NEW_ID)


def u30(b, p):
    r = s = 0
    while True:
        x = b[p]; p += 1
        r |= (x & 0x7F) << s; s += 7
        if not x & 0x80 or s >= 35:
            return r, p


def abc_strings(abc):
    """Return (list of (start,end) byte spans of string pool entries)."""
    p = 4
    n, p = u30(abc, p)
    for _ in range(max(n - 1, 0)): _, p = u30(abc, p)
    n, p = u30(abc, p)
    for _ in range(max(n - 1, 0)): _, p = u30(abc, p)
    n, p = u30(abc, p)
    p += 8 * max(n - 1, 0)
    n, q = u30(abc, p)
    spans = []
    for _ in range(max(n - 1, 0)):
        ln, q = u30(abc, q)
        spans.append((q, q + ln)); q += ln
    return spans


def swf_tags(body):
    nbits = body[0] >> 3
    p = (5 + 4 * nbits + 7) // 8 + 4
    while p < len(body):
        h = int.from_bytes(body[p:p + 2], "little"); code, ln = h >> 6, h & 0x3F; hp = p + 2
        if ln == 0x3F: ln = int.from_bytes(body[hp:hp + 4], "little"); hp += 4
        yield code, hp, ln
        p = hp + ln
        if code == 0: break


def patch_swf(data, new_key):
    assert data[:3] == b"CWS"
    body = bytearray(zlib.decompress(data[8:]))
    id_hits = 0; key_spans = []
    for code, hp, ln in swf_tags(bytes(body)):
        if code not in (72, 82): continue
        pre = body.index(b"\0", hp + 4) + 1 - hp if code == 82 else 0
        base = hp + pre
        spans = abc_strings(bytes(body[base:hp + ln]))
        strs = [bytes(body[base + a:base + b]) for a, b in spans]
        id_idx = [i for i, s in enumerate(strs) if OLD_ID in s]
        for i in id_idx:
            a, b = spans[i]
            body[base + a:base + b] = strs[i].replace(OLD_ID, NEW_ID); id_hits += strs[i].count(OLD_ID)
        if id_idx:
            # the admission KEY constant is a 64-hex string compiled into the same ABC as the ID
            # BuildConfig.KEY = ABC string pool index 6 (located by locate_key.py with the repo parser)
            i = KEY_POOL_INDEX - 1
            if i < len(strs) and HEX64.match(strs[i]):
                key_spans.append((base + spans[i][0], base + spans[i][1], 0))
    print("id occurrences replaced:", id_hits)
    print("hex64 constants in ID's ABC:", len(key_spans), "index distances:", [k[2] for k in key_spans])
    assert id_hits >= 2, "build id not found as expected"
    assert len(key_spans) == 1, "admission key not uniquely identified"
    a, b, _ = key_spans[0]
    old_key = bytes(body[a:b])
    # the key is also compile-folded into other ABC blocks (e.g. the HMAC call site): replace every copy
    n = body.count(old_key)
    body = bytearray(bytes(body).replace(old_key, new_key.encode()))
    print("admission key copies replaced:", n)
    return b"CWS" + data[3:4] + (8 + len(body)).to_bytes(4, "little") + zlib.compress(bytes(body), 9)


def patch_manifest(man):
    man = bytearray(man)
    o16, n16 = OLD_PKG.encode("utf-16le"), NEW_PKG.encode("utf-16le")
    cls = ("air." + OLD_PKG + ".AppEntry").encode("utf-16le")
    cls_at = man.find(cls)
    n = 0; p = 0
    while True:
        p = man.find(o16, p)
        if p < 0: break
        if not (cls_at >= 0 and cls_at <= p < cls_at + len(cls)):
            man[p:p + len(o16)] = n16; n += 1
        p += len(o16)
    print("manifest package refs renamed:", n)
    assert n == 5, n
    s = man.decode("utf-16le", "ignore")
    old = re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", s)
    assert len(old) == 1
    nu = str(uuid.uuid4())
    man = bytes(man).replace(old[0].encode("utf-16le"), nu.encode("utf-16le"))
    print("air uuid ->", nu)
    return man


def patch_arsc(a):
    o, n = OLD_PKG.encode("utf-16le"), NEW_PKG.encode("utf-16le")
    assert a.count(o) == 1; a = a.replace(o, n)
    ol, nl = OLD_LABEL.encode(), NEW_LABEL.encode()
    assert len(ol) == len(nl) and a.count(ol) == 1
    a = a.replace(ol, nl)
    print("arsc package + label renamed")
    return a


def main():
    src, dst, secdir = sys.argv[1:4]
    keyfile = os.path.join(secdir, "client-admission.keys.json")
    # reuse the key already registered on the server, so only the APK changes
    key = next(iter(json.load(open(keyfile, encoding="utf-8")).values())) if os.path.exists(keyfile) else secrets.token_hex(32)
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", allowZip64=True) as zout:
        swf = patch_swf(zin.read(SWF), key)
        man = patch_manifest(zin.read(MAN))
        arsc = patch_arsc(zin.read(ARSC))
        zout.comment = zin.comment
        for i in zin.infolist():
            if SIG.match(i.filename): continue
            d = {SWF: swf, MAN: man, ARSC: arsc}.get(i.filename)
            zout.writestr(i, d if d is not None else zin.read(i.filename))
    os.makedirs(secdir, exist_ok=True)
    with open(os.path.join(secdir, "client-admission.keys.json"), "w", encoding="utf-8") as f:
        json.dump({NEW_ID.decode(): key}, f)
    cfg = {"enforce": True,
           "updateMessage": "测试服只允许测试服专用安装包登录，请向作者获取最新测试包。",
           "builds": [{"id": NEW_ID.decode(), "name": "测试服 v17 独立包 com.leiting.wt", "platform": "android",
                       "enabled": True, "allowUntil": None}]}
    with open(os.path.join(secdir, "client-admission.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print("admission config + key written to", secdir, "(key not shown)")


main()
