#!/usr/bin/env python3
"""Append one int slot to the V8/V9 BallImpl without recompiling any method."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
from pathlib import Path
import struct
import zlib

from patch import PatchError, V9_SWF_SHA256

# V13 起链首改从 V8 开始（V9 的整类 AS3 回编被 ReferenceError #1069 判死），
# 所以这两个基线都接受。两者的 BallImpl 逐字节相同：
# `kyubi-pf-combo/pcode.py` 锁的 BALL_BLOCK_SHA256
# (0701345d6f668a57f0af9bc10f8801ef32ea5ca89d4a0a8b78a8bd53284ce7fb)
# 在两个基线的 FFDec 导出上都命中 —— 这是「V9 没碰过 BallImpl」的机器证明，
# 不是假设。追加 slot 的逻辑本身与基线无关（按名字定位 BallImpl 与
# suppressSkillFrame，再往 trait 表末尾追加一个自动分配 id 的 int）。
V8_SWF_SHA256 = "c1c0782bed5bbcaaf097855c041e3b05100a46387d7cccc2ef9372d7b57744ed"
ACCEPTED_BASE_SWF_SHA256 = (V9_SWF_SHA256, V8_SWF_SHA256)

HERE = Path(__file__).resolve().parent
ABC_DIR = HERE.parent / "rank-button-p1/abc"
SLOT_NAME = "kyubiPowerFlipInitialCombo"
CLASS_NAME = "pinball.scene.battle.battle.squad.ball::BallImpl"


def _load(name):
    spec = importlib.util.spec_from_file_location("kyubi_slot_" + name, ABC_DIR / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def add_slot(abc_bytes: bytes):
    fmt = _load("abcfmt")
    abc = fmt.ABC(abc_bytes)
    if abc.serialize() != abc_bytes:
        raise PatchError("ABC parser roundtrip is not byte-exact")
    instance, = [row for row in abc.instances if abc.mn_name(row[0]) == CLASS_NAME]
    traits = instance[-1]
    if any(abc.mn_name(t.name) == SLOT_NAME for t in traits):
        raise PatchError("BallImpl snapshot slot is already present")
    original, = [t for t in traits if abc.mn_name(t.name) == "suppressSkillFrame"]
    if original.kind != 0 or abc.mn_name(original.data[2]) != "int":
        raise PatchError("unexpected BallImpl public int field baseline")
    namespace = abc.multinames[original.name][1]
    string_index = len(abc.strings)
    abc.strings.append(SLOT_NAME.encode())
    multiname_index = len(abc.multinames)
    abc.multinames.append((fmt.MN_QName, namespace, string_index))
    added = fmt.Trait()
    added.name, added.kind, added.attr = multiname_index, 0, 0
    # int's native default is zero; appending an auto-assigned slot leaves all
    # existing slot order and constructor/method bytecode unchanged.
    added.data, added.metadata = ["slot", 0, original.data[2], 0, None], []
    traits.append(added)
    result = abc.serialize()
    roundtrip = fmt.ABC(result)
    changed, = [row for row in roundtrip.instances if roundtrip.mn_name(row[0]) == CLASS_NAME]
    changed[-1].pop()
    roundtrip.strings.pop()
    roundtrip.multinames.pop()
    if roundtrip.serialize() != abc_bytes:
        raise PatchError("slot append changed unrelated ABC structures")
    return result


def apply(source: Path, output: Path):
    if source.resolve() == output.resolve():
        raise PatchError("the base SWF must remain immutable")
    actual = hashlib.sha256(source.read_bytes()).hexdigest()
    if actual not in ACCEPTED_BASE_SWF_SHA256:
        raise PatchError("only the approved V8/V9 base SWFs are accepted, got %s"
                         % actual)
    swf = _load("swftags")
    signature, version, _, body = swf.load_swf(str(source))
    found = []
    for code, offset, header, length in swf.iter_tags(body):
        content = body[offset + header:offset + header + length]
        if code == 82 and len(content) > 1000000:
            nul = content.index(b"\0", 4)
            if content[4:nul] == b"boot_ffc6":
                found.append((offset, header + length, content[:nul + 1], content[nul + 1:]))
    offset, old_length, prefix, abc = found[0] if len(found) == 1 else (None,) * 4
    if offset is None:
        raise PatchError("expected exactly one boot_ffc6 ABC")
    content = prefix + add_slot(abc)
    tag = struct.pack("<HI", (82 << 6) | 63, len(content)) + content
    body = body[:offset] + tag + body[offset + old_length:]
    payload = zlib.compress(body) if signature == b"CWS" else body
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(signature + bytes([version]) + struct.pack("<I", len(body) + 8) + payload)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    apply(args.source, args.output)
