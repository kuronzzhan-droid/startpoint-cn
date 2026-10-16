#!/usr/bin/env python3
"""把 instant_content 724 `AddFeverPointRatio` 拼进 V11 主 ABC 的 7 个方法体。

每个体都是「在一个指令边界上整块插入」:原有指令一条不改(操作码、操作数全等),
只有分支的 s24 偏移按插入长度重算。因此:
  * 反向操作 = 把那一块摘掉再重编码,必须逐字节还原成基线 code(本模块自检);
  * 幂等:已经打过的 SWF(常量池里已有 `AddFeverPointRatio`)直接原样返回。

所有常量池索引都是**照抄官方现场**的(注释里写了抄自哪个体的哪一条),
新增的只有三条字符串:`"724"`、`"AddFeverPointRatio"` 和两句中文面板文案。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "abcasm"))

import asm                                              # noqa: E402
import bodies                                           # noqa: E402
from swfabc import PoolEditor, SwfAbc                    # noqa: E402
from patch import (                                      # noqa: E402
    BATTLE_CONTENT_INDEX, CAPABILITY, CONTENT_CTOR, CONTENT_KIND, INSERT_AT,
    PANEL_TEXT_DECREASE, PANEL_TEXT_INCREASE, PANEL_TEXT_PERCENT,
    RATIO_STATS_KIND, RATIO_STATS_SENTINEL, TARGETS, V11_SWF_SHA256, PatchError,
)

# ---------------------------------------------------------------------------
# 常量池索引:全部抄自 base-v11 的官方现场,一个都不新建。
MN = {
    # ---- 类(getlex)。每一个在基线里都已经被 getlex 过,没有「引新类」风险。
    "InstantAbilityContentMasterValue": 12845,   # parseAt47 #9
    "InstantAbilityContent": 10169,              # InstantAbilityContentTools.mergeForDescription
    "InstantAbilityInstantBattleContent": 10168,  # 同上
    "AbilityValues": 10013,                      # parseAt47 #11
    "AbilityDescriptionTools": 7127,             # 全库 1249 处
    "Decimal_Impl_": 3430,                       # applyInstantBattle #38
    "Option": 79,                                # mergeForDescription #30
    "Zone": 9342,                                # applyInstantBattle #34
    "Function": 71,                              # stringfyInstantBattleContent #8
    # ---- 属性 / 方法名
    "index": 46,                                 # applyInstantBattle #28
    "params": 80,                                # applyInstantBattle #40
    "array_index": 14,                           # MultinameL,applyInstantBattle #42
    "strength": 8712,                            # resolveInstantContent #78
    "max": 61,                                   # FeverPointGaugeImpl.run #96(feverPoint.max)
    "None": 226,                                 # mergeForDescription #31
    "parseAt51": 34941,                          # parseAt47 #18
    "resolveDecimal": 9329,                      # resolveInstantContent #80
    "InstantBattle": 12843,                      # InstantAbilityContentTools.mergeForDescription
    "stringfy": 10035,                           # AbilityDescriptionTools.stringfy
    "toPercentString": 11518,                    # Decimal_Impl_.toPercentString
    "zoneManager": 27234,                        # applyInstantBattle #31/#32
    "getCurrentZone": 42234,                     # applyInstantBattle #33
    "addFeverPoint": 42548,                      # applyInstantBattle #50(Zone::addFeverPoint)
    "feverPoint": 27529,                         # FeverPointGaugeImpl.addFeverPoint #37
    "stringfyInstantBattleContent": 11962,       # …AccordingToPrecontent #21/#23
}

# 插入块的「结束标签」。assemble 把它解析成「块末尾」,也就是被顶开的那条原指令。
SKIP = "END"


def _blocks(pool: PoolEditor):
    """七个插入块。返回 {短名: 助记符列表}。"""
    s_kind = pool.string(str(CONTENT_KIND))            # b"724"(基线没有,新增)
    s_ctor = pool.string(CONTENT_CTOR)                 # b"AddFeverPointRatio"(新增)
    s_up = pool.string(PANEL_TEXT_INCREASE)            # 新增
    s_down = pool.string(PANEL_TEXT_DECREASE)          # 新增
    s_pct = pool.string(PANEL_TEXT_PERCENT)            # b"%" 基线已有
    s_strength = pool.string("strength")               # 基线已有(6098)

    return {
        # ── 解析器:未知 kind 落 else 就是 ClientError 7050,必须先认识 724 ──
        "AbilityValues$/parseAt47": [
            ("getlocal_2",),
            ("pushstring", s_kind),
            ("ifne", SKIP),
            ("getlex", MN["InstantAbilityContentMasterValue"]),
            ("pushstring", s_ctor),
            ("pushshort", CONTENT_KIND),
            ("pushstring", s_strength),
            ("getlex", MN["AbilityValues"]),
            ("getlocal_1",),
            ("callproperty", MN["parseAt51"], 1),
            ("coerce_a",),
            ("newobject", 1),
            ("newarray", 1),
            ("construct", 3),
            ("coerce", MN["InstantAbilityContentMasterValue"]),
            ("returnvalue",),
        ],
        # ── master value -> 运行时内容 ──
        "InstantAbilitySource$/resolveInstantContent": [
            ("getlocal", 5),
            ("pushshort", CONTENT_KIND),
            ("ifne", SKIP),
            ("getlex", MN["InstantAbilityContent"]),
            ("getlex", MN["InstantAbilityInstantBattleContent"]),
            ("pushstring", s_ctor),
            ("pushbyte", BATTLE_CONTENT_INDEX),
            ("getlocal_2",),                                   # AbilityPowerValue
            ("getlocal", 4),                                   # master value
            ("getproperty", MN["params"]),
            ("pushbyte", 0),
            ("getproperty", MN["array_index"]),
            ("getproperty", MN["strength"]),
            ("coerce_a",),
            ("callproperty", MN["resolveDecimal"], 1),
            ("convert_d",),
            ("newarray", 1),
            ("construct", 3),
            ("coerce", MN["InstantAbilityInstantBattleContent"]),
            ("callproperty", MN["InstantBattle"], 1),
            ("coerce", MN["InstantAbilityContent"]),
            ("returnvalue",),
        ],
        # ── 合并显示:新 kind 一律不合并(否则 _loc3_ 留 null 后面空引用)──
        "InstantAbilityContentTools$/mergeForDescription": [
            ("getlocal_1",),
            ("getproperty", MN["index"]),
            ("pushbyte", 5),                                   # InstantAbilityContent.InstantBattle
            ("ifne", SKIP),
            ("getlocal_2",),
            ("getproperty", MN["index"]),
            ("pushbyte", 5),
            ("ifne", SKIP),
            ("getlocal_1",),
            ("getproperty", MN["params"]),
            ("pushbyte", 0),
            ("getproperty", MN["array_index"]),
            ("getproperty", MN["index"]),
            ("pushbyte", BATTLE_CONTENT_INDEX),
            ("ifeq", "NOMERGE"),
            ("getlocal_2",),
            ("getproperty", MN["params"]),
            ("pushbyte", 0),
            ("getproperty", MN["array_index"]),
            ("getproperty", MN["index"]),
            ("pushbyte", BATTLE_CONTENT_INDEX),
            ("ifne", SKIP),
            ("label", "NOMERGE"),
            ("getlex", MN["Option"]),
            ("getproperty", MN["None"]),
            ("returnvalue",),
        ],
        # ── 面板文案 ──
        "InstantAbilityDescriptionGenerator/stringfyInstantBattleContent": [
            ("getlocal_1",),
            ("getproperty", MN["index"]),
            ("pushbyte", BATTLE_CONTENT_INDEX),
            ("ifne", SKIP),
            ("getlocal_1",),
            ("getproperty", MN["params"]),
            ("pushbyte", 0),
            ("getproperty", MN["array_index"]),
            ("convert_d",),
            ("setlocal_2",),
            ("getlocal_2",),
            ("pushbyte", 0),
            ("ifge", "POSITIVE"),
            ("getlex", MN["AbilityDescriptionTools"]),
            ("pushstring", s_down),
            ("getlex", MN["Decimal_Impl_"]),
            ("getlocal_2",),
            ("negate",),
            ("callproperty", MN["toPercentString"], 1),
            ("add",),
            ("pushstring", s_pct),
            ("add",),
            ("callproperty", MN["stringfy"], 1),
            ("coerce", MN["Function"]),
            ("returnvalue",),
            ("label", "POSITIVE"),
            ("getlex", MN["AbilityDescriptionTools"]),
            ("pushstring", s_up),
            ("getlex", MN["Decimal_Impl_"]),
            ("getlocal_2",),
            ("callproperty", MN["toPercentString"], 1),
            ("add",),
            ("pushstring", s_pct),
            ("add",),
            ("callproperty", MN["stringfy"], 1),
            ("coerce", MN["Function"]),
            ("returnvalue",),
        ],
        # ── 带前置内容时的兜底:官方 switch 只有 0..4,新 kind 会留 null 闭包 ──
        "InstantAbilityDescriptionGenerator/stringfyInstantBattleContentAccordingToPrecontent": [
            ("getlocal_1",),
            ("getproperty", MN["index"]),
            ("pushbyte", BATTLE_CONTENT_INDEX),
            ("ifne", SKIP),
            ("findproperty", MN["stringfyInstantBattleContent"]),
            ("getlocal_1",),
            ("callproperty", MN["stringfyInstantBattleContent"], 1),
            ("coerce", MN["Function"]),
            ("returnvalue",),
        ],
        # ── 战斗生效 ──
        "AbilitySlotImpl/applyInstantBattle": [
            ("getlocal_1",),
            ("getproperty", MN["index"]),
            ("pushbyte", BATTLE_CONTENT_INDEX),
            ("ifne", SKIP),
            ("findproperty", MN["zoneManager"]),
            ("getproperty", MN["zoneManager"]),
            ("callproperty", MN["getCurrentZone"], 0),
            ("coerce", MN["Zone"]),
            ("getlocal_1",),
            ("getproperty", MN["params"]),
            ("pushbyte", 0),
            ("getproperty", MN["array_index"]),
            ("convert_d",),
            ("getlocal_2",),                                   # 触发倍数
            ("multiply",),
            ("convert_d",),
            ("pushtrue",),
            ("pushshort", RATIO_STATS_SENTINEL + RATIO_STATS_KIND),
            ("callpropvoid", MN["addFeverPoint"], 3),
            ("returnvoid",),
        ],
        # ── 比例 -> 绝对值的唯一换算点 ──
        "FeverPointGaugeImpl/addFeverPoint": [
            ("getlocal_3",),
            ("pushbyte", RATIO_STATS_SENTINEL),
            ("iflt", SKIP),
            ("getlocal_1",),
            ("findproperty", MN["feverPoint"]),
            ("getproperty", MN["feverPoint"]),
            ("getproperty", MN["max"]),
            ("multiply",),
            ("convert_d",),
            ("setlocal_1",),
            ("getlocal_3",),
            ("pushbyte", RATIO_STATS_SENTINEL),
            ("subtract",),
            ("convert_i",),
            ("setlocal_3",),
        ],
    }


# ---------------------------------------------------------------------------
def patch_body(body, name, block):
    """在 `body` 上插入 `block`,并当场验证反向操作能逐字节还原。"""
    _locked_index, base_sha256, before_header, after_header = TARGETS[name]
    if hashlib.sha256(body[5]).hexdigest() != base_sha256:
        raise PatchError("%s: unrecognized baseline code (sha256=%s)"
                         % (name, hashlib.sha256(body[5]).hexdigest()))
    if (body[1], body[2]) != before_header:
        raise PatchError("%s: unexpected baseline header %r" % (name, (body[1], body[2])))
    if body[6]:
        raise PatchError("%s: this body unexpectedly has an exception table" % name)
    at = INSERT_AT[name]
    instructions = asm.assemble(block)
    needed_locals = asm.block_locals(instructions)
    if needed_locals > after_header[1]:
        raise PatchError("%s: block needs %d locals, header declares %d"
                         % (name, needed_locals, after_header[1]))
    code, exceptions, merged = asm.splice(body, at, instructions)
    if exceptions != body[6]:
        raise PatchError("%s: the exception table moved" % name)
    if asm.unsplice(code, at, len(instructions)) != body[5]:
        raise PatchError("%s: the splice is not exactly reversible" % name)
    return code, merged, len(instructions)


def apply_to_abc(swf: SwfAbc) -> dict:
    abc = swf.abc
    if CONTENT_CTOR.encode() in abc.strings:
        raise PatchError("this SWF already carries %s" % CAPABILITY)
    pool = PoolEditor(abc)
    blocks = _blocks(pool)
    if set(blocks) != set(TARGETS):
        raise PatchError("block set does not match the locked target set")
    report = {}
    for name, block in blocks.items():
        # 体下标按**方法名**重新解析:V13 起链首从 V8 重建,V9 的整类回编把
        # 51410 之后的下标整体挪过位,TARGETS 里锁的 V11 下标不再通用。
        # 名字定位 + 下面锁定的 code sha256 是两道独立的门。
        body_index = bodies.resolve(abc, name)
        body = abc.bodies[body_index]
        code, merged, inserted = patch_body(body, name, block)
        after_header = TARGETS[name][3]
        body[1], body[2] = after_header
        body[5] = code
        maximum_stack, maximum_scope, _unreachable = asm.simulate(
            merged, body[3], abc.multinames)
        if maximum_stack > body[1]:
            raise PatchError("%s: computed maxstack %d exceeds declared %d"
                             % (name, maximum_stack, body[1]))
        if maximum_scope > body[4]:
            raise PatchError("%s: computed maxscope %d exceeds declared %d"
                             % (name, maximum_scope, body[4]))
        report[name] = {
            "body_index": body_index,
            "locked_v11_body_index": TARGETS[name][0],
            "inserted_instructions": inserted,
            "insert_at_instruction": INSERT_AT[name],
            "code_bytes_before": TARGETS[name][1],
            "code_bytes_after": hashlib.sha256(code).hexdigest(),
            "header": {"maxstack": body[1], "localcount": body[2]},
            "computed": {"maxstack": maximum_stack, "maxscope": maximum_scope},
        }
    report["_pool"] = pool.report()
    return report


def apply(source: Path, output: Path) -> dict:
    source, output = Path(source), Path(output)
    if source.resolve() == output.resolve():
        raise PatchError("the input SWF must stay immutable")
    swf = SwfAbc(source)
    report = apply_to_abc(swf)
    swf.save(output)
    report["capability"] = CAPABILITY
    report["source_swf_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    report["output_swf_sha256"] = hashlib.sha256(output.read_bytes()).hexdigest()
    report["output_swf_bytes"] = output.stat().st_size
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--require-base", action="store_true",
                        help="只接受 V11 基线 SWF(链式构建的第一步用)")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.require_base:
        actual = hashlib.sha256(args.source.read_bytes()).hexdigest()
        if actual != V11_SWF_SHA256:
            raise PatchError("expected the V11 base SWF, got %s" % actual)
    report = apply(args.source, args.output)
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.report:
        args.report.write_text(text, encoding="utf-8", newline="\n")
    print(text)


if __name__ == "__main__":
    main()
