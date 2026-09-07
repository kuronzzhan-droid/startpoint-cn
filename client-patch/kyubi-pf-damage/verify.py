#!/usr/bin/env python3
"""对 `kyubi-pf-damage-v1`（指令级重做版）的独立复核。

与两个 V12 模块同一套路：所有结论用 `client-patch/rank-scene-p2/independent/`
的读取器重新推一遍，它跟 `abcasm/` 不共享任何代码。

复核的判据：

  1. 5 个被改方法体的**基线** code 哈希与 `abcpatch.TARGETS` 锁定值一致；
  2. SWF 只有主 ABC 那一个标签变了；
  3. 常量池只**追加**了声明的 6 条字符串 / 5 个 QName / 2 个 int，别的池一条不改；
  4. `metadata` / `classes` / `scripts` 逐字节相同；`methods` 只在末尾多 2 条；
     `instances` 只有 `MemberImpl`（+1 槽 +2 方法）与 `AbilityDamageShot`（+2 槽）
     多出 trait，且都追加在**末尾**（不挪动任何已有槽序号），其余实例逐字节相同；
  5. 方法体：原有 N 个体里恰好这 5 个变了，末尾多 2 个新体；
  6. 每个被改体：原指令逐条保留（操作码/操作数全等，分支只做平移），
     每一段插入与 `abcpatch` 声明的助记符逐条一致，
     栈/作用域抽象解释无错、不可达指令数不变；
  7. 两个新方法体的指令列表与声明一致，栈解释干净；
  8. **寄存器映射反证**：`evalCommand` 里 CreateNormalAttack 的对象字面量
     `createdByPowerFlipAction` / `createdByMainSkillAction` /
     `createdByUnisonSkillAction` / `powerFlipChargeLv` 后面紧跟的
     `getlocal N`，必须与插入块里写的那四个寄存器号一一对上
     —— 这条把「`_loc63_` 就是 63 号寄存器」从假设变成断言；
  9. 两个新方法只在声明的地方被调用，别处一个调用点都没有。

`SquadManagerImpl.invokeActionSkill` 不在本文件的范围里：它走
`patch_squad_pcode.py --verify`（重导 P-code 后逐行比对）。
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
from abcpatch import (                            # noqa: E402
    ABILITY2_CHARACTER_ID, ADDED_MEMBER_TRAITS, ADDED_SHOT_TRAITS, ADDED_METHODS,
    CAPABILITY, CONTEXT_KEY_CHARGE, CONTEXT_KEY_DAMAGE, EVAL_REG_CHARGE_LV,
    EVAL_REG_IS_PF, EVAL_REG_MAIN_SKILL, EVAL_REG_UNISON_SKILL, INSERTIONS,
    MEMBER_CLASS, MEMBER_GET_LV, MEMBER_IS_PF, MEMBER_SLOT, ORIGIN_UNISON,
    SHOT_CLASS, SPECIAL, TARGETS, PatchError,
)

EXPECTED_NEW_STRINGS = [MEMBER_SLOT, MEMBER_IS_PF, MEMBER_GET_LV,
                        CONTEXT_KEY_DAMAGE, CONTEXT_KEY_CHARGE, SPECIAL]
EXPECTED_NEW_MULTINAMES = [MEMBER_SLOT, MEMBER_IS_PF, MEMBER_GET_LV,
                           CONTEXT_KEY_DAMAGE, CONTEXT_KEY_CHARGE]
EXPECTED_NEW_INTS = [ORIGIN_UNISON, ABILITY2_CHARACTER_ID]

# CreateNormalAttack 的对象字面量里，这些键的值就是那四个寄存器。
EVAL_KEY_REGISTERS = {
    "createdByPowerFlipAction": EVAL_REG_IS_PF,
    "createdByMainSkillAction": EVAL_REG_MAIN_SKILL,
    "createdByUnisonSkillAction": EVAL_REG_UNISON_SKILL,
    "powerFlipChargeLv": EVAL_REG_CHARGE_LV,
}

# 两个新方法允许出现的调用点（方法名）。
ALLOWED_CALLERS = {
    MEMBER_IS_PF: {"AbilityDamageShot/<ctor>"},
    MEMBER_GET_LV: {"AbilityDamageShot/<ctor>", "MemberImpl/applyInstantAbility"},
}

_NAME_FIXUP = {"getlocal_%d" % n: "getlocal%d" % n for n in range(4)}
_NAME_FIXUP.update({"setlocal_%d" % n: "setlocal%d" % n for n in range(4)})


def check(condition, message):
    if not condition:
        raise PatchError(message)


class _ReadOnlyPool:
    """只查不建的常量池视图 —— 索引从**最终产物**反查，不抄 abcpatch 的数字。"""

    def __init__(self, pools):
        self._strings = {}
        for index, value in enumerate(pools["strs"]):
            self._strings.setdefault(value, index)
        self._ints = {}
        for index, value in enumerate(pools["ints"]):
            self._ints.setdefault(value, index)

    def string(self, text) -> int:
        raw = text.encode("utf-8") if isinstance(text, str) else text
        if raw not in self._strings:
            raise PatchError("string %r is missing from the patched pool" % raw)
        return self._strings[raw]

    def integer(self, value: int) -> int:
        if value not in self._ints:
            raise PatchError("int %d is missing from the patched pool" % value)
        return self._ints[value]


def _public_qname(pools, namespace: str, local: str) -> int:
    matches = []
    for index in range(1, len(pools["mns"])):
        entry = pools["mns"][index]
        if entry is None or entry[0] != 0x07:
            continue
        kind, string_index = pools["nss"][entry[1]]
        if kind == 0x16 and independent._string(pools, string_index) == namespace \
                and independent._string(pools, entry[2]) == local:
            matches.append(index)
    check(len(matches) == 1,
          "%r is not a unique public QName in the product (%d matches)"
          % ((namespace, local), len(matches)))
    return matches[0]


def _array_index_multiname(pools) -> int:
    matches = [index for index in range(1, len(pools["mns"]))
               if pools["mns"][index] is not None and pools["mns"][index][0] == 0x1B]
    check(matches, "the product has no MultinameL at all")
    return matches[0]


def _rebuild_blocks(pools):
    """用**产物**里反查出来的常量池下标重建 abcpatch 的助记符块。"""
    resolved = {name: _public_qname(pools, namespace, name)
                for (namespace, name) in abcpatch.EXPECTED_MULTINAMES}
    resolved["array_index"] = _array_index_multiname(pools)
    check(resolved["array_index"] == abcpatch.ARRAY_INDEX_MULTINAME,
          "the array-index MultinameL moved")
    abcpatch.MN = resolved
    new = {name: _public_qname(pools, "", name) for name in EXPECTED_NEW_MULTINAMES}
    new[abcpatch.SHOT_SLOTS[0]] = new[CONTEXT_KEY_DAMAGE]
    new[abcpatch.SHOT_SLOTS[1]] = new[CONTEXT_KEY_CHARGE]
    return abcpatch._blocks(_ReadOnlyPool(pools), new), new


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
    """在**基线**体上重新数一遍：声明 FORBID 的点必须真的没有分支指向它。"""
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
            check(hits, "%s@%d is declared %s but nothing branches to it"
                  % (name, original_index, policy))


def prove_insertions(before, after, placed, pools):
    """原指令逐条保留、分支只做平移；栈/作用域抽象解释干净。"""
    ops = independent.myops
    old, new = ops.disasm(before["code"]), ops.disasm(after["code"])
    total = sum(count for _at, count, _p in placed)
    check(len(new) - len(old) == total, "unexpected instruction count delta")

    def old_to_new(index):
        moved = index
        for at, count, _policy in placed:
            if moved >= at:
                moved += count
        return moved

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
            want = [old_to_new(old_index[x]) for x in old_targets]
            got = [new_index[x] for x in new_targets]
            check(want == got, "original branch target changed at #%d" % i)
            for target in got:
                check(target not in inserted,
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


def _labels(abc, pools):
    """{方法体下标: '类名/方法名'}（独立读取器版，与 abcasm/bodies.py 无共享代码）。"""
    body_of = {body["method"]: index for index, body in enumerate(abc["bodies"])}
    labels = {}

    def put(method_index, class_name, method_name, static):
        index = body_of.get(method_index)
        if index is not None:
            labels[index] = "%s%s/%s" % (class_name, "$" if static else "", method_name)

    for position, instance in enumerate(abc["instances"]):
        class_name = independent._multiname(pools, instance[0]).split("::")[-1]
        put(instance[5], class_name, "<ctor>", False)
        for trait in instance[6]:
            if trait[1] & 0x0F in (1, 2, 3):
                name = independent._multiname(pools, trait[0]).split("::")[-1]
                suffix = {1: "", 2: "|get", 3: "|set"}[trait[1] & 0x0F]
                put(trait[2][1], class_name, name + suffix, False)
        klass = abc["classes"][position]
        put(klass[0], class_name, "<cinit>", True)
        for trait in klass[1]:
            if trait[1] & 0x0F in (1, 2, 3):
                name = independent._multiname(pools, trait[0]).split("::")[-1]
                suffix = {1: "", 2: "|get", 3: "|set"}[trait[1] & 0x0F]
                put(trait[2][1], class_name, name + suffix, True)
    return labels


def _trait_names(pools, traits):
    return [independent._multiname(pools, trait[0]).split("::")[-1] for trait in traits]


def verify(source: Path, final: Path):
    sa, va, ta = independent._tags_of(source)
    sb, vb, tb = independent._tags_of(final)
    check((sa, va, len(ta)) == (sb, vb, len(tb)), "SWF signature/version/tag count changed")
    changed_tags = [i for i, (x, y) in enumerate(zip(ta, tb)) if x != y]
    na, raw_a = independent._main_abc(ta)
    nb, raw_b = independent._main_abc(tb)
    check(na == nb == "boot_ffc6", "unexpected ABC name")
    check(len(changed_tags) == 1, "more than one SWF tag changed: %s" % changed_tags)
    a, b = independent.myabc.parse_abc(raw_a), independent.myabc.parse_abc(raw_b)
    pa, pb = a["pools"], b["pools"]

    # --- 常量池：只追加声明过的东西 ---------------------------------------
    for field in pa:
        check(pa[field] == pb[field][: len(pa[field])], "original %s pool entries moved" % field)
        if field not in ("strs", "mns", "ints"):
            check(pa[field] == pb[field], "unexpected %s pool additions" % field)
    added_strings = [x.decode("utf-8") for x in pb["strs"][len(pa["strs"]):]]
    check(added_strings == EXPECTED_NEW_STRINGS,
          "string pool additions are %r" % (added_strings,))
    added_ints = pb["ints"][len(pa["ints"]):]
    check(added_ints == EXPECTED_NEW_INTS, "int pool additions are %r" % (added_ints,))
    added_multinames = [independent._multiname(pb, index)
                        for index in range(len(pa["mns"]), len(pb["mns"]))]
    check(added_multinames == ["::" + name for name in EXPECTED_NEW_MULTINAMES],
          "multiname additions are %r" % (added_multinames,))

    # --- 结构表 -----------------------------------------------------------
    for field in ("metadata", "classes", "scripts"):
        check(a[field] == b[field], "unrelated %s structure changed" % field)
    check(len(b["methods"]) == len(a["methods"]) + ADDED_METHODS,
          "method_info count is not base + %d" % ADDED_METHODS)
    check(a["methods"] == b["methods"][: len(a["methods"])], "existing method_info moved")

    check(len(a["instances"]) == len(b["instances"]), "instance count changed")
    changed_instances = {}
    for index, (x, y) in enumerate(zip(a["instances"], b["instances"])):
        if x != y:
            changed_instances[independent._multiname(pa, x[0])] = (x, y)
    check(set(changed_instances) == {MEMBER_CLASS, SHOT_CLASS},
          "unexpected instances changed: %s" % sorted(changed_instances))
    for name, added in ((MEMBER_CLASS, ADDED_MEMBER_TRAITS), (SHOT_CLASS, ADDED_SHOT_TRAITS)):
        x, y = changed_instances[name]
        check(x[:6] == y[:6], "%s: something other than the trait list changed" % name)
        check(y[6][: len(x[6])] == x[6], "%s: existing traits moved" % name)
        tail = _trait_names(pb, y[6][len(x[6]):])
        check(tail == list(added), "%s: appended traits are %r" % (name, tail))
        for trait in y[6][len(x[6]):]:
            kind = trait[1] & 0x0F
            if kind == 0:                       # slot：id 必须是 0（自动分配）
                check(trait[2][0] == 0, "%s: the appended slot has a fixed id" % name)
                check(trait[2][3] == 0, "%s: the appended slot carries a default value" % name)
            else:
                check(kind == 1 and trait[2][0] == 0,
                      "%s: the appended method trait is not a plain method" % name)

    # --- 方法体 -----------------------------------------------------------
    check(len(b["bodies"]) == len(a["bodies"]) + ADDED_METHODS,
          "method body count is not base + %d" % ADDED_METHODS)
    labels = _labels(b, pb)
    index_of = {labels[index]: index for index in labels}
    changed = [i for i, (x, y) in enumerate(zip(a["bodies"], b["bodies"])) if x != y]
    expected = sorted(index_of[name] for name in TARGETS)
    check(changed == expected,
          "changed method bodies are not exactly the locked set: %s" % changed)

    blocks, new = _rebuild_blocks(pb)
    proof = {}
    for name, (base_sha256, before_header, after_header) in TARGETS.items():
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
        _prove_declared_policies(before, INSERTIONS[name], name)

        placed = []
        listings = []
        offset = 0
        for original_index, key, policy in INSERTIONS[name]:
            block = blocks[key]
            count = sum(1 for entry in block if entry[0] != "label")
            at = original_index + offset
            placed.append((at, count, policy))
            listings.append((at, expected_listing(block, pb, at)))
            offset += count
        stack = prove_insertions(before, after, placed, pb)
        normalized = independent._normalize(after, pb)
        for at, listing in listings:
            actual = normalized[at:at + len(listing)]
            check(actual == listing,
                  "%s@%d: inserted sequence is not exact\n  want %r\n  got  %r"
                  % (name, at, listing, actual))
        proof[name] = {
            "body_index": body_index,
            "insertions": [{"at_instruction": at, "instructions": count, "incoming": policy}
                           for at, count, policy in placed],
            "before_code_bytes": len(before["code"]),
            "after_code_bytes": len(after["code"]),
            "header": {"maxstack": after["maxstack"], "localcount": after["localcount"]},
            "all_original_instructions_and_branches_preserved": True,
            "stack": stack,
        }

    # --- 两个新方法体 ------------------------------------------------------
    methods = {}
    for label, key in ((MEMBER_IS_PF, "_method_is_pf"), (MEMBER_GET_LV, "_method_get_lv")):
        body_index = index_of["MemberImpl/" + label]
        check(body_index >= len(a["bodies"]), "%s is not one of the appended bodies" % label)
        body = b["bodies"][body_index]
        listing = expected_listing(blocks[key], pb, 0)
        actual = independent._normalize(body, pb)
        check(actual == listing,
              "%s: body is not the declared listing\n  want %r\n  got  %r"
              % (label, listing[:8], actual[:8]))
        body["pools"] = pb
        stack = independent._abstract_interpret(body, pb)
        del body["pools"]
        check(not stack["errors"], "%s: stack verification failed: %s" % (label, stack["errors"]))
        check(stack["unreachable"] == 0, "%s: has unreachable instructions" % label)
        check(stack["max_stack_computed"] <= stack["max_stack_declared"],
              "%s: maxstack is too small" % label)
        methods[label] = {"body_index": body_index, "instructions": len(actual),
                          "code_bytes": len(body["code"]),
                          "maxstack": body["maxstack"], "localcount": body["localcount"],
                          "stack": stack}

    # --- 寄存器映射反证 ----------------------------------------------------
    eval_body = b["bodies"][index_of["ActionEvaluator/evalCommand"]]
    instructions = independent.myops.disasm(eval_body["code"])
    registers = {}
    for n, instruction in enumerate(instructions):
        if instruction["name"] != "pushstring":
            continue
        key = independent._string(pb, instruction["ops"][0])
        if key not in EVAL_KEY_REGISTERS or n + 1 >= len(instructions):
            continue
        consumer = instructions[n + 1]
        if consumer["name"] != "getlocal":
            continue
        registers.setdefault(key, set()).add(consumer["ops"][0])
    for key, register in EVAL_KEY_REGISTERS.items():
        check(register in registers.get(key, set()),
              "no CreateNormalAttack literal feeds %r from register %d (found %r)"
              % (key, register, sorted(registers.get(key, set()))))

    # --- 新方法只在声明的地方被调用 -----------------------------------------
    callers = {label: set() for label in ALLOWED_CALLERS}
    for label in ALLOWED_CALLERS:
        multiname = new[label]
        for body_index, body in enumerate(b["bodies"]):
            for instruction in independent.myops.disasm(body["code"]):
                if instruction["name"] in ("callproperty", "callpropvoid", "callproplex") \
                        and instruction["ops"][0] == multiname:
                    callers[label].add(labels.get(body_index, "<anonymous #%d>" % body_index))
        check(callers[label] == ALLOWED_CALLERS[label],
              "%s is called from %r, expected %r"
              % (label, sorted(callers[label]), sorted(ALLOWED_CALLERS[label])))

    return {
        "status": "verified",
        "capability": CAPABILITY,
        "source_swf": str(source),
        "source_swf_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "final_swf": str(final),
        "swf_sha256": hashlib.sha256(final.read_bytes()).hexdigest(),
        "swf_bytes": final.stat().st_size,
        "changed_tags": changed_tags,
        "changed_method_bodies": changed,
        "appended_method_bodies": list(range(len(a["bodies"]), len(b["bodies"]))),
        "total_main_abc_method_bodies": len(b["bodies"]),
        "added_pool_strings": added_strings,
        "added_multinames": added_multinames,
        "added_ints": added_ints,
        "added_methods": ADDED_METHODS,
        "added_instance_traits": {MEMBER_CLASS: list(ADDED_MEMBER_TRAITS),
                                  SHOT_CLASS: list(ADDED_SHOT_TRAITS)},
        "register_mapping": {key: sorted(registers.get(key, set()))
                             for key in EVAL_KEY_REGISTERS},
        "new_method_callers": {label: sorted(value) for label, value in callers.items()},
        "new_methods": methods,
        "proof": proof,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("final", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.source, args.final)
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                           encoding="utf-8", newline="\n")
    print(json.dumps({k: report[k] for k in
                      ("status", "capability", "changed_method_bodies",
                       "appended_method_bodies", "added_ints", "register_mapping",
                       "new_method_callers")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
