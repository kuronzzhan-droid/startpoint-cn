#!/usr/bin/env python3
"""把 during_content 422 `DashParameter` 拼进主 ABC。

改动面:
  * 13 个方法体,全部是「在指令边界上整块插入」,原指令一条不改;
  * `BattleAbilityTotalizerImpl` 新增 1 个实例槽(`duringDashParameters:Array`)
    与 1 个实例方法(`getTotalDashParameter(int):Number`,附带 1 个新 method_info
    和 1 个新 method_body);
  * 常量池只**追加**字符串与两个 QName。

所有引用官方符号的常量池索引都照抄官方现场(注释写了抄自哪一处),
新槽 / 新方法的 QName 复用 `index`(PackageNamespace(""))的命名空间,
与该类其余 public 成员完全同名空间。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "abcasm"))
sys.path.insert(0, str(HERE))

import asm                                              # noqa: E402
import bodies                                           # noqa: E402
from swfabc import PoolEditor, SwfAbc                    # noqa: E402
from patch import (                                      # noqa: E402
    ADDED_INSTANCE_TRAITS, BATTLE_CONTENT_INDEX, CAPABILITY, CONTENT_CTOR,
    CONTENT_KIND, INSERTIONS, PARAM_COUNT, PARAM_NAMES, TARGETS, TEXT_DOWN,
    TEXT_MINUS, TEXT_PERCENT, TEXT_PLUS, TEXT_UP, TOTALIZER_GETTER,
    TOTALIZER_SLOT, PatchError,
)

TOTALIZER_CLASS = "pinball.scene.battle.battle.ability::BattleAbilityTotalizerImpl"

# ---------------------------------------------------------------------------
# 常量池索引:全部抄自 base-v11 的官方现场。
MN = {
    # 类
    "CommonAbilityContentMasterValue": 12110,   # parseAt109 #9
    "CommonAbilityContent": 10163,              # createFromDuringAbilityValues(844 处)
    "CommonAbilityBattleContent": 10182,        # CommonAbilityContentTools #1
    "AbilityValues": 10013,                     # parseAt109 #11
    "Option": 79,                               # 全库
    "Array": 6,
    "Number": 85,
    "int": 38,
    "void": 1,
    "Function": 71,
    "Math": 83,                                 # BallImpl._getSpeedupCorrectionFactor #68
    "Decimal_Impl_": 3430,                      # 同上 #34/#42/#56
    "DuringCheckerWithDecimal": 42601,          # addDuringContent #8
    "EscapeTarget": 43713,                      # findEscapeTarget #3(escape 包)
    "AbilityDescriptionTools": 7127,
    "AbilityDescriptionStringfier_Impl_": 10498,  # stringfyStrengthByCommonBattleContent #28
    # 属性 / 方法名
    "index": 46,
    "params": 80,
    "array_index": 14,                          # MultinameL
    "strength": 8712,                           # createFromDuringAbilityValues(337 处)
    "unique_condition_id": 12528,
    "resolveDecimal": 9329,                     # createFromDuringAbilityValues(385 处)
    "parseAt113": 34952,
    "parseAt118": 34953,
    "Battle": 11551,                            # CommonAbilityContent.Battle
    "Some": 241,
    "None": 226,
    "push": 65,                                 # addDuringContent #18(AS3 builtin)
    "sum": 42603,                               # DuringCheckerWithDecimal.sum
    "max": 61,                                  # Math.max / ClosedInterval.max
    "toFloat": 3432,                            # Decimal_Impl_.toFloat
    "toPercentString": 11518,
    "stringfy": 10035,
    "stringfyPercentUpDown": 10502,             # stringfyStrengthByCommonBattleContent #31
    "convertStrength": 10192,                   # 同上 #34
    "battle": 27490,                            # BallImpl._getSpeedupCorrectionFactor #57
    "abilityTotalizer": 15477,                  # 同上 #59
    "currentDistance": 45322,                   # EscapeTargetScoutContext.currentDistance
    "stateFrame": 37409,                        # BallImpl.update #255/#256
}
END = "END"


# ---------------------------------------------------------------------------
def _dash_factor(getter_mn: int, param_id: int):
    """留下 `1 + getTotalDashParameter(id)/100000` 在栈顶(净 +1,峰值 +3)。

    形状照抄 `BallImpl._getSpeedupCorrectionFactor` #56-#63
    (`Decimal_Impl_.toFloat(battle.abilityTotalizer.getTotalSpeedup())`)。
    """
    return [
        ("getlex", MN["Decimal_Impl_"]),
        ("findproperty", MN["battle"]),
        ("getproperty", MN["battle"]),
        ("getproperty", MN["abilityTotalizer"]),
        ("pushbyte", param_id),
        ("callproperty", getter_mn, 1),
        ("convert_d",),
        ("callproperty", MN["toFloat"], 1),
        ("convert_d",),
        ("pushbyte", 1),
        ("add",),
    ]


def _scale_top(getter_mn: int, param_id: int):
    """栈顶那个官方常量 × 倍率(净 0,峰值 +3)。"""
    return _dash_factor(getter_mn, param_id) + [("multiply",)]


def _param_name_chain(pool, id_local: int, out_local: int):
    """按 `id_local` 里的 param_id 把中文名字写进 `out_local`。

    `id_local` 与 `out_local` 必须是**不同**的局部:默认值先写进 out,
    如果两者同号就会在读 id 之前把它冲掉。
    """
    if id_local == out_local:
        raise PatchError("param-name chain needs two distinct locals")
    block = [("pushstring", pool.string("冲刺参数")), ("setlocal", out_local)]
    for param_id in sorted(PARAM_NAMES):
        label = "NAME%d" % param_id
        block += [
            ("getlocal", id_local),
            ("pushbyte", param_id),
            ("ifne", label),
            ("pushstring", pool.string(PARAM_NAMES[param_id])),
            ("setlocal", out_local),
            ("jump", "NAMED"),
            ("label", label),
        ]
    block.append(("label", "NAMED"))
    return block


def _blocks(pool, getter_mn: int, slot_mn: int):
    s_ctor = pool.string(CONTENT_CTOR)
    s_kind = pool.string(str(CONTENT_KIND))
    s_strength = pool.string("strength")
    s_uid = pool.string("unique_condition_id")
    s_plus = pool.string(TEXT_PLUS)
    s_minus = pool.string(TEXT_MINUS)
    s_percent = pool.string(TEXT_PERCENT)
    s_up = pool.string(TEXT_UP)
    s_down = pool.string(TEXT_DOWN)

    blocks = {}

    # ── AbilityValues.parseAt109:认识 "422" ───────────────────────────────
    blocks["parse"] = [
        ("getlocal_2",),
        ("pushstring", s_kind),
        ("ifne", END),
        ("getlex", MN["CommonAbilityContentMasterValue"]),
        ("pushstring", s_ctor),
        ("pushshort", CONTENT_KIND),
        ("pushstring", s_uid),
        ("getlex", MN["AbilityValues"]),
        ("getlocal_1",),
        ("callproperty", MN["parseAt118"], 1),
        ("coerce_a",),
        ("pushstring", s_strength),
        ("getlex", MN["AbilityValues"]),
        ("getlocal_1",),
        ("callproperty", MN["parseAt113"], 1),
        ("coerce_a",),
        ("newobject", 2),
        ("newarray", 1),
        ("construct", 3),
        ("coerce", MN["CommonAbilityContentMasterValue"]),
        ("returnvalue",),
    ]

    # ── DuringAbilitySource:master value -> 运行时内容 ────────────────────
    # 插在 `switch(_loc21_.index)` 之前。422 落在官方 switch 的 default(= 直接跳到
    # 末尾的 `return new DuringAbilitySource(...)`),所以只要先把 _loc20_ 填好即可。
    blocks["resolve"] = [
        ("getlocal", 21),
        ("getproperty", MN["index"]),
        ("pushshort", CONTENT_KIND),
        ("ifne", END),
        ("getlocal", 21),
        ("getproperty", MN["params"]),
        ("pushbyte", 0),
        ("getproperty", MN["array_index"]),
        ("setlocal", 22),                       # 新增局部:master value 的参数对象
        ("getlex", MN["CommonAbilityContent"]),
        ("getlex", MN["CommonAbilityBattleContent"]),
        ("pushstring", s_ctor),
        ("pushbyte", BATTLE_CONTENT_INDEX),
        ("getlocal", 22),
        ("getproperty", MN["unique_condition_id"]),
        ("convert_i",),
        ("getlocal_2",),                        # AbilityPowerValue
        ("getlocal", 22),
        ("getproperty", MN["strength"]),
        ("coerce_a",),
        ("callproperty", MN["resolveDecimal"], 1),
        ("convert_d",),
        ("newarray", 2),
        ("construct", 3),
        ("coerce", MN["CommonAbilityBattleContent"]),
        ("callproperty", MN["Battle"], 1),
        ("coerce", MN["CommonAbilityContent"]),
        ("setlocal", 20),                       # _loc20_ = content
    ]

    # ── CommonAbilityContentTools ─────────────────────────────────────────
    guard = [
        ("getlocal_1",),
        ("getproperty", MN["index"]),
        ("pushbyte", 0),                        # CommonAbilityContent.Battle
        ("ifne", END),
        ("getlocal_1",),
        ("getproperty", MN["params"]),
        ("pushbyte", 0),
        ("getproperty", MN["array_index"]),
        ("getproperty", MN["index"]),
        ("pushbyte", BATTLE_CONTENT_INDEX),
        ("ifne", END),
    ]
    strength_of_content = [
        ("getlocal_1",),
        ("getproperty", MN["params"]),
        ("pushbyte", 0),
        ("getproperty", MN["array_index"]),
        ("getproperty", MN["params"]),
        ("pushbyte", 1),
        ("getproperty", MN["array_index"]),
        ("convert_d",),
    ]
    # 官方 getStrength 对未知 kind 走到方法末尾 returnvoid,返回 undefined 强制成
    # Option -> null,调用方 `switch(_loc11_.index)` 当场空引用。
    blocks["get_strength"] = guard + [("getlex", MN["Option"])] + strength_of_content + [
        ("callproperty", MN["Some"], 1),
        ("coerce", MN["Option"]),
        ("returnvalue",),
    ]
    # hasAdvantage 只决定队伍徽章要不要亮;冲刺参数一律按「强度非 0 = 有效果」算。
    blocks["has_advantage"] = guard + strength_of_content + [
        ("pushbyte", 0),
        ("equals",),
        ("not",),
        ("returnvalue",),
    ]
    # mergeForDescription:新 kind 一律不合并,否则 _loc5_ 留 null 后面空引用。
    blocks["no_merge"] = [
        ("getlocal_1",),
        ("getproperty", MN["index"]),
        ("pushbyte", 0),
        ("ifne", END),
        ("getlocal_2",),
        ("getproperty", MN["index"]),
        ("pushbyte", 0),
        ("ifne", END),
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
        ("ifne", END),
        ("label", "NOMERGE"),
        ("getlex", MN["Option"]),
        ("getproperty", MN["None"]),
        ("returnvalue",),
    ]

    # ── 面板文案 ───────────────────────────────────────────────────────────
    # stringfyCommonBattleContent(param1:CommonAbilityBattleContent):Function
    # 新局部:19 = |强度|, 20 = 符号串, 21 = param_id, 22 = 参数名
    blocks["describe"] = [
        ("getlocal_1",),
        ("getproperty", MN["index"]),
        ("pushbyte", BATTLE_CONTENT_INDEX),
        ("ifne", END),
        # loc19 = strength, loc20 = 符号串, loc21 = param_id / 参数名
        ("getlocal_1",),
        ("getproperty", MN["params"]),
        ("pushbyte", 1),
        ("getproperty", MN["array_index"]),
        ("convert_d",),
        ("setlocal", 19),
        ("pushstring", s_plus),
        ("setlocal", 20),
        ("getlocal", 19),
        ("pushbyte", 0),
        ("ifge", "POSITIVE"),
        ("pushstring", s_minus),
        ("setlocal", 20),
        ("getlocal", 19),
        ("negate",),
        ("convert_d",),
        ("setlocal", 19),
        ("label", "POSITIVE"),
        ("getlocal_1",),
        ("getproperty", MN["params"]),
        ("pushbyte", 0),
        ("getproperty", MN["array_index"]),
        ("convert_i",),
        ("setlocal", 21),
    ] + _param_name_chain(pool, 21, 22) + [
        ("getlex", MN["AbilityDescriptionTools"]),
        ("getlocal", 22),
        ("getlocal", 20),
        ("add",),
        ("getlex", MN["Decimal_Impl_"]),
        ("getlocal", 19),
        ("callproperty", MN["toPercentString"], 1),
        ("add",),
        ("pushstring", s_percent),
        ("add",),
        ("callproperty", MN["stringfy"], 1),
        ("coerce", MN["Function"]),
        ("returnvalue",),
    ]

    # stringfyStrengthByCommonBattleContent(param1, param2:Number):Function
    # 与官方 case 0(PowerFlipDamage)逐条同形:百分比升降 + convertStrength。
    blocks["describe_strength"] = [
        ("getlocal_1",),
        ("getproperty", MN["index"]),
        ("pushbyte", BATTLE_CONTENT_INDEX),
        ("ifne", END),
        ("getlex", MN["AbilityDescriptionStringfier_Impl_"]),
        ("getlex", MN["AbilityDescriptionTools"]),
        ("getlocal_2",),
        ("callproperty", MN["stringfyPercentUpDown"], 1),
        ("coerce", MN["Function"]),
        ("pushfalse",),
        ("callproperty", MN["convertStrength"], 2),
        ("coerce", MN["Function"]),
        ("returnvalue",),
    ]

    # stringfySummaryCommonContent(param1:CommonAbilityContent, param2:Boolean):Function
    # 新局部:20 = 强度, 21 = 提升/降低, 22 = param_id, 23 = 参数名
    blocks["describe_summary"] = [
        ("getlocal_1",),
        ("getproperty", MN["index"]),
        ("pushbyte", 0),
        ("ifne", END),
        ("getlocal_1",),
        ("getproperty", MN["params"]),
        ("pushbyte", 0),
        ("getproperty", MN["array_index"]),
        ("getproperty", MN["index"]),
        ("pushbyte", BATTLE_CONTENT_INDEX),
        ("ifne", END),
        ("getlocal_1",),
        ("getproperty", MN["params"]),
        ("pushbyte", 0),
        ("getproperty", MN["array_index"]),
        ("getproperty", MN["params"]),
        ("pushbyte", 1),
        ("getproperty", MN["array_index"]),
        ("convert_d",),
        ("setlocal", 20),
        ("pushstring", s_up),
        ("setlocal", 21),
        ("getlocal", 20),
        ("pushbyte", 0),
        ("ifge", "SUMPOS"),
        ("pushstring", s_down),
        ("setlocal", 21),
        ("label", "SUMPOS"),
        ("getlocal_1",),
        ("getproperty", MN["params"]),
        ("pushbyte", 0),
        ("getproperty", MN["array_index"]),
        ("getproperty", MN["params"]),
        ("pushbyte", 0),
        ("getproperty", MN["array_index"]),
        ("convert_i",),
        ("setlocal", 22),
    ] + _param_name_chain(pool, 22, 23) + [
        ("getlex", MN["AbilityDescriptionTools"]),
        ("getlocal", 23),
        ("getlocal", 21),
        ("add",),
        ("callproperty", MN["stringfy"], 1),
        ("coerce", MN["Function"]),
        ("returnvalue",),
    ]

    # ── 累加器 ─────────────────────────────────────────────────────────────
    lazy_init = [("findproperty", slot_mn)]
    lazy_init += [("newarray", 0)] * PARAM_COUNT
    lazy_init += [("newarray", PARAM_COUNT), ("setproperty", slot_mn)]
    blocks["accumulate"] = [
        ("getlocal_1",),
        ("getproperty", MN["index"]),
        ("pushbyte", BATTLE_CONTENT_INDEX),
        ("ifne", END),
        ("getlocal_1",),
        ("getproperty", MN["params"]),
        ("pushbyte", 0),
        ("getproperty", MN["array_index"]),
        ("convert_i",),
        ("setlocal", 6),                        # 新增局部:param_id
        ("getlocal", 6),
        ("pushbyte", 0),
        ("iflt", END),
        ("getlocal", 6),
        ("pushbyte", PARAM_COUNT),
        ("ifge", END),
        ("findproperty", slot_mn),
        ("getproperty", slot_mn),
        ("pushnull",),
        ("ifne", "HAVE"),
    ] + lazy_init + [
        ("label", "HAVE"),
        ("findproperty", slot_mn),
        ("getproperty", slot_mn),
        ("getlocal", 6),
        ("getproperty", MN["array_index"]),
        ("findpropstrict", MN["DuringCheckerWithDecimal"]),
        ("getlocal", 4),
        ("getlocal", 5),
        ("getlocal_2",),
        ("getlocal_1",),
        ("getproperty", MN["params"]),
        ("pushbyte", 1),
        ("getproperty", MN["array_index"]),
        ("convert_d",),
        ("constructprop", MN["DuringCheckerWithDecimal"], 4),
        ("callpropvoid", MN["push"], 1),
        ("returnvoid",),
    ]

    # ── BallImpl 的七个生效点 ──────────────────────────────────────────────
    blocks["cooldown"] = [
        ("getlex", MN["Math"]),
        ("getlocal_2",),
        ("convert_d",),
    ] + _scale_top(getter_mn, 0) + [
        ("pushbyte", 1),
        ("callproperty", MN["max"], 2),
        ("convert_d",),
        ("setlocal_2",),
    ]
    # `stateFrame == 8` -> `stateFrame >= max(1, 8 × 倍率)`。
    # 原指令是 `ifne`,不能改写,于是把两个操作数换成
    # (stateFrame < 阈值) 与 0:两者「不等」正好等价于「还没到阈值」。
    blocks["charge"] = [
        ("pop",),
        ("pop",),
        ("getlex", MN["Math"]),
        ("pushbyte", 8),
        ("convert_d",),
    ] + _scale_top(getter_mn, 3) + [
        ("pushbyte", 1),
        ("callproperty", MN["max"], 2),
        ("convert_i",),
        ("setlocal", 9),
        ("findproperty", MN["stateFrame"]),
        ("getproperty", MN["stateFrame"]),
        ("convert_i",),
        ("getlocal", 9),
        ("lessthan",),
        ("pushbyte", 0),
    ]
    blocks["launch_speed"] = _scale_top(getter_mn, 1)
    blocks["inertia"] = _scale_top(getter_mn, 5)
    blocks["pullback"] = _scale_top(getter_mn, 4)
    blocks["height_gate"] = _scale_top(getter_mn, 6)
    blocks["lock_distance"] = [
        ("getlex", MN["Decimal_Impl_"]),
        ("findproperty", MN["battle"]),
        ("getproperty", MN["battle"]),
        ("getproperty", MN["abilityTotalizer"]),
        ("pushbyte", 2),
        ("callproperty", getter_mn, 1),
        ("convert_d",),
        ("callproperty", MN["toFloat"], 1),
        ("convert_d",),
        ("setlocal", 10),                       # 新增局部:距离上限(像素)
        ("pushbyte", 0),
        ("getlocal", 10),
        ("ifnlt", END),                         # 上限 <= 0 -> 官方行为
        ("getlocal", 4),
        ("pushnull",),
        ("ifeq", END),                          # 本来就没锁到目标
        ("getlocal_3",),
        ("getproperty", MN["currentDistance"]),
        ("getlocal", 10),
        ("ifle", END),                          # 在上限内 -> 保留
        ("pushnull",),
        ("coerce", MN["EscapeTarget"]),
        ("setlocal", 4),                        # 超距 -> 丢弃,走官方方向兜底
    ]
    return blocks


def _getter_source(slot_mn: int):
    """`getTotalDashParameter(param1:int):Number` 的方法体(助记符形式)。

    等价 ActionScript:

        public function getTotalDashParameter(param1:int) : Number
        {
           var _loc2_:Array = duringDashParameters;
           if(_loc2_ == null) return 0;
           var _loc3_:Array = _loc2_[param1];
           if(_loc3_ == null) return 0;
           return DuringCheckerWithDecimal.sum(_loc3_,null);
        }
    """
    return [
        ("getlocal_0",),
        ("pushscope",),
        ("getlocal_0",),
        ("getproperty", slot_mn),
        ("setlocal_2",),
        ("getlocal_2",),
        ("pushnull",),
        ("ifeq", "ZERO"),
        ("getlocal_2",),
        ("getlocal_1",),
        ("getproperty", MN["array_index"]),
        ("setlocal_3",),
        ("getlocal_3",),
        ("pushnull",),
        ("ifeq", "ZERO"),
        ("getlex", MN["DuringCheckerWithDecimal"]),
        ("getlocal_3",),
        ("pushnull",),
        ("callproperty", MN["sum"], 2),
        ("convert_d",),
        ("returnvalue",),
        ("label", "ZERO"),
        ("pushbyte", 0),
        ("convert_d",),
        ("returnvalue",),
    ]


def _getter_body(slot_mn: int):
    return asm.assemble(_getter_source(slot_mn))


# ---------------------------------------------------------------------------
def _add_totalizer_members(abc, pool):
    """给 BattleAbilityTotalizerImpl 追加 1 个槽 + 1 个方法(含 method_info/body)。"""
    abcfmt = asm.load_abc_module("abcfmt")
    matches = [row for row in abc.instances if abc.mn_name(row[0]) == TOTALIZER_CLASS]
    if len(matches) != 1:
        raise PatchError("expected exactly one %s instance" % TOTALIZER_CLASS)
    instance = matches[0]
    traits = instance[6]
    for name in ADDED_INSTANCE_TRAITS:
        if any(abc.mn_name(t.name) == name for t in traits):
            raise PatchError("%s already has a %s trait" % (TOTALIZER_CLASS, name))
    donor = next(t for t in traits if t.kind == 0 and abc.mn_name(t.name) == "duringSwift")
    if donor.data[2] != MN["Array"]:
        raise PatchError("the donor slot is not typed Array")
    namespace_donor = MN["index"]                 # QName(PackageNamespace(""), "index")

    slot_mn = pool.public_qname(TOTALIZER_SLOT, namespace_donor)
    getter_mn = pool.public_qname(TOTALIZER_GETTER, namespace_donor)

    slot = abcfmt.Trait()
    slot.name, slot.kind, slot.attr = slot_mn, 0, 0
    # slot_id 0 = 自动分配。该类现有 42 个槽全是 0(按声明序自动编号),
    # 追加在末尾不会挪动任何一个已有槽。类型 Array 的原生默认值是 null,
    # 构造函数没碰它,所以 addDuringContent 里做惰性初始化。
    slot.data, slot.metadata = ["slot", 0, MN["Array"], 0, None], []

    method_index = len(abc.methods)
    abc.methods.append([MN["Number"], [MN["int"]], 0, 0, None, None])
    getter = _getter_body(slot_mn)
    code, _offsets = asm.encode(getter)
    maximum_stack, maximum_scope, unreachable = asm.simulate(getter, 1, abc.multinames)
    if unreachable:
        raise PatchError("the new getter has unreachable instructions")
    abc.bodies.append([method_index, max(maximum_stack, 1), 4, 1, max(maximum_scope, 2),
                       code, [], []])

    method_trait = abcfmt.Trait()
    method_trait.name, method_trait.kind, method_trait.attr = getter_mn, 1, 0
    method_trait.data, method_trait.metadata = ["method", 0, method_index], []

    traits.append(slot)
    traits.append(method_trait)
    return slot_mn, getter_mn, method_index, {
        "maxstack": max(maximum_stack, 1), "localcount": 4,
        "code_bytes": len(code), "instructions": len(getter),
        "code_sha256": hashlib.sha256(code).hexdigest(),
    }


def apply_to_abc(swf: SwfAbc) -> dict:
    abc = swf.abc
    if CONTENT_CTOR.encode() in abc.strings:
        raise PatchError("this SWF already carries %s" % CAPABILITY)
    pool = PoolEditor(abc)
    slot_mn, getter_mn, method_index, getter_report = _add_totalizer_members(abc, pool)
    blocks = _blocks(pool, getter_mn, slot_mn)
    report = {}
    for name, (locked_index, base_sha256, before_header, after_header) in TARGETS.items():
        # 体下标按**方法名**重新解析:V13 起链首从 V8 重建,V9 的整类回编把
        # 51410 之后的下标整体挪过位,TARGETS 里锁的 V11 下标不再通用。
        # 名字定位 + 下面锁定的 code sha256 是两道独立的门。
        body_index = bodies.resolve(abc, name)
        body = abc.bodies[body_index]
        if hashlib.sha256(body[5]).hexdigest() != base_sha256:
            raise PatchError("%s: unrecognized baseline code (sha256=%s)"
                             % (name, hashlib.sha256(body[5]).hexdigest()))
        if (body[1], body[2]) != before_header:
            raise PatchError("%s: unexpected baseline header %r" % (name, (body[1], body[2])))
        if body[6]:
            raise PatchError("%s: this body unexpectedly has an exception table" % name)
        insertions = [(index, asm.assemble(blocks[key]), policy)
                      for index, key, policy in INSERTIONS[name]]
        for _index, block, _policy in insertions:
            needed = asm.block_locals(block)
            if needed > after_header[1]:
                raise PatchError("%s: block needs %d locals, header declares %d"
                                 % (name, needed, after_header[1]))
        code, exceptions, merged, placed = asm.splice_many(body, insertions)
        if exceptions != body[6]:
            raise PatchError("%s: the exception table moved" % name)
        if asm.unsplice_many(code, placed) != body[5]:
            raise PatchError("%s: the splice is not exactly reversible" % name)
        original_code = body[5]
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
            "locked_v11_body_index": locked_index,
            "insertions": [{"at_instruction": at, "instructions": count, "incoming": policy}
                           for at, count, policy in placed],
            "code_bytes": [len(original_code), len(code)],
            "code_sha256_after": hashlib.sha256(code).hexdigest(),
            "header": {"maxstack": body[1], "localcount": body[2]},
            "computed": {"maxstack": maximum_stack, "maxscope": maximum_scope},
        }
    report["_totalizer"] = dict(getter_report, slot_multiname=slot_mn,
                                getter_multiname=getter_mn, method_index=method_index)
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
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = apply(args.source, args.output)
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.report:
        args.report.write_text(text, encoding="utf-8", newline="\n")
    print(text)


if __name__ == "__main__":
    main()
