#!/usr/bin/env python3
"""对 422 `DashParameter` 补丁的独立复核。

与 `kyubi-fever-ratio/verify.py` 同一套路:所有结论用
`client-patch/rank-scene-p2/independent/` 的读取器重新推一遍,
它跟 `abcasm/` 不共享任何代码。

复核的判据:
  1. 13 个被改方法体的**基线** code 哈希与 patch.py 锁定值一致;
  2. SWF 只有主 ABC 那一个标签变了;
  3. 常量池只**追加**了声明的那些字符串和 2 个 QName,别的池一条不改;
  4. metadata / classes / scripts 逐字节相同;methods 只在末尾多 1 条;
     instances 只有 `BattleAbilityTotalizerImpl` 多 2 条 trait(1 槽 + 1 方法),
     其余实例逐字节相同,且新 trait 追加在**末尾**(不挪动任何已有槽序号);
  5. 方法体:原有 N 个体里恰好这 13 个变了,末尾多 1 个新体;
  6. 每个被改体:原指令逐条保留(操作码/操作数全等,分支只做平移),
     每一段插入与 abcpatch.py 声明的助记符逐条一致,
     栈/作用域抽象解释无错、不可达指令数不变;
  7. 新方法体的指令列表与声明一致,栈解释干净;
  8. 7 个 param_id 在 BallImpl 侧各出现且只出现在声明的生效点。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "abcasm"))
sys.path.insert(0, str(HERE.parent / "rank-scene-p2"))

import asm                                        # noqa: E402
import abcpatch                                   # noqa: E402
import verify_rank_scene_p2 as independent        # noqa: E402
from patch import (                               # noqa: E402
    ADDED_INSTANCE_TRAITS, CAPABILITY, CONTENT_CTOR, CONTENT_KIND, INSERTIONS,
    PARAM_COUNT, PARAM_NAMES, TARGETS, TEXT_DOWN, TEXT_MINUS,
    TEXT_PLUS, TEXT_UP, TOTALIZER_GETTER, TOTALIZER_SLOT, PatchError,
)

TOTALIZER_CLASS = "pinball.scene.battle.battle.ability::BattleAbilityTotalizerImpl"
EXPECTED_NEW_STRINGS = [
    TOTALIZER_SLOT, TOTALIZER_GETTER, CONTENT_CTOR,
    TEXT_PLUS, TEXT_MINUS, TEXT_UP, TEXT_DOWN, "冲刺参数",
] + [PARAM_NAMES[k] for k in sorted(PARAM_NAMES)]
# `冲刺参数` 之后是 7 个参数名;"%" / "422" / "strength" / "unique_condition_id"
# 在基线里已有,不会新增。

_NAME_FIXUP = {"getlocal_%d" % n: "getlocal%d" % n for n in range(4)}
_NAME_FIXUP.update({"setlocal_%d" % n: "setlocal%d" % n for n in range(4)})

# BallImpl 的哪个体、哪个生效点用哪个 param_id(与 patch.py 的 INSERTIONS 同源)。
BALL_PARAM_IDS = {
    "BallImpl/update": {0, 3},
    "BallImpl/findEscapeTarget": {1, 2, 5},
    "BallImpl/tryEscape": {4},
    "BallImpl/canEscapeNow": {6},
}


def check(condition, message):
    if not condition:
        raise PatchError(message)


class _ReadOnlyPool:
    """只查不建的常量池视图 —— 索引从**最终产物**反查,不抄 abcpatch 的数字。"""

    def __init__(self, pools):
        self._index = {}
        for index, value in enumerate(pools["strs"]):
            self._index.setdefault(value, index)

    def string(self, text) -> int:
        raw = text.encode("utf-8") if isinstance(text, str) else text
        if raw not in self._index:
            raise PatchError("string %r is missing from the patched pool" % raw)
        return self._index[raw]


def expected_listing(block, pools, base_index):
    position = {}
    index = base_index
    for entry in block:
        if entry[0] == "label":
            position[entry[1]] = index
        else:
            index += 1
    position["END"] = index
    listing = []
    for entry in block:
        if entry[0] == "label":
            continue
        name = entry[0]
        operands = list(entry[1:])
        opcode = asm.MNEMONICS[name]
        rendered = _NAME_FIXUP.get(name, name)
        if opcode in range(0x0C, 0x1B):
            listing.append("%s #%d" % (rendered, position[operands[0]]))
        elif rendered in independent.STRING_OPERAND_OPS:
            listing.append('%s "%s"' % (rendered, independent._string(pools, operands[0])))
        elif rendered in independent.MN_OPERAND_OPS:
            rest = "".join(", %s" % value for value in operands[1:])
            listing.append("%s %s%s" % (rendered,
                                        independent._multiname(pools, operands[0]), rest))
        else:
            listing.append("%s%s" % (rendered,
                                     (" " + ", ".join(str(v) for v in operands))
                                     if operands else ""))
    return listing


def _prove_declared_policies(before, entries, name):
    """在**基线**体上重新数一遍:声明 FORBID 的点必须真的没有分支指向它,
    声明 SKIP / ENTER 的点必须真的有。"""
    ops = independent.myops
    instructions = ops.disasm(before["code"])
    index_of = {row["addr"]: n for n, row in enumerate(instructions)}
    index_of[len(before["code"])] = len(instructions)
    incoming = {}
    for n, instruction in enumerate(instructions):
        for address in ops.targets(instruction):
            incoming.setdefault(index_of[address], []).append(n)
    for original_index, _key, policy in entries:
        hits = incoming.get(original_index, [])
        if policy == asm.FORBID:
            check(not hits,
                  "%s@%d is declared FORBID but %d original branches target it"
                  % (name, original_index, len(hits)))
        else:
            check(hits,
                  "%s@%d is declared %s but nothing branches to it — "
                  "the declaration is stale" % (name, original_index, policy))


def prove_insertions(before, after, placed, pools):
    """原指令逐条保留、分支只按声明的 incoming 策略落位(支持一个体里插多块)。

    `placed` = [(实际插入下标, 块长, incoming 策略), …]。
    「策略」不是注释:分支目标按它算出唯一的期望值,算错就报错。
    """
    ops = independent.myops
    old, new = ops.disasm(before["code"]), ops.disasm(after["code"])
    total = sum(count for _at, count, _p in placed)
    check(len(new) - len(old) == total, "unexpected instruction count delta")

    def old_to_new(index):
        """原指令 index 现在住在哪 —— 与策略无关。"""
        moved = index
        for at, count, _policy in placed:
            if moved >= at:
                moved += count
        return moved

    def old_target_to_new(index):
        """指向原指令 index 的**分支**现在应该指向哪 —— 由策略决定。"""
        moved = index
        for at, count, policy in placed:
            if moved == at and policy == asm.ENTER:
                continue                  # 落在块开头:不跟着块一起后移
            if moved >= at:
                moved += count
        return moved

    entered = {at for at, _count, policy in placed if policy == asm.ENTER}
    inserted = set()
    for at, count, _policy in placed:
        inserted.update(range(at, at + count))
    old_index = {row["addr"]: n for n, row in enumerate(old)}
    old_index[len(before["code"])] = len(old)
    new_index = {row["addr"]: n for n, row in enumerate(new)}
    new_index[len(after["code"])] = len(new)

    for i, original in enumerate(old):
        actual = new[old_to_new(i)]
        check(original["name"] == actual["name"],
              "original opcode changed at #%d: %s -> %s"
              % (i, original["name"], actual["name"]))
        old_targets, new_targets = ops.targets(original), ops.targets(actual)
        if old_targets:
            want = [old_target_to_new(old_index[x]) for x in old_targets]
            got = [new_index[x] for x in new_targets]
            check(want == got, "original branch target changed at #%d" % i)
            for target in got:
                check(target not in inserted or target in entered,
                      "an original branch was redirected into inserted code at #%d" % i)
        else:
            check(original["ops"] == actual["ops"],
                  "original instruction operand changed at #%d" % i)

    after["pools"] = pools
    stack = independent._abstract_interpret(after, pools)
    del after["pools"]
    check(not stack["errors"], "stack/branch verification failed: %s" % stack["errors"])
    check(stack["max_stack_computed"] <= stack["max_stack_declared"], "maxstack is too small")
    check(stack["max_scope_computed"] <= stack["max_scope_declared"], "maxscope is too small")
    base_unreachable = independent._abstract_interpret(before, pools)["unreachable"]
    check(stack["unreachable"] == base_unreachable,
          "unreachable instruction count changed: %d -> %d"
          % (base_unreachable, stack["unreachable"]))
    return stack


def verify(source: Path, final: Path, body_index: dict | None = None):
    """核对一次 422 补丁。

    `body_index` = {TARGETS 键: 主 ABC 里的体下标}。默认用 TARGETS / PRESERVED_BODIES
    里锁死的 V11 链下标;V13 起链首改从 V8 重建,V9 的整类 AS3 回编把 51410 之后的
    体下标整体挪过位,所以调用方按**方法名**重新解析后从这里传进来。
    下标只决定「去哪儿看」,判定仍然是下面锁死的基线 code sha256 与逐条指令比对 ——
    传错下标会当场被 sha256 拦下,不会静默放行。
    """
    index_of = {name: entry[0] for name, entry in TARGETS.items()}
    if body_index is not None:
        missing = set(index_of) - set(body_index)
        check(not missing, "body index map is missing %s" % sorted(missing))
        index_of = {name: body_index[name] for name in index_of}
    sa, va, ta = independent._tags_of(source)
    sb, vb, tb = independent._tags_of(final)
    check((sa, va, len(ta)) == (sb, vb, len(tb)), "SWF signature/version/tag count changed")
    changed_tags = [i for i, (a, b) in enumerate(zip(ta, tb)) if a != b]
    check(len(changed_tags) == 1, "more than one SWF tag changed: %s" % changed_tags)
    na, raw_a = independent._main_abc(ta)
    nb, raw_b = independent._main_abc(tb)
    check(na == nb == "boot_ffc6", "unexpected ABC name")
    a, b = independent.myabc.parse_abc(raw_a), independent.myabc.parse_abc(raw_b)
    pa, pb = a["pools"], b["pools"]

    # --- 常量池 ---------------------------------------------------------
    for field in pa:
        check(pa[field] == pb[field][: len(pa[field])], "original %s pool changed" % field)
        if field not in ("strs", "mns"):
            check(pa[field] == pb[field], "unexpected %s pool additions" % field)
    added_strings = [s.decode("utf-8") for s in pb["strs"][len(pa["strs"]):]]
    check(added_strings == EXPECTED_NEW_STRINGS,
          "unexpected string pool additions: %r" % (added_strings,))
    added_multinames = pb["mns"][len(pa["mns"]):]
    check(len(added_multinames) == 2, "expected exactly two new multinames")
    added_names = [independent._multiname(pb, len(pa["mns"]) + i) for i in range(2)]
    check(added_names == ["::" + TOTALIZER_SLOT, "::" + TOTALIZER_GETTER],
          "unexpected multiname additions: %r" % (added_names,))

    # --- 结构表 ---------------------------------------------------------
    for field in ("metadata", "classes", "scripts"):
        check(a[field] == b[field], "unrelated %s structure changed" % field)
    check(len(b["methods"]) == len(a["methods"]) + 1, "method_info count is not base + 1")
    check(a["methods"] == b["methods"][: len(a["methods"])], "an existing method_info changed")
    new_method = b["methods"][len(a["methods"])]
    check(new_method[0] == 1 and len(new_method[2]) == 1,
          "the new method_info does not take exactly one parameter")
    check(independent._multiname(pb, new_method[1]) == "::Number",
          "the new method does not return Number")
    check(independent._multiname(pb, new_method[2][0]) == "::int",
          "the new method does not take an int")
    check(new_method[4] == 0, "the new method_info declares unexpected flags")

    check(len(a["instances"]) == len(b["instances"]), "instance count changed")
    differing = [i for i, (x, y) in enumerate(zip(a["instances"], b["instances"])) if x != y]
    check(len(differing) == 1, "more than one instance changed: %s" % differing)
    index = differing[0]
    before_instance, after_instance = a["instances"][index], b["instances"][index]
    check(independent._multiname(pa, before_instance[0]) == TOTALIZER_CLASS,
          "the changed instance is not %s" % TOTALIZER_CLASS)
    check(before_instance[:6] == after_instance[:6], "the class header changed")
    before_traits, after_traits = before_instance[6], after_instance[6]
    check(after_traits[: len(before_traits)] == before_traits,
          "an existing trait changed or moved")
    added_traits = after_traits[len(before_traits):]
    check(len(added_traits) == 2, "expected exactly two new traits")
    slot_trait, method_trait = added_traits
    check(independent._multiname(pb, slot_trait[0]) == "::" + TOTALIZER_SLOT
          and slot_trait[1] == 0 and slot_trait[2][0] == 0
          and independent._multiname(pb, slot_trait[2][1]) == "::Array"
          and slot_trait[2][2] == 0,
          "the new slot trait is not an auto-id Array slot with no default")
    check(independent._multiname(pb, method_trait[0]) == "::" + TOTALIZER_GETTER
          and method_trait[1] == 1 and method_trait[2][0] == 0
          and method_trait[2][1] == len(a["methods"]),
          "the new method trait does not point at the new method_info")

    # --- 方法体 ---------------------------------------------------------
    check(len(b["bodies"]) == len(a["bodies"]) + 1, "method body count is not base + 1")
    changed = [i for i, (x, y) in enumerate(zip(a["bodies"], b["bodies"])) if x != y]
    expected = sorted(index_of.values())
    check(changed == expected,
          "changed method bodies are not exactly the locked set: %s" % changed)
    appended = b["bodies"][len(a["bodies"])]
    check(appended["method"] == len(a["methods"]),
          "the appended body does not belong to the new method")

    pool = _ReadOnlyPool(pb)
    slot_mn = len(pa["mns"])
    getter_mn = slot_mn + 1
    blocks = abcpatch._blocks(pool, getter_mn, slot_mn)

    proof = {}
    for name, (_locked_index, base_sha256, before_header, after_header) in TARGETS.items():
        body_index = index_of[name]
        before, after = a["bodies"][body_index], b["bodies"][body_index]
        check(hashlib.sha256(before["code"]).hexdigest() == base_sha256,
              "%s: baseline code hash mismatch" % name)
        for field in ("method", "initscope", "maxscope", "ex", "traits"):
            check(before[field] == after[field], "%s: body field %s changed" % (name, field))
        check((before["maxstack"], before["localcount"]) == before_header,
              "%s: unexpected baseline header" % name)
        check((after["maxstack"], after["localcount"]) == after_header,
              "%s: unexpected patched header" % name)
        placed = []
        offset = 0
        listings = []
        for original_index, key, policy in INSERTIONS[name]:
            check(policy in asm.INCOMING_POLICIES, "%s: unknown incoming policy" % name)
            actual = original_index + offset
            listing = expected_listing(blocks[key], pb, actual)
            listings.append((actual, key, listing, policy))
            placed.append((actual, len(listing), policy))
            offset += len(listing)
        _prove_declared_policies(before, INSERTIONS[name], name)
        stack = prove_insertions(before, after, placed, pb)
        normalized = independent._normalize(after, pb)
        for actual, key, listing, _policy in listings:
            actual_listing = normalized[actual:actual + len(listing)]
            check(actual_listing == listing,
                  "%s@%d (%s): inserted sequence is not exact\n  want %r\n  got  %r"
                  % (name, actual, key,
                     [x for x, y in zip(listing, actual_listing) if x != y][:3],
                     [y for x, y in zip(listing, actual_listing) if x != y][:3]))
        proof[body_index] = {
            "method": name,
            "insertions": [{"at_instruction": at, "instructions": count,
                            "block": key, "incoming": policy}
                           for (at, count, policy), (_a, key, _l, _p)
                           in zip(placed, listings)],
            "before_code_bytes": len(before["code"]),
            "after_code_bytes": len(after["code"]),
            "header": {"maxstack": after["maxstack"], "localcount": after["localcount"]},
            "all_original_instructions_and_branches_preserved": True,
            "stack": stack,
        }

    # --- 新方法体 -------------------------------------------------------
    getter_block = abcpatch._getter_source(slot_mn)
    appended["pools"] = pb
    getter_stack = independent._abstract_interpret(appended, pb)
    del appended["pools"]
    check(not getter_stack["errors"],
          "the new getter fails stack verification: %s" % getter_stack["errors"])
    check(getter_stack["unreachable"] == 0, "the new getter has unreachable instructions")
    check(getter_stack["max_stack_computed"] <= appended["maxstack"], "getter maxstack too small")
    getter_listing = independent._normalize(appended, pb)
    expected_getter = _render_instructions(getter_block, pb)
    check(getter_listing == expected_getter,
          "the new getter body is not the declared listing\n  want %r\n  got  %r"
          % (expected_getter[:6], getter_listing[:6]))

    # --- BallImpl 的 param_id 覆盖 ---------------------------------------
    coverage = {}
    for name, ids in BALL_PARAM_IDS.items():
        body_index = index_of[name]
        seen = set()
        instructions = independent.myops.disasm(b["bodies"][body_index]["code"])
        for n, instruction in enumerate(instructions):
            if instruction["name"] != "callproperty" or instruction["ops"][0] != getter_mn:
                continue
            previous = instructions[n - 1]
            check(previous["name"] == "pushbyte",
                  "%s: the param_id argument is not a literal" % name)
            seen.add(previous["ops"][0])
        check(seen == ids, "%s: param ids %r != declared %r" % (name, sorted(seen), sorted(ids)))
        coverage[name] = sorted(seen)
    all_ids = sorted({x for ids in coverage.values() for x in ids})
    check(all_ids == list(range(PARAM_COUNT)),
          "the seven param ids are not all wired: %r" % (all_ids,))
    # 除了 BallImpl 的四个体,任何别的方法体都不许调这个 getter。
    callers = set()
    for body_index, body in enumerate(b["bodies"]):
        for instruction in independent.myops.disasm(body["code"]):
            if instruction["name"] in ("callproperty", "callpropvoid", "callproplex") \
                    and instruction["ops"][0] == getter_mn:
                callers.add(body_index)
    check(callers == {index_of[name] for name in BALL_PARAM_IDS},
          "the getter is called from unexpected bodies: %r" % (sorted(callers),))

    return {
        "status": "verified",
        "capability": CAPABILITY,
        "during_content_kind": CONTENT_KIND,
        "source_swf": str(source),
        "source_swf_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "final_swf": str(final),
        "swf_sha256": hashlib.sha256(final.read_bytes()).hexdigest(),
        "swf_bytes": final.stat().st_size,
        "changed_tags": changed_tags,
        "changed_method_bodies": changed,
        "appended_method_body": len(a["bodies"]),
        "total_main_abc_method_bodies": len(b["bodies"]),
        "added_pool_strings": added_strings,
        "added_multinames": added_names,
        "added_methods": 1,
        "added_instance_traits": list(ADDED_INSTANCE_TRAITS),
        "ball_param_coverage": coverage,
        "getter": {"body_index": len(a["bodies"]), "instructions": len(getter_listing),
                   "stack": getter_stack},
        "proof": proof,
    }


def _render_instructions(block, pools):
    """把一个**完整方法体**的助记符块渲染成 independent._normalize 的形态。"""
    return expected_listing(block, pools, 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("final", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.source, args.final)
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    args.report.write_text(text, encoding="utf-8", newline="\n")
    print(text[:4000])
