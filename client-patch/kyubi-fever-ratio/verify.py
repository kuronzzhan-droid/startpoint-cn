#!/usr/bin/env python3
"""对 724 `AddFeverPointRatio` 补丁的独立复核。

「独立」= 全部结论用 `client-patch/rank-scene-p2/independent/` 那套读取器重新推出来
(SWF 标签、常量池、ABC 结构表、每个方法体、指令列表、以及栈/作用域前向抽象解释),
它与 `abcasm/`、与 FFDec 都不共享一行代码 —— 一边的 bug 不可能同时骗过另一边。

复核的判据:
  1. 输入必须是锁定的 V11 SWF;
  2. SWF 只有主 ABC 那一个标签变了,其余标签逐字节相同;
  3. 常量池只**追加**了 4 条字符串,其余池(int/uint/double/ns/nsset/multiname)一条不改;
  4. methods / metadata / classes / instances / scripts 五张结构表逐字节相同
     (= 没新增方法、没新增 trait、没动类层次);
  5. 变了的方法体恰好是 patch.py 锁定的那 7 个;
  6. 每个体:原有指令**逐条**保留(操作码与操作数全等,分支目标按插入长度平移),
     插入段与 abcpatch.py 声明的助记符逐条一致,栈/作用域解释无错、不新增不可达指令;
  7. `Zone.addFeverPoint` 的 statsKind 哨兵安全:全库常量实参里 >= 100 的只有我们那一处;
  8. V9/V10/V11 已打过的方法体没被碰。
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

import abcpatch                                   # noqa: E402
import verify_rank_scene_p2 as independent        # noqa: E402
from patch import (                               # noqa: E402
    CAPABILITY, CONTENT_CTOR, CONTENT_KIND, INSERT_AT, PANEL_TEXT_DECREASE,
    PANEL_TEXT_INCREASE, RATIO_STATS_KIND, RATIO_STATS_SENTINEL, TARGETS,
    V11_SWF_SHA256, PatchError,
)

# V9/V10/V11 打过的方法体,V12 必须原样带过去。
# V9/V10/V11 已经改过的体:本补丁必须一个字节都不碰。键是方法名(与
# `client-patch/abcasm/bodies.py` 的标签写法一致),值是 V11 链上的体下标。
PRESERVED_BODIES = {
    "ActionEvaluationResolver/<ctor>": 52311,
    "BallImpl/resolveCollisionForPrimaryOrSummons": 59953,
    "AbilityLogic/getDescriptions": 7435,
    "AbilityLogic/getDescriptionWithSimplify": 7436,
    "LeaderAbilityLogic/getDescriptions": 7772,
    "LeaderAbilityLogic/getDescriptionWithSimplify": 7773,
}
EXPECTED_NEW_STRINGS = [str(CONTENT_KIND).encode(), CONTENT_CTOR.encode(),
                        PANEL_TEXT_INCREASE.encode(), PANEL_TEXT_DECREASE.encode()]

# 助记符名字的两套写法:abcasm 用 getlocal_0,independent/myops 用 getlocal0。
_NAME_FIXUP = {"getlocal_%d" % n: "getlocal%d" % n for n in range(4)}
_NAME_FIXUP.update({"setlocal_%d" % n: "setlocal%d" % n for n in range(4)})


def check(condition, message):
    if not condition:
        raise PatchError(message)


def expected_listing(block, pools, base_index):
    """把 abcpatch 的助记符块渲染成 independent._normalize 的输出形态。"""
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
        opcode = __import__("asm").MNEMONICS[name]
        rendered_name = _NAME_FIXUP.get(name, name)
        if opcode in range(0x0C, 0x1B):
            listing.append("%s #%d" % (rendered_name, position[operands[0]]))
        elif rendered_name in independent.STRING_OPERAND_OPS:
            listing.append('%s "%s"' % (rendered_name,
                                        independent._string(pools, operands[0])))
        elif rendered_name in independent.MN_OPERAND_OPS:
            rest = "".join(", %s" % value for value in operands[1:])
            listing.append("%s %s%s" % (rendered_name,
                                        independent._multiname(pools, operands[0]), rest))
        else:
            listing.append("%s%s" % (rendered_name,
                                     (" " + ", ".join(str(v) for v in operands))
                                     if operands else ""))
    return listing


def prove_insertion(before, after, at, count, pools):
    """原有指令逐条保留、分支只做平移;并跑一遍栈/作用域抽象解释。"""
    ops = independent.myops
    old, new = ops.disasm(before["code"]), ops.disasm(after["code"])
    check(len(new) - len(old) == count, "unexpected instruction count delta")
    old_index = {row["addr"]: n for n, row in enumerate(old)}
    old_index[len(before["code"])] = len(old)
    new_index = {row["addr"]: n for n, row in enumerate(new)}
    new_index[len(after["code"])] = len(new)

    def original_index(address):
        index = new_index[address]
        check(not at <= index < at + count, "an original branch was redirected into new code")
        return index if index < at else index - count

    for i, original in enumerate(old):
        actual = new[i if i < at else i + count]
        check(original["name"] == actual["name"],
              "an original opcode changed at #%d: %s -> %s" % (i, original["name"], actual["name"]))
        old_targets, new_targets = ops.targets(original), ops.targets(actual)
        if old_targets:
            check([old_index[x] for x in old_targets] == [original_index(x) for x in new_targets],
                  "an original branch target changed at #%d" % i)
        else:
            check(original["ops"] == actual["ops"],
                  "an original instruction operand changed at #%d" % i)
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


def _leaf_name(pools, index):
    """multiname 的叶子名。

    `independent._multiname` 把 QName 渲染成 `ns::name`,把带命名空间集的
    Multiname 渲染成 `name{nsset#N}`。只按 `::` 切会漏掉后一种 —— V9 的 FFDec
    整类回编正是把 `QName(Namespace("…:Zone"),"addFeverPoint")` 改写成了
    `Multiname("addFeverPoint",[…])`,于是 V12 链上 `ActionEvaluator.evalCommand`
    的那处调用**根本没进过这张表**(哨兵唯一性检查在那条链上是漏扫的)。
    """
    rendered = independent._multiname(pools, index).split("::")[-1]
    if rendered.endswith("}") and "{nsset#" in rendered:
        rendered = rendered[: rendered.index("{nsset#")]
    return rendered


def _fever_sentinel_sites(abc, pools):
    """全库每一处 addFeverPoint 调用点上、statsKind 位置的常量实参。

    `Zone.addFeverPoint(value, isChangeable, statsKind)` 取第 3 参,
    `EnemyImpl.addFeverPoint(value, statsKind)`(转发进 Zone)取第 2 参 ——
    两者的最后一个实参都紧挨在调用指令前一条,所以直接看前一条是不是常量 push。
    非常量的两处(EnemyImpl / ZoneImpl 的纯转发)记成 null,由报告里的 4 行自证。
    """
    names = {index for index in range(1, len(pools["mns"]))
             if _leaf_name(pools, index) == "addFeverPoint"}
    sites = []
    for body_index, body in enumerate(abc["bodies"]):
        instructions = independent.myops.disasm(body["code"])
        for n, instruction in enumerate(instructions):
            if instruction["name"] not in ("callproperty", "callpropvoid", "callproplex"):
                continue
            if instruction["ops"][0] not in names or instruction["ops"][1] not in (2, 3):
                continue
            previous = instructions[n - 1] if n else None
            constant = None
            local = None
            if previous is not None and previous["name"] in ("pushbyte", "pushshort"):
                constant = previous["ops"][0]
            elif previous is not None and previous["name"] in _GETLOCAL:
                local = _GETLOCAL[previous["name"]]
                if local is None:
                    local = previous["ops"][0]
            sites.append({"body_index": body_index, "argc": instruction["ops"][1],
                          "stats_kind": constant, "stats_kind_local": local,
                          "call_index": n})
    return sites


_GETLOCAL = {"getlocal": None, "getlocal0": 0, "getlocal1": 1,
             "getlocal2": 2, "getlocal3": 3}
_SETLOCAL = {"setlocal": None, "setlocal0": 0, "setlocal1": 1,
             "setlocal2": 2, "setlocal3": 3}
# 只有这些转换指令可以夹在字面量与 setlocal 之间而不改变「是不是那个整数」。
_TRANSPARENT = ("convert_i", "convert_u", "convert_d", "coerce_a")
_UNKNOWN = None
_WIDEN_LIMIT = 16


def _written_local(instruction):
    """这条指令写了哪个局部变量?写了但值不可知时返回 (n, False)。"""
    name = instruction["name"]
    if name in _SETLOCAL:
        index = _SETLOCAL[name]
        return (instruction["ops"][0] if index is None else index), True
    if name in ("inclocal", "declocal", "inclocal_i", "declocal_i"):
        return instruction["ops"][0], "step"
    if name == "hasnext2":
        return instruction["ops"][0], False
    return None, False


def _literal_before(instructions, index, pools, targets):
    """`setlocal` 之前紧邻的字面量;不是字面量、或中途有分支落点就返回 None。

    判据:字面量与 `setlocal` **之间**的每一条指令(以及 `setlocal` 自己)都不许是
    分支落点 —— 否则别的路径可能绕过那次 push,栈顶就不是这个字面量了。
    字面量本身是落点没关系(switch 的 case 入口正是这个形状),它照样会被执行。
    """
    if instructions[index]["addr"] in targets:
        return None
    n = index - 1
    while n >= 0 and instructions[n]["name"] in _TRANSPARENT:
        if instructions[n]["addr"] in targets:
            return None
        n -= 1
    if n < 0:
        return None
    name = instructions[n]["name"]
    if name in ("pushbyte", "pushshort"):
        return instructions[n]["ops"][0]
    if name == "pushint":
        return pools["ints"][instructions[n]["ops"][0]]
    return None


def local_constants_at(body, pools, local, at_index):
    """对**单个局部变量**做前向常量传播,返回它在 `at_index` 处可能的取值集合。

    这是给 `addFeverPoint` 转发点用的:`ActionEvaluator.evalCommand` 把 statsKind
    放在一个反复复用的临时局部里(全方法 81 处写),所以「整个方法体里没有 >= 100 的
    字面量」这条老判据在原版 V8 字节码上根本不成立(V9 的 FFDec 回编把大常量改写成
    `pushint`,老判据在那条链上是**空过**的)。这里改成真的数据流:

      * 只有「字面量 [convert_*] setlocal N」这一种写法算已知常量,别的写法(数组取值、
        属性读、返回值……)一律污染成未知;
      * `inclocal*/declocal*` 在常量集上整体 ±1;`hasnext2` 直接污染;
      * 合并 = 并集,未知吸收一切;异常处理入口按未知播种。

    返回 `None` 表示到达点未知(调用方必须另找证据)。入口状态就是「未知」,
    所以纯转发方法(statsKind 直接是形参)一定返回 None,由调用方退回粗判据。
    """
    instructions = independent.myops.disasm(body["code"])
    addr2index = {ins["addr"]: n for n, ins in enumerate(instructions)}
    targets = set()  # noqa: F841 (填在下面)
    for instruction in instructions:
        targets.update(independent.myops.targets(instruction))
    for _start, _stop, handler, _type, _var in body["ex"]:
        # 异常只在处理器入口重新进入控制流,而下面把每个处理器入口直接播成「未知」,
        # 所以 try 区间本身不必当分支落点。
        targets.add(handler)
    count = len(instructions)
    unset = object()
    state = [unset] * count
    # 入口一律播「未知」:局部变量号 <= 参数个数时它装的是调用方传进来的实参,
    # 装作「没被赋过值」会得出假的「一定小于 100」。要得到常量,必须在读之前
    # 真的有一次字面量写覆盖它 —— 那正是下面的传播要证明的事。
    state[0] = _UNKNOWN
    work = [0]
    for _start, _stop, handler, _type, _var in body["ex"]:
        index = addr2index.get(handler)
        if index is not None:
            state[index] = _UNKNOWN
            work.append(index)

    def widen(value):
        # `inclocal_i` 落在循环里时集合会无限增长 —— 超过上限直接放弃求精,
        # 收敛到「未知」。判据方向是保守的:未知会让调用方报错,不会放行。
        if value is not _UNKNOWN and len(value) > _WIDEN_LIMIT:
            return _UNKNOWN
        return value

    def merge(index, value):
        value = widen(value)
        current = state[index]
        if current is unset:
            state[index] = value
            work.append(index)
            return
        if current is _UNKNOWN:
            return
        if value is _UNKNOWN:
            state[index] = _UNKNOWN
            work.append(index)
            return
        merged = current | value
        if merged != current:
            state[index] = merged
            work.append(index)

    while work:
        index = work.pop()
        value = state[index]
        instruction = instructions[index]
        written, how = _written_local(instruction)
        after = value
        if written == local:
            if how is True:
                literal = _literal_before(instructions, index, pools, targets)
                after = _UNKNOWN if literal is None else frozenset({literal})
            elif how == "step":
                delta = 1 if instruction["name"].startswith("inc") else -1
                after = _UNKNOWN if value is _UNKNOWN else frozenset(x + delta for x in value)
            else:
                after = _UNKNOWN
        successors = []
        for address in independent.myops.targets(instruction):
            if address in addr2index:
                successors.append(addr2index[address])
        if independent.myops.falls_through(instruction) and index + 1 < count:
            successors.append(index + 1)
        for successor in successors:
            merge(successor, after)

    value = state[at_index]
    return None if value is unset or value is _UNKNOWN else sorted(value)


def verify(source: Path, final: Path, base_swf_sha256: str = V11_SWF_SHA256,
           body_index: dict | None = None):
    """核对一次 724 补丁。

    `body_index` = {TARGETS 键: 主 ABC 里的体下标}。默认用 TARGETS / PRESERVED_BODIES
    里锁死的 V11 链下标;V13 起链首改从 V8 重建,V9 的整类 AS3 回编把 51410 之后的
    体下标整体挪过位,所以调用方按**方法名**重新解析后从这里传进来。
    下标只决定「去哪儿看」,判定仍然是下面锁死的基线 code sha256 与逐条指令比对 ——
    传错下标会当场被 sha256 拦下,不会静默放行。
    """
    check(hashlib.sha256(source.read_bytes()).hexdigest() == base_swf_sha256,
          "unknown input SWF")
    index_of = {name: entry[0] for name, entry in TARGETS.items()}
    preserved = dict(PRESERVED_BODIES)
    if body_index is not None:
        missing = (set(index_of) | set(preserved)) - set(body_index)
        check(not missing, "body index map is missing %s" % sorted(missing))
        index_of = {name: body_index[name] for name in index_of}
        preserved = {name: body_index[name] for name in preserved}
    sa, va, ta = independent._tags_of(source)
    sb, vb, tb = independent._tags_of(final)
    check((sa, va, len(ta)) == (sb, vb, len(tb)), "SWF signature/version/tag count changed")
    changed_tags = [i for i, (a, b) in enumerate(zip(ta, tb)) if a != b]
    na, raw_a = independent._main_abc(ta)
    nb, raw_b = independent._main_abc(tb)
    check(na == nb == "boot_ffc6", "unexpected ABC name")
    check(len(changed_tags) == 1, "more than one SWF tag changed: %s" % changed_tags)
    a, b = independent.myabc.parse_abc(raw_a), independent.myabc.parse_abc(raw_b)

    for field in ("methods", "metadata", "classes", "scripts", "instances"):
        check(a[field] == b[field], "unrelated %s structure changed" % field)
    pa, pb = a["pools"], b["pools"]
    for field in pa:
        check(pa[field] == pb[field][: len(pa[field])], "original %s pool changed" % field)
        if field != "strs":
            check(pa[field] == pb[field], "unexpected %s pool additions" % field)
    added_strings = pb["strs"][len(pa["strs"]):]
    check(added_strings == EXPECTED_NEW_STRINGS,
          "unexpected string pool additions: %r" % (added_strings,))

    check(len(a["bodies"]) == len(b["bodies"]), "method body count changed")
    changed = [i for i, (x, y) in enumerate(zip(a["bodies"], b["bodies"])) if x != y]
    expected = sorted(index_of.values())
    check(changed == expected,
          "changed method bodies are not exactly the locked set: %s" % changed)
    for label, index in preserved.items():
        check(a["bodies"][index]["code"] == b["bodies"][index]["code"],
              "previously patched method %s changed" % label)

    blocks = abcpatch._blocks(_ReadOnlyPool(pb))
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
        at = INSERT_AT[name]
        listing = expected_listing(blocks[name], pb, at)
        stack = prove_insertion(before, after, at, len(listing), pb)
        actual = independent._normalize(after, pb)[at:at + len(listing)]
        check(actual == listing,
              "%s: inserted sequence is not exact\n  want %r\n  got  %r"
              % (name, [x for x, y in zip(listing, actual) if x != y][:3],
                 [y for x, y in zip(listing, actual) if x != y][:3]))
        proof[body_index] = {
            "method": name,
            "inserted_instructions": len(listing),
            "insert_at_instruction": at,
            "before_code_bytes": len(before["code"]),
            "after_code_bytes": len(after["code"]),
            "header": {"maxstack": after["maxstack"], "localcount": after["localcount"]},
            "all_original_instructions_and_branches_preserved": True,
            "stack": stack,
        }

    sites = _fever_sentinel_sites(b, pb)
    high = [site for site in sites if site["stats_kind"] is not None
            and site["stats_kind"] >= RATIO_STATS_SENTINEL]
    check(len(high) == 1 and high[0]["stats_kind"] == RATIO_STATS_SENTINEL + RATIO_STATS_KIND
          and high[0]["body_index"] == index_of["AbilitySlotImpl/applyInstantBattle"],
          "the addFeverPoint statsKind sentinel is not unique: %r" % (high,))
    low = sorted({site["stats_kind"] for site in sites
                  if site["stats_kind"] is not None
                  and site["stats_kind"] < RATIO_STATS_SENTINEL})
    check(all(value < RATIO_STATS_SENTINEL for value in low),
          "an official statsKind collides with the sentinel range")
    # 实参不是字面量的调用点(EnemyImpl 的三元、EnemyImpl/ZoneImpl 的纯转发、
    # ActionEvaluator.evalCommand 的 DSL 分支):必须逐点证明它们凑不出哨兵。
    #   * 实参是 `getlocal N` 的,对 N 做单变量常量传播,要求到达值全都 < 100;
    #   * 实参形状再复杂的,退回「整个方法体里没有 >= 100 的整数字面量」这条粗判据。
    # 老版本只有粗判据,而原版 V8 的 evalCommand 里当然有 >= 100 的字面量
    # (V9 的 FFDec 回编把它们改写成了 pushint,粗判据在 V9 链上是空过的)。
    forwarders = {}
    for site in sites:
        if site["stats_kind"] is not None:
            continue
        body_index = site["body_index"]
        body = b["bodies"][body_index]
        local = site["stats_kind_local"]
        if local is not None:
            values = local_constants_at(body, pb, local, site["call_index"] - 1)
            if values is not None:
                check(all(value < RATIO_STATS_SENTINEL for value in values),
                      "forwarder body %d: statsKind local %d can reach the sentinel range %r"
                      % (body_index, local, values))
                forwarders.setdefault(body_index, []).append(
                    {"kind": "local", "local": local, "reaching_values": values})
                continue
            # 传播判不出来(典型:statsKind 直接是形参的纯转发)—— 退回粗判据。
        for instruction in independent.myops.disasm(body["code"]):
            if instruction["name"] in ("pushbyte", "pushshort"):
                check(instruction["ops"][0] < RATIO_STATS_SENTINEL,
                      "forwarder body %d can push a sentinel-range constant" % body_index)
            elif instruction["name"] == "pushint":
                check(pb["ints"][instruction["ops"][0]] < RATIO_STATS_SENTINEL,
                      "forwarder body %d can push a sentinel-range int constant" % body_index)
        forwarders.setdefault(body_index, []).append({"kind": "no-literal-in-body"})

    return {
        "status": "verified",
        "capability": CAPABILITY,
        "instant_content_kind": CONTENT_KIND,
        "base_swf_sha256": base_swf_sha256,
        "final_swf": str(final),
        "swf_sha256": hashlib.sha256(final.read_bytes()).hexdigest(),
        "swf_bytes": final.stat().st_size,
        "changed_tags": changed_tags,
        "changed_method_bodies": changed,
        "total_main_abc_method_bodies": len(a["bodies"]),
        "added_pool_strings": [s.decode("utf-8") for s in added_strings],
        "added_multinames": 0,
        "added_methods": 0,
        "added_instance_traits": 0,
        "add_fever_point_call_sites": sites,
        "official_stats_kinds": low,
        "forwarder_proofs": forwarders,
        "preserved_bodies": {k: v for k, v in preserved.items()},
        "proof": proof,
    }


class _ReadOnlyPool:
    """给 abcpatch._blocks 用的只读常量池视图:只做查找,查不到就报错。

    这样 verify 端拿到的字符串索引是从**最终产物**里反查出来的,
    而不是照抄 abcpatch 打补丁时算出来的数字。
    """

    def __init__(self, pools):
        self._index = {}
        for index, value in enumerate(pools["strs"]):
            self._index.setdefault(value, index)

    def string(self, text) -> int:
        raw = text.encode("utf-8") if isinstance(text, str) else text
        if raw not in self._index:
            raise PatchError("string %r is missing from the patched pool" % raw)
        return self._index[raw]


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
