"""P-a 的本地路径边界、固定基线与指令显示；不访问网络或工作目录外资料。"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor"))

import asm
import bodies
from swfabc import PoolEditor, SwfAbc, abcfmt, swftags

INPUT_LOCKS = {
    "v35k.swf": "4f7b894b11e1f377a91e1d4c9b132bd676f850bc6d49f48268fe9ecb7aaaa46b",
    "v35k3-local-wf.swf": "c52e01b8a536f78a06f48cce07bd3e0f23b3814b9b7f861e02a20755f74cc2c1",
}
TARGET = "HitCountCheck/matchTrial"
BODY_INDEX = 58641
METHOD_INDEX = 63326
CODE_SHA256 = "95fdf82e2498fe85ad392d2b62c36d6f85beceeb977711d96055870067099908"
BODY_SHA256 = "f184398fb4b1b178a19c23640ab6bacd8f3318f164f1f8ae40c620203f77b97e"
HEADER = [2, 9, 1, 2]
POOLS = ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def local_path(value):
    path = Path(value)
    if not path.is_absolute():
        path = ROOT / path
    resolved = path.resolve()
    if not resolved.is_relative_to(ROOT) or resolved == ROOT:
        raise ValueError("路径必须在本工作目录内")
    return resolved


def emit_json(report):
    print(json.dumps(report, ensure_ascii=False, indent=2))


def write_json(path, value):
    local_path(path).write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_locked(path):
    path = local_path(path)
    digest = sha(path.read_bytes())
    assert digest in INPUT_LOCKS.values(), "输入 SHA256 不符合规格，停止"
    swf = SwfAbc(path)
    assert_target_lock(swf)
    return swf


def assert_target_lock(swf):
    """独立可测的目标方法 SHA256/header 双锁；运行前不做任何修改。"""
    index = bodies.resolve(swf.abc, TARGET)
    bodies._CACHE.pop(id(swf.abc), None)
    assert index == BODY_INDEX, "目标方法体索引发生变化"
    body = swf.abc.bodies[index]
    assert body[0] == METHOD_INDEX, "目标 method 索引发生变化"
    assert sha(body[5]) == CODE_SHA256, "目标方法代码 SHA256 不匹配，停止"
    assert body[1:5] == HEADER, "目标方法 header 不匹配，停止"
    assert sha(body_bytes(body)) == BODY_SHA256, "完整方法体 SHA256 不匹配，停止"
    assert not body[6] and not body[7], "目标方法出现异常表或 traits"


def qname(abc, name):
    hits = [i for i, entry in enumerate(abc.multinames)
            if entry[0] == 7 and abc.mn_name(i) == name
            and abc.namespaces[entry[1]][0] in (0x08, 0x16)]
    assert len(hits) == 1, (name, hits)
    return hits[0]


def body_bytes(body):
    writer = abcfmt.W()
    for value in body[:5]:
        writer.u30(value)
    writer.u30(len(body[5]))
    writer.raw(body[5])
    writer.u30(len(body[6]))
    for entry in body[6]:
        for value in entry:
            writer.u30(value)
    writer.u30(len(body[7]))
    for trait in body[7]:
        abcfmt.write_trait(writer, trait)
    return writer.out()


def listing(abc, body):
    """同时列出原始字节、精确操作数索引、解析名称与真实指令地址。"""
    instructions = asm.decode(body[5])
    encoded, offsets = asm.encode(instructions)
    assert encoded == body[5]
    offsets.append(len(encoded))
    lines = [f"方法 {TARGET}；body={BODY_INDEX}；method={body[0]}",
             f"header={body[1:5]}；代码 SHA256={sha(body[5])}"]
    names = set(asm._MULTINAME_OPERAND) | {0x5D, 0x5E}
    for i, ins in enumerate(instructions):
        args = ", ".join(map(str, ins.args))
        if ins.op in names and ins.args:
            args += "  ; " + abc.mn_name(ins.args[0])
        if ins.name == "pushstring":
            args += "  ; " + repr(abc.s(ins.args[0]))
        if ins.target is not None:
            args = f"ofs{offsets[ins.target]:04x}"
        if ins.cases is not None:
            args = "default=ofs%04x cases=[%s]" % (
                offsets[ins.default],
                ", ".join(f"ofs{offsets[x]:04x}" for x in ins.cases))
        raw = encoded[offsets[i]:offsets[i + 1]].hex(" ")
        lines.append(f"ofs{offsets[i]:04x}: {ins.name} {args}".rstrip()
                     + f"  | {raw}")
    return "\n".join(lines) + "\n"
