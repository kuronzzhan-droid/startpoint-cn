"""Shared read-only helpers for perf-v30: load SWF/ABC, label bodies, list P-code."""
from __future__ import annotations

import hashlib
import sys
import zipfile
import zlib
from pathlib import Path

sys.dont_write_bytecode = True
TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

import asm  # noqa: E402
import bodies  # noqa: E402
from swfabc import abcfmt, swftags  # noqa: E402

ROOT = TOOLS.parent
BASE_APK = Path(r"C:\Users\12101\Downloads\世界弹射测试服-v29-coop.apk")
BASE_APK_SHA = "be91bc50a5208b27abeb3412a30264dd429c0f505cc1465e22d0cd5fcaeebeb5"
BASE_SWF_SHA = "9deedc1c038681b858f81bbc965dea07ff16e72808146f1fca56b4b04de3f11e"
ORIGINAL_SWF = Path(r"D:\WF\decompile-complete-20261014\apk\worldflipper_android_release.swf")
SWF_MEMBER = "assets/worldflipper_android_release.swf"
MAIN = b"boot_ffc6"
ABC = abcfmt.ABC


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def read_base_swf() -> bytes:
    with zipfile.ZipFile(BASE_APK) as archive:
        swf = archive.read(SWF_MEMBER)
    assert sha(swf) == BASE_SWF_SHA, "v29-coop SWF hash differs"
    return swf


def swf_data(swf: bytes) -> bytes:
    return zlib.decompress(swf[8:]) if swf[:3] == b"CWS" else swf[8:]


def abc_tags(swf: bytes):
    """[(name, offset, size, prefix, raw)] for every DoABC2 tag."""
    data = swf_data(swf)
    out = []
    for kind, offset, header, length in swftags.iter_tags(data):
        if kind != 82:
            continue
        tag = data[offset + header:offset + header + length]
        nul = tag.index(b"\0", 4)
        out.append((tag[4:nul], offset, header + length, tag[:nul + 1], tag[nul + 1:]))
    return out


def main_abc(swf: bytes):
    found = [t for t in abc_tags(swf) if t[0] == MAIN]
    assert len(found) == 1
    abc = ABC(found[0][4])
    return abc, found[0]


def describe(abc, ins) -> str:
    args = list(ins.args)
    name = ins.name
    if name in {"getlex", "findproperty", "findpropstrict", "getproperty", "setproperty", "initproperty",
                "coerce", "astype", "callproperty", "callpropvoid", "constructprop", "callproplex",
                "callsuper", "callsupervoid", "getsuper", "setsuper", "deleteproperty", "istype"}:
        args[0] = abc.mn_name(args[0])
    elif name == "pushstring":
        args[0] = abc.s(args[0])
    elif name == "pushint":
        args[0] = abc.ints[args[0]]
    elif name == "pushuint":
        args[0] = abc.uints[args[0]]
    elif name == "pushdouble":
        args[0] = abc.doubles[args[0]]
    suffix = f" -> #{ins.target}" if ins.target is not None else ""
    if ins.cases is not None:
        suffix += f" default #{ins.default}, cases {ins.cases}"
    return f"{name} {args}{suffix}"


def listing(abc, code: bytes):
    lines, offset = [], 0
    for i, ins in enumerate(asm.decode(code)):
        lines.append(f"#{i:04d} ofs{offset:04x}: {describe(abc, ins)}")
        offset += ins.size()
    return lines


def freeze(value):
    if isinstance(value, (list, tuple)):
        return tuple(freeze(item) for item in value)
    if hasattr(value, "__slots__"):
        return tuple((name, freeze(getattr(value, name))) for name in value.__slots__)
    return value
