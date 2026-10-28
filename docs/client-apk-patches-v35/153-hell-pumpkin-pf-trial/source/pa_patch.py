"""只在 case 0 原拒绝块等长替换，并在方法末尾拼接 PF 代号门控。"""
from __future__ import annotations

from pa_common import BODY_INDEX, HEADER, PoolEditor, asm, qname, sha
from pa_integrity import static_check


def build(swf):
    abc = swf.abc
    body = abc.bodies[BODY_INDEX]
    original = list(body)
    old = asm.decode(body[5])
    old_raw, offsets = asm.encode(old)
    assert old_raw == body[5]
    assert len(old) == 109 and offsets[66] == 0xA0 and offsets[72] == 0xAA
    assert offsets[73] == 0xAE and offsets[106] == 0xEF
    assert [(x.name, x.args) for x in old[66:72]] == [
        ("pushnull", []), ("coerce", [32]), ("coerce", [32]),
        ("setlocal", [6]), ("getlocal", [6]), ("returnvalue", [])]
    symbols = {name: qname(abc, name) for name in
               ("owner", "getMasterId", "index", "params", "Object", "indexOf")}
    dynamic_item = old[96].args[0]
    assert abc.multinames[dynamic_item][0] == 0x1B
    pool = PoolEditor(abc)
    prefix = pool.string("mod_hp_")
    assert pool.added_strings == [b"mod_hp_"]
    # owner 的声明类型是接口；coerce_a 允许查询真实对象的 public 方法。
    # 重用局部 7；它已由前置 coerce_a 声明为 *，kind 取出后不再读取旧值。
    # 这使后向 label 的局部变量类型也保持一致，避免改变局部 6 的 Object 类型。
    gate = asm.assemble([
        ("avm_label",),
        ("getlocal_0",), ("getproperty", symbols["owner"]), ("coerce_a",),
        ("callproperty", symbols["getMasterId"], 0), ("coerce_a",),
        ("setlocal", 7),
        ("getlocal", 7), ("getproperty", symbols["index"]), ("pushbyte", 1),
        ("ifeq", "ZAKO"),
        ("getlocal", 7), ("getproperty", symbols["params"]), ("pushbyte", 0),
        ("getproperty", dynamic_item), ("getproperty", symbols["params"]),
        ("pushbyte", 0), ("getproperty", dynamic_item), ("jump", "PREFIX"),
        ("label", "ZAKO"), ("avm_label",),
        ("getlocal", 7), ("getproperty", symbols["params"]), ("pushbyte", 0),
        ("getproperty", dynamic_item),
        ("label", "PREFIX"), ("avm_label",), ("convert_s",),
        ("pushstring", prefix),
        ("callproperty", symbols["indexOf"], 1),
        ("pushbyte", 0), ("ifeq", "ACCEPT"),
        ("pushnull",), ("coerce", symbols["Object"]), ("returnvalue",),
        ("label", "ACCEPT"),
    ])
    # ACCEPT 是外部重定位符号：最终显式绑定到原 case 0 区段内新增的 a9 label。
    _, exceptions, merged = asm.splice(body, len(old), gate)
    fallback = asm.assemble([
        ("getlocal_3",), ("iftrue", "END"), ("pushnull",),
        ("coerce", symbols["Object"]), ("returnvalue",), ("avm_label",),
    ])
    assert len(fallback) == 6 and len(asm.encode(fallback)[0]) == 10
    fallback[1].target = len(old)
    merged[66:72] = fallback
    assert merged[-4].name == "ifeq"
    merged[-4].target = 71
    code, new_offsets = asm.encode(merged)
    assert new_offsets[71] == 0xA9 and new_offsets[109] == len(old_raw)
    assert code[:0xA0] == old_raw[:0xA0], "前置门控、switch 或 p1 路径变化"
    assert code[0xAA:len(old_raw)] == old_raw[0xAA:], "原 case/共享出口字节变化"
    assert not any(x.name == "getlex" for x in merged[109:]), "新增 getlex 被禁止"
    metrics = asm.simulate(merged, body[3], abc.multinames)
    assert metrics == (2, 2, 0), ("栈/作用域或不可达状态异常", metrics)
    assert asm.block_locals(merged) == HEADER[1]
    body[5], body[6] = code, exceptions
    assert body[1:5] == HEADER, "本补丁不应抬高 header"
    check = static_check(abc, body)
    report = {
        "method": "HitCountCheck.matchTrial", "body_index": BODY_INDEX,
        "before_code_sha256": sha(old_raw), "after_code_sha256": sha(code),
        "before_header": original[1:5], "after_header": body[1:5],
        "before_instructions": len(old), "after_instructions": len(merged),
        "before_code_bytes": len(old_raw), "after_code_bytes": len(code),
        "constant_pool_additions": pool.report(), "reused_multinames": symbols,
        "dynamic_array_multiname": dynamic_item,
        "byte_preserved_ranges": ["[0x0000,0x00a0)", "[0x00aa,0x00f6)"],
        "case0_replacement_range": "[0x00a0,0x00aa)",
        "appended_gate_offset": len(old_raw), "accept_label_offset": 0xA9,
        "static": check,
    }
    return original, report
