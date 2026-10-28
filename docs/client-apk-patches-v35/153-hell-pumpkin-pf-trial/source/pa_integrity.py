"""逐方法体、逐标签、常量池前缀与全 ABC 归一还原证明。"""
from __future__ import annotations

import struct
from pa_common import BODY_INDEX, POOLS, abcfmt, asm, body_bytes, sha, swftags


def frozen(value):
    if isinstance(value, float):
        return ("f64", struct.pack("<d", value))
    if isinstance(value, (list, tuple)):
        return tuple(frozen(x) for x in value)
    if hasattr(value, "__slots__"):
        return tuple((name, frozen(getattr(value, name))) for name in value.__slots__)
    return value


def static_check(abc, body):
    instructions = asm.decode(body[5])
    encoded, _ = asm.encode(instructions)
    assert encoded == body[5], "指令编解码不逐字节一致"
    assert not body[6], "P-a 不接受新增异常处理"
    metrics = asm.simulate(instructions, body[3], abc.multinames)
    assert metrics[:2] == (body[1], body[4]), "实际栈/作用域需求与 header 不符"
    assert asm.block_locals(instructions) <= body[2], "局部变量越界"
    assert body[2] >= len(abc.methods[body[0]][1]) + 1
    pending = [(0, 0, body[3])]
    visited = set()
    branches = 0
    for i, ins in enumerate(instructions):
        targets = [] if ins.target is None else [ins.target]
        if ins.cases is not None:
            targets += [ins.default] + ins.cases
        for target in targets:
            assert 0 <= target < len(instructions), "分支未落真实指令"
            if target <= i:
                assert instructions[target].name == "avm_label", "后向分支缺少 AVM2 label"
            branches += 1
    while pending:
        i, depth, scope = pending.pop()
        assert 0 <= i < len(instructions), "可达路径跌出方法尾"
        if (i, depth, scope) in visited:
            continue
        visited.add((i, depth, scope))
        ins = instructions[i]
        pop, push = asm._effect(ins, abc.multinames)
        assert depth >= pop
        depth += push - pop
        scope += (1 if ins.name in ("pushscope", "pushwith")
                  else -1 if ins.name == "popscope" else 0)
        assert body[3] <= scope <= body[4], "作用域不平衡"
        if ins.name == "getscopeobject":
            assert ins.args[0] < scope
        if ins.name in ("returnvalue", "returnvoid", "throw"):
            assert depth == 0, "出口操作数栈未清空"
            assert scope == body[4], "出口作用域偏离原始方法"
            targets = []
        elif ins.cases is not None:
            targets = [ins.default] + ins.cases
        elif ins.name == "jump":
            targets = [ins.target]
        elif ins.target is not None:
            targets = [i + 1, ins.target]
        else:
            targets = [i + 1]
        pending.extend((target, depth, scope) for target in targets)
    return {"instructions": len(instructions), "max_stack": metrics[0],
            "max_scope": metrics[1], "unreachable": metrics[2],
            "locals_used": asm.block_locals(instructions),
            "header": body[1:5], "branch_targets_checked": branches,
            "balanced_exits": True}


def compare(before, after):
    """输入必须是各自经过逐字节解析往返的 SwfAbc 对象。"""
    assert (before.signature, before.version) == (after.signature, after.version)
    assert before._prefix == after._prefix, "主 ABC 标签前缀变化"
    assert before._offset == after._offset, "主 ABC 之前有变化"
    assert before.body[:before._offset] == after.body[:after._offset]
    assert (before.body[before._offset + before._length:]
            == after.body[after._offset + after._length:]), "其它 SWF 标签变化"
    old, new = before.abc, after.abc
    assert new.serialize() == after._raw, "输出 ABC 无法逐字节往返"
    assert len(old.bodies) == len(new.bodies), "方法体总数变化"
    changed = [i for i, (left, right) in enumerate(zip(old.bodies, new.bodies))
               if body_bytes(left) != body_bytes(right)]
    assert changed == [BODY_INDEX], ("改变了额外的方法体", changed)
    assert old.bodies[BODY_INDEX][0] == new.bodies[BODY_INDEX][0]
    assert frozen(old.bodies[BODY_INDEX][6:]) == frozen(new.bodies[BODY_INDEX][6:])
    pools = {}
    for name in POOLS:
        left, right = getattr(old, name), getattr(new, name)
        assert frozen(left) == frozen(right[:len(left)]), "常量池前缀变化：" + name
        if name != "strings":
            assert len(left) == len(right), "意外追加常量池：" + name
        else:
            assert right[len(left):] == [b"mod_hp_"], "追加字符串不符合约定"
        pools[name] = {"before": len(left), "after": len(right),
                       "prefix_byte_identical": True}
    for name in ("minor", "major", "methods", "metadata", "instances", "classes", "scripts"):
        assert frozen(getattr(old, name)) == frozen(getattr(new, name)), name + " 变化"
    # 抹去唯一获准变更后整个 ABC 必须和原始 raw 完全相同。
    saved_pools = {name: getattr(new, name) for name in POOLS}
    saved_body = new.bodies[BODY_INDEX]
    try:
        for name in POOLS:
            setattr(new, name, getattr(old, name))
        new.bodies[BODY_INDEX] = old.bodies[BODY_INDEX]
        assert new.serialize() == before._raw, "全 ABC 归一还原不逐字节一致"
    finally:
        for name, value in saved_pools.items():
            setattr(new, name, value)
        new.bodies[BODY_INDEX] = saved_body
    other_tags = []
    for kind, offset, header, length in swftags.iter_tags(before.body):
        if offset == before._offset:
            continue
        raw = before.body[offset:offset + header + length]
        other_tags.append(raw)
    return {"changed_body_indices": changed, "method_bodies": len(old.bodies),
            "unchanged_method_bodies": len(old.bodies) - 1,
            "constant_pools": pools, "normalized_abc_byte_identical": True,
            "non_target_swf_tags_byte_identical": True,
            "other_swf_tag_count": len(other_tags),
            "other_swf_tags_sha256": sha(b"".join(other_tags)),
            "added_traits": 0, "added_classes": 0,
            "added_methods": 0, "static": static_check(new, saved_body)}
